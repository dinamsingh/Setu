import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ActualsTable } from './ActualsTable';
import { actualsRow } from '../../test/actualsFixtures';
import type { ScheduleActualsRow } from '../../types/actuals';

const render = (rows: ScheduleActualsRow[] = [actualsRow], loading = false, error: string | null = null) =>
  renderToStaticMarkup(<ActualsTable rows={rows} loading={loading} error={error} selectedId={null} onSelect={() => {}}/>);
it('distinguishes loading, errors, and empty baseline', () => {
  expect(render([], true)).toContain('Loading schedule actuals');
  expect(render([], false, 'Denied')).toContain('Could not load actuals: Denied');
  expect(render([])).toContain('No baseline activities available');
});
it('groups baseline and SETU actuals and shows real dates/progress/evidence', () => {
  const html = render();
  expect(html).toContain('scope="colgroup"'); expect(html).toContain('Baseline'); expect(html).toContain('SETU actuals');
  for (const text of ['2026-09-01', '2026-10-01', '2026-09-03', '2026-10-03', '60%', '3 events', '1 reports', 'View evidence']) expect(html).toContain(text);
});
it('keeps empty actuals distinct from unresolved approved evidence', () => {
  expect(render([{ ...actualsRow, contributing_event_count: 0, contributing_report_count: 0,
    actual_start: null, actual_finish: null, progress_percent: null }])).toContain('No approved actuals');
  expect(render([{ ...actualsRow, actual_start: null, actual_finish: null, unresolved_event_date: true }])).toContain('Approved evidence; date unresolved');
});
it('uses warning icon and text for conflicts and missing START', () => {
  const html = render([{ ...actualsRow, finish_before_start: true, progress_regression: true, start_not_evidenced: true }]);
  for (const text of ['Evidence warnings', 'Finish before start', 'Later progress is lower', 'Start not evidenced', '<svg']) expect(html).toContain(text);
});
it('does not infer 100 percent from FINISH or hide zero progress', () => {
  expect(render([{ ...actualsRow, progress_percent: null }])).not.toContain('100%');
  expect(render([{ ...actualsRow, progress_percent: 0 }])).toContain('0%');
});
it('offers provenance only, no edit/requeue/writeback controls', () => {
  const html = render().toLowerCase();
  for (const text of ['edit', 'requeue', 'sync primavera', 'writeback', 'approve', 'remap']) expect(html).not.toContain(`>${text}<`);
  expect((html.match(/<button/g) ?? []).length).toBe(1);
});
