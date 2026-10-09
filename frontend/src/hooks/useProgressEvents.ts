import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import type { FieldUpdate } from '../types';
import type { ProgressEvent } from '../types/progressEvents';

export function useProgressEvents(update?: FieldUpdate | null, refreshParent?: (isPolling: boolean) => Promise<void>) {
  const { user } = useAuth();
  const id = update?.id;
  const revision = update?.evidence_revision ?? 0;
  const completed = Boolean(update && update.progress_extraction_revision === revision);
  // Reuse the parent's quiet refetch while this selected revision is pending.
  // Schedule after completion of each request, so slow reads cannot overlap.
  const userId = user?.id;
  useEffect(() => {
    if (!id || !userId || completed || !refreshParent) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refreshParent!(true); }
      finally { if (!stopped) timer = setTimeout(() => { void poll().catch(() => {}); }, 5000); }
    }
    timer = setTimeout(() => { void poll().catch(() => {}); }, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, revision, completed, userId, refreshParent]);
  const [attempt, setAttempt] = useState(0);
  const refetch = useCallback(() => setAttempt(value => value + 1), []);
  const key = `${user?.id ?? ''}:${id ?? ''}:${revision}:${completed}:${attempt}`;
  const [result, setResult] = useState<{ key: string; events: ProgressEvent[]; error: string | null }>({
    key: '', events: [], error: null,
  });
  useEffect(() => {
    let ignore = false;
    if (!id || !user || !completed) return;
    async function fetchEvents() {
      try {
        const { data, error } = await supabase.from('progress_events').select('*')
          .eq('field_update_id', id).eq('evidence_revision', revision)
          .order('event_index', { ascending: true });
        if (error) throw error;
        if (!ignore) setResult({ key, events: data || [], error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String((error as { message?: string }).message || error);
        if (!ignore) setResult({ key, events: [], error: message });
      }
    }
    void fetchEvents();
    return () => { ignore = true; };
  }, [id, revision, completed, key, user]);
  // Guard render itself, not only effect cleanup: never flash old evidence/user data.
  return { events: result.key === key ? result.events : [],
    error: result.key === key ? result.error : null,
    loading: completed && result.key !== key, refetch };
}
