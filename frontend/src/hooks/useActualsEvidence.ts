import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import type { ActualsEvidence } from '../types/actuals';

export function useActualsEvidence(activityId: string | null) {
  const { user, role } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState({ scope: '', page: 0 });
  const scope = `${user?.id ?? ''}:${role}:${activityId ?? ''}:${attempt}`;
  const page = cursor.scope === scope ? cursor.page : 0;
  const key = `${scope}:${page}`;
  const allowed = Boolean(activityId && user && (role === 'planner' || role === 'admin'));
  const [result, setResult] = useState<{ key: string; events: ActualsEvidence[]; error: string | null; hasMore: boolean }>({ key: '', events: [], error: null, hasMore: false });
  const refetch = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    let ignore = false;
    if (!allowed || !activityId) return;
    async function read() {
      try {
        const { data, error } = await supabase.from('schedule_actuals_evidence').select('*')
          .eq('activity_id', activityId).order('chronology_date', { ascending: false, nullsFirst: false })
          .order('report_created_at', { ascending: false, nullsFirst: false })
          .order('field_update_id', { ascending: false }).order('event_index', { ascending: false })
          .order('event_id', { ascending: false }).range(page * 100, page * 100 + 100);
        if (error) throw error;
        if (!ignore) setResult({ key, events: (data || []).slice(0, 100), hasMore: (data?.length ?? 0) > 100, error: null });
      } catch (error) {
        if (!ignore) setResult({ key, events: [], hasMore: false, error: (error as { message?: string }).message || String(error) });
      }
    }
    void read();
    return () => { ignore = true; };
  }, [activityId, allowed, key, page]);
  return { events: allowed && result.key === key ? result.events : [],
    error: allowed && result.key === key ? result.error : null, loading: allowed && result.key !== key,
    hasMore: allowed && result.key === key && result.hasMore, page, refetch,
    next: () => setCursor({ scope, page: page + 1 }), previous: () => setCursor({ scope, page: Math.max(0, page - 1) }) };
}
