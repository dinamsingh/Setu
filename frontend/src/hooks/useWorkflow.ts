import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import type { Clarification, RemapProposal, WorkflowResult } from '../types/workflow';

export function useWorkflow(onRefresh?: () => Promise<void>) {
  const { user, role } = useAuth();
  const [rounds, setRounds] = useState<Clarification[]>([]);
  const [proposals, setProposals] = useState<RemapProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refreshParent = useRef(onRefresh);
  useEffect(() => { refreshParent.current = onRefresh; }, [onRefresh]);
  const planner = role === 'planner' || role === 'admin';
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    if (!user) return;
    try {
      let query = supabase.from('field_update_clarifications').select('*').order('created_at', { ascending: false });
      if (!planner) query = query.eq('recipient_user_id', user.id);
      const [c, p] = await Promise.all([query, planner
        ? supabase.from('field_update_remap_proposals').select('*').order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null })]);
      if (c.error || p.error) throw c.error || p.error;
      if (token === generation.current) {
        setRounds(c.data || []); setProposals(p.data || []); setError(null);
      }
    } catch (err) {
      if (token === generation.current) setError(err instanceof Error ? err.message : String((err as {message?: string}).message || err));
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [user, planner]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const requests = generation;
    // One bounded poll for workflow changes; no overlapping interval requests.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (!stopped) await refreshParent.current?.();
      if (!stopped) timer = setTimeout(poll, 5000);
    }
    timer = setTimeout(poll, 5000);
    return () => { stopped = true; ++requests.current; clearTimeout(timer); };
  }, [refresh]);
  const act = async (name: string, params: Record<string, unknown>): Promise<WorkflowResult> => {
    try {
      const { error: rpcError } = await supabase.rpc(name, params);
      if (rpcError) throw rpcError;
      await Promise.all([refresh(), refreshParent.current?.()]);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String((err as {message?: string}).message || err) };
    }
  };
  return { rounds: planner ? rounds : rounds.filter(c => c.recipient_user_id === user?.id),
    proposals: planner ? proposals : [], error, loading, refresh, act };
}
