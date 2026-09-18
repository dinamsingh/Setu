import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { DomainAlias, PlannerAuditLog } from '../types';

export function useAuditLogs() {
  const [logs, setLogs] = useState<PlannerAuditLog[]>([]);
  const [aliases, setAliases] = useState<DomainAlias[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const [logsRes, aliasesRes] = await Promise.all([
        supabase
          .from('planner_audit_logs')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('domain_aliases')
          .select('*')
          .order('id', { ascending: true })
      ]);

      if (logsRes.error) throw logsRes.error;
      if (aliasesRes.error) throw aliasesRes.error;

      setLogs(logsRes.data || []);
      setAliases(aliasesRes.data || []);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching audit logs / aliases:', err);
      setError(err.message || 'Failed to fetch audit records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const approveAlias = async (id: number, plannerName: string = 'Lead Project Planner') => {
    try {
      const { error: updateErr } = await supabase
        .from('domain_aliases')
        .update({
          status: 'verified',
          reviewed_by: plannerName,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateErr) throw updateErr;
      await fetchLogs();
      return { success: true };
    } catch (err: any) {
      console.error('Error approving alias:', err);
      return { success: false, error: err.message };
    }
  };

  const rejectAlias = async (id: number, plannerName: string = 'Lead Project Planner') => {
    try {
      const { error: updateErr } = await supabase
        .from('domain_aliases')
        .update({
          status: 'rejected',
          reviewed_by: plannerName,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateErr) throw updateErr;
      await fetchLogs();
      return { success: true };
    } catch (err: any) {
      console.error('Error rejecting alias:', err);
      return { success: false, error: err.message };
    }
  };

  return { logs, aliases, loading, error, refetch: fetchLogs, approveAlias, rejectAlias };
}
