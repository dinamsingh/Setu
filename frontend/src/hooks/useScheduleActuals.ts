import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import type { ScheduleActualsRow } from '../types/actuals';

// Explicit entry/Refresh reads only; page through bounded PostgREST responses.
export function useScheduleActuals() {
  const { user, role } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const refetch = useCallback(() => setAttempt(n => n + 1), []);
  const allowed = Boolean(user && (role === 'planner' || role === 'admin'));
  const key = `${user?.id ?? ''}:${role}:${attempt}`;
  const [result, setResult] = useState<{ key: string; rows: ScheduleActualsRow[]; error: string | null }>({ key: '', rows: [], error: null });
  useEffect(() => {
    let ignore = false;
    if (!allowed) return;
    async function read() {
      try {
        const rows: ScheduleActualsRow[] = [];
        for (let offset = 0; !ignore; offset += 200) {
          const { data, error } = await supabase.from('schedule_actuals_overlay').select('*')
            .order('activity_id', { ascending: true }).range(offset, offset + 199);
          if (error) throw error;
          rows.push(...(data || []));
          if ((data?.length ?? 0) < 200) break;
        }
        if (!ignore) setResult({ key, rows, error: null });
      } catch (error) {
        if (!ignore) setResult({ key, rows: [], error: (error as { message?: string }).message || String(error) });
      }
    }
    void read();
    return () => { ignore = true; };
  }, [allowed, key]);
  return { rows: allowed && result.key === key ? result.rows : [],
    loading: allowed && result.key !== key, error: allowed && result.key === key ? result.error : null, refetch };
}
