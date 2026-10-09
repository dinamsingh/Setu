import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressEventsSection } from './ProgressEventsSection';
import type { ProgressEvent } from '../../types/progressEvents';
import { report } from '../../test/workflowFixtures';
import { ReviewCard } from './ReviewCard';

const current = { ...report, evidence_revision: 2, progress_extraction_revision: 2 };
const event = (kind: ProgressEvent['event_type'], changes: Partial<ProgressEvent> = {}): ProgressEvent => ({
  id: kind, field_update_id: report.id, evidence_revision: 2, event_index: 0,
  event_type: kind, event_date: '2026-10-04', progress_percent: kind === 'PROGRESS' ? 60 : null,
  evidence_text: 'Supported field clause', extraction_reason: 'Explicit actual wording.',
  extraction_version: 'phase1_rules_v1', created_at: '2026-10-04', ...changes,
});

describe('read-only machine progress evidence', () => {
  it('shows ordered START, FINISH and PROGRESS with evidence/rule and no editing', () => {
    const html = renderToStaticMarkup(<ProgressEventsSection update={current} events={[
      event('FINISH', { event_index: 2 }), event('START'), event('PROGRESS', { event_index: 1 }),
    ]} />);
    for (const text of ['START', 'FINISH', 'PROGRESS', '60%', '04 Oct 2026', 'Supported field clause',
      'Explicit actual wording.', 'Not planner approval', 'no schedule dates or progress have been updated']) expect(html).toContain(text);
    expect(html.indexOf('START')).toBeLessThan(html.indexOf('PROGRESS'));
    expect(html.indexOf('PROGRESS')).toBeLessThan(html.indexOf('FINISH'));
    expect(html).not.toContain('<input'); expect(html).not.toContain('<button');
  });
  it('UNKNOWN is interpretation, not an error; unresolved dates remain honest', () => {
    const html = renderToStaticMarkup(<ProgressEventsSection update={current} events={[event('UNKNOWN', { event_date: null })]} />);
    expect(html).toContain('Needs planner interpretation'); expect(html).not.toContain('role="alert"');
    expect(renderToStaticMarkup(<ProgressEventsSection update={current} events={[event('START', { event_date: null })]} />)).toContain('Date not resolved');
  });
  it('only current revision and selected parent appear', () => {
    const html = renderToStaticMarkup(<ProgressEventsSection update={current} events={[
      event('START'), event('FINISH', { evidence_revision: 1 }), event('PROGRESS', { field_update_id: 'other' }),
    ]} />);
    expect(html).toContain('START'); expect(html).not.toContain('FINISH'); expect(html).not.toContain('PROGRESS');
  });
  it.each([undefined, null, 1])('stale/absent marker %s hides old events and shows awaiting', (marker) => {
    const html = renderToStaticMarkup(<ProgressEventsSection update={{ ...current, progress_extraction_revision: marker }} events={[event('FINISH')]} />);
    expect(html).toContain('Awaiting structured progress extraction'); expect(html).not.toContain('FINISH');
  });
  it('distinguishes loading, fetch failure and missing rows', () => {
    expect(renderToStaticMarkup(<ProgressEventsSection update={current} loading />)).toContain('Loading structured progress');
    expect(renderToStaticMarkup(<ProgressEventsSection update={current} error="Access denied" />)).toContain('Progress events could not load: Access denied');
    expect(renderToStaticMarkup(<ProgressEventsSection update={current} />)).toContain('Structured progress is unavailable');
  });
  it('events stay visible on finalized ReviewCard without decision controls', () => {
    const html = renderToStaticMarkup(<ReviewCard update={{ ...current, status: 'approved' }} plannerName="Planner"
      onAccept={async () => {}} onReject={async () => {}} onOpenRemap={() => {}} progressEvents={[event('START')]} />);
    expect(html).toContain('START'); expect(html).toContain('Finalized / read-only');
    expect(html).not.toContain('Accept mapping'); expect(html).not.toContain('Remap activity');
  });
  it.each([
    { confidence_level: 'Pending' as const, validation_status: null },
    { validation_status: 'block' as const, validation_overridden: false },
  ])('extracted events never unlock existing matching/validation decision guards: %s', (changes) => {
    const html = renderToStaticMarkup(<ReviewCard update={{ ...current, ...changes }} plannerName="Planner"
      onAccept={async () => {}} onReject={async () => {}} onOpenRemap={() => {}} progressEvents={[event('START')]} />);
    expect(html).toContain('START'); expect(html).not.toContain('Accept mapping');
    expect(html).not.toContain('Remap activity');
  });
});
