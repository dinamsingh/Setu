import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { FieldUpdate } from '../types';
import { computeKpis, parseCandidates } from '../lib/utils';

export function useFieldUpdates() {
  const [updates, setUpdates] = useState<FieldUpdate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUpdates = useCallback(async (isPolling = false) => {
    try {
      if (!isPolling) setLoading(true);
      const { data, error: sbError } = await supabase
        .from('field_updates')
        .select('*')
        .order('update_id', { ascending: true });

      if (sbError) throw sbError;

      const formatted: FieldUpdate[] = (data || []).map((row: any) => ({
        ...row,
        candidate_matches: parseCandidates(row.candidate_matches),
      }));

      setUpdates(formatted);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching field updates:', err);
      if (!isPolling) {
        setError(err.message || 'Failed to fetch field updates');
      }
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUpdates();
  }, [fetchUpdates]);

  // Poll every 4 seconds while any row is awaiting matching
  const hasUnmatched = useMemo(() => {
    return updates.some(
      (u) => !u.confidence_level || u.confidence_level.toLowerCase() === 'pending'
    );
  }, [updates]);

  useEffect(() => {
    if (!hasUnmatched) return;

    const intervalId = setInterval(() => {
      fetchUpdates(true);
    }, 4000);

    return () => clearInterval(intervalId);
  }, [hasUnmatched, fetchUpdates]);

  const kpis = useMemo(() => computeKpis(updates), [updates]);

  const submitFieldUpdate = async ({
    fieldText,
    siteLocation,
    reportedBy,
    reportedDate,
  }: {
    fieldText: string;
    siteLocation: string;
    reportedBy?: string;
    reportedDate?: string;
  }) => {
    try {
      const nextNum = updates.length + 1;
      const nextId = `UPD-2026-${String(nextNum).padStart(3, '0')}`;
      const nowIso = new Date().toISOString().split('T')[0];

      const payload = {
        update_id: nextId,
        source_type: 'manual_text',
        field_text: fieldText.trim(),
        site_location: siteLocation.trim() || 'Site Area',
        reported_by: (reportedBy || 'Site Supervisor').trim(),
        reported_date: reportedDate || nowIso,
        status: 'pending',
        confidence_level: 'Pending',
        confidence_score: 0,
        matched_activity_id: null,
        expanded_text: null,
        matched_layer: null,
        candidate_matches: [],
      };

      const { data, error: insertError } = await supabase
        .from('field_updates')
        .insert([payload])
        .select();

      if (insertError) throw insertError;

      await fetchUpdates();
      return { success: true, data: data?.[0], updateId: nextId };
    } catch (err: any) {
      console.error('Error submitting field update:', err);
      return { success: false, error: err.message || 'Failed to submit field update' };
    }
  };

  const updateStatusAndAudit = async ({
    updateUuid,
    action,
    previousActId,
    newActId,
    plannerName,
    remarks,
  }: {
    updateUuid: string;
    action: 'accept' | 'reject' | 'remap';
    previousActId: string | null;
    newActId: string | null;
    plannerName: string;
    remarks: string;
  }) => {
    try {
      const statusMap = {
        accept: 'approved',
        reject: 'rejected',
        remap: 'remapped',
      } as const;
      const newStatus = statusMap[action];
      const finalMatchedAct = action === 'reject' ? previousActId : (newActId || previousActId);

      // 1. Update field_updates
      const { error: updError } = await supabase
        .from('field_updates')
        .update({
          status: newStatus,
          matched_activity_id: finalMatchedAct,
          planner_remarks: remarks || `Action: ${action} confirmed by ${plannerName}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', updateUuid);

      if (updError) throw updError;

      // 2. Insert into planner_audit_logs
      const { error: auditError } = await supabase
        .from('planner_audit_logs')
        .insert([
          {
            field_update_id: updateUuid,
            action,
            previous_activity_id: previousActId,
            new_activity_id: finalMatchedAct,
            planner_name: plannerName || 'Lead Project Planner',
            remarks: remarks || `Action: ${action} confirmed.`,
          },
        ]);

      if (auditError) throw auditError;

      await fetchUpdates();
      return { success: true };
    } catch (err: any) {
      console.error('Error recording planner action:', err);
      return { success: false, error: err.message || 'Failed to update planner decision' };
    }
  };

  const requeueForRematching = async ({
    updateUuid,
    plannerName,
    remarks,
  }: {
    updateUuid: string;
    plannerName: string;
    remarks?: string;
  }) => {
    try {
      const row = updates.find((u) => u.id === updateUuid || u.update_id === updateUuid);
      if (!row) throw new Error(`Field update ${updateUuid} not found.`);

      const currStatus = (row.status || '').toLowerCase();
      if (['approved', 'rejected', 'remapped'].includes(currStatus)) {
        throw new Error(
          `Cannot re-queue update '${row.update_id}': Row is already reviewed with status '${currStatus}'. Re-queue is strictly limited to unreviewed rows.`
        );
      }

      // 1. Reset confidence to Pending
      const { error: updError } = await supabase
        .from('field_updates')
        .update({
          confidence_level: 'Pending',
          confidence_score: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updError) throw updError;

      // 2. Insert into planner_audit_logs
      const { error: auditError } = await supabase
        .from('planner_audit_logs')
        .insert([
          {
            field_update_id: row.id,
            action: 'requeue',
            previous_activity_id: row.matched_activity_id,
            new_activity_id: null,
            planner_name: plannerName || 'Lead Project Planner',
            remarks: remarks || 'Re-queued for re-matching with updated domain dictionary.',
          },
        ]);

      if (auditError) throw auditError;

      await fetchUpdates();
      return { success: true };
    } catch (err: any) {
      console.error('Error re-queuing update for rematching:', err);
      return { success: false, error: err.message || 'Failed to re-queue update' };
    }
  };

  const overrideValidation = async ({
    updateUuid,
    plannerName,
    reason,
  }: {
    updateUuid: string;
    plannerName: string;
    reason: string;
  }) => {
    try {
      if (!reason || !reason.trim()) {
        throw new Error('A non-empty justification is required to override validation.');
      }

      const row = updates.find((u) => u.id === updateUuid || u.update_id === updateUuid);
      if (!row) throw new Error(`Field update ${updateUuid} not found.`);

      const nowIso = new Date().toISOString();

      // 1. Update field_updates
      const { error: updError } = await supabase
        .from('field_updates')
        .update({
          validation_overridden: true,
          override_reason: reason.trim(),
          override_by: plannerName || 'Lead Project Planner',
          override_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', row.id);

      if (updError) throw updError;

      // 2. Insert into planner_audit_logs
      const { error: auditError } = await supabase
        .from('planner_audit_logs')
        .insert([
          {
            field_update_id: row.id,
            action: 'override',
            previous_activity_id: row.matched_activity_id,
            new_activity_id: row.matched_activity_id,
            planner_name: plannerName || 'Lead Project Planner',
            remarks: `Validation Override: ${reason.trim()}`,
          },
        ]);

      if (auditError) throw auditError;

      await fetchUpdates();
      return { success: true };
    } catch (err: any) {
      console.error('Error overriding validation:', err);
      return { success: false, error: err.message || 'Failed to override validation' };
    }
  };

  return {
    updates,
    kpis,
    loading,
    error,
    refetch: fetchUpdates,
    submitFieldUpdate,
    updateStatusAndAudit,
    requeueForRematching,
    overrideValidation,
  };
}
