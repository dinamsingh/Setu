import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { ScheduleActivity } from '../types';

/**
 * Schedule activities, optionally scoped to one baseline (Migration 017).
 * Passing no baseline keeps the previous behaviour (all activities the
 * caller may read under RLS). Passing a baseline_id filters the query to
 * that baseline only, so a supervisor sees only their assigned baseline
 * and an evaluator sees only the Sample Baseline. The filter is a
 * defence-in-depth UI scope: the database RLS policies are the real
 * boundary, and they apply even if this filter is bypassed.
 */
export function useScheduleData(baselineId?: string | null) {
  const [activities, setActivities] = useState<ScheduleActivity[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchActivities() {
      try {
        setLoading(true);
        const baseQuery = supabase
          .from('schedule_activities')
          .select('id, activity_id, activity_name, wbs_code, wbs_name, discipline, planned_start_date, planned_finish_date, planned_progress_pct, unit_of_measure, planned_qty, created_at, baseline_id');
        const scopedQuery = baselineId
          ? baseQuery.eq('baseline_id', baselineId)
          : baseQuery;
        const { data, error: sbError } = await scopedQuery.order('activity_id', { ascending: true });

        if (sbError) throw sbError;
        setActivities(data || []);
      } catch (err: any) {
        console.error('Error fetching schedule activities:', err);
        setError(err.message || 'Failed to fetch schedule activities');
      } finally {
        setLoading(false);
      }
    }

    fetchActivities();
  }, [baselineId]);

  const activitiesMap = useMemo(() => {
    const map = new Map<string, ScheduleActivity>();
    for (const act of activities) {
      map.set(act.activity_id, act);
    }
    return map;
  }, [activities]);

  const disciplines = useMemo(() => {
    const set = new Set<string>();
    for (const act of activities) {
      if (act.discipline) set.add(act.discipline);
    }
    return Array.from(set).sort();
  }, [activities]);

  return { activities, activitiesMap, disciplines, loading, error };
}
