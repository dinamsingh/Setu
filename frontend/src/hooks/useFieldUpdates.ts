import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { FieldUpdate } from '../types';
import { useAuth } from '../lib/AuthContext';
import { computeKpis, parseCandidates } from '../lib/utils';

export function useFieldUpdates() {
  const [updates, setUpdates] = useState<FieldUpdate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

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
      if (!user) throw new Error('You must be signed in to submit a field update.');
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
        submitted_by_user_id: user?.id ?? null,
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

  const submitPlannerDecision = async ({
    updateUuid,
    action,
    targetActivityId,
    remarks,
  }: {
    updateUuid: string;
    action: 'accept' | 'reject' | 'remap';
    targetActivityId?: string | null;
    remarks: string;
  }) => {
    try {
      const { error: rpcError } = await supabase.rpc('review_field_update', {
        p_field_update_id: updateUuid,
        p_action: action,
        p_target_activity_id: targetActivityId ?? null,
        p_remarks: remarks || null,
      });

      if (rpcError) throw rpcError;

      await fetchUpdates();
      return { success: true };
    } catch (err: any) {
      console.error('Error recording planner action:', err);
      return { success: false, error: err.message || 'Failed to update planner decision' };
    }
  };

  const requeueForRematching = async ({
    updateUuid,
    remarks,
  }: {
    updateUuid: string;
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

      const { error: rpcError } = await supabase.rpc('requeue_field_update', {
        p_field_update_id: row.id,
        p_remarks: remarks || null,
      });

      if (rpcError) throw rpcError;

      await fetchUpdates();
      return { success: true };
    } catch (err: any) {
      console.error('Error re-queuing update for rematching:', err);
      return { success: false, error: err.message || 'Failed to re-queue update' };
    }
  };

  const overrideValidation = async ({
    updateUuid,
    reason,
  }: {
    updateUuid: string;
    reason: string;
  }) => {
    try {
      if (!reason || !reason.trim()) {
        throw new Error('A non-empty justification is required to override validation.');
      }

      const row = updates.find((u) => u.id === updateUuid || u.update_id === updateUuid);
      if (!row) throw new Error(`Field update ${updateUuid} not found.`);

      const { error: rpcError } = await supabase.rpc('override_field_update_validation', {
        p_field_update_id: row.id,
        p_reason: reason.trim(),
      });

      if (rpcError) throw rpcError;

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
    submitPlannerDecision,
    requeueForRematching,
    overrideValidation,
  };
}
