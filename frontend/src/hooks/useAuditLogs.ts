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

  return { logs, aliases, loading, error, refetch: fetchLogs };
}
