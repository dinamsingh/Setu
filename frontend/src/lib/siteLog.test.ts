import { describe, expect, it } from 'vitest';
import { report, round } from '../test/workflowFixtures';
import { ownSiteUpdates, siteLogDate, siteLogStatus } from './siteLog';

describe('supervisor Site Log status and history', () => {
  it('only shows own submitted reports, newest first', () => {
    const first = { ...report, id: 'a', created_at: '2026-10-03T00:00:00Z' };
    const newer = { ...report, id: 'b', created_at: '2026-10-04T00:00:00Z' };
    const someoneElse = { ...report, id: 'c', submitted_by_user_id: 'another' };
    const updates = [first, someoneElse, newer];
    expect(ownSiteUpdates(updates, 'site').map(x => x.id)).toEqual(['b', 'a']);
    expect(updates.map(x => x.id)).toEqual(['a', 'c', 'b']);
    expect(ownSiteUpdates(updates)).toEqual([]);
  });

  it('preserves truthful workflow states instead of claiming automatic approvals', () => {
    expect(siteLogStatus({ ...report, confidence_level: 'Pending', validation_status: null }).label).toBe('AI linking');
    expect(siteLogStatus(report).label).toBe('Ready for planner');
    expect(siteLogStatus({ ...report, matched_activity_id: null }).label).toBe('Needs mapping');
    expect(siteLogStatus({ ...report, validation_status: 'block', validation_overridden: false }).label).toBe('Planner check needed');
    expect(siteLogStatus(report, [round]).label).toBe('Reply requested');
    expect(siteLogStatus(report, [{ ...round, status: 'responded' }]).label).toBe('Response sent');
    expect(siteLogStatus({ ...report, status: 'approved' }).label).toBe('Planner approved');
    expect(siteLogStatus({ ...report, status: 'remapped' }).label).toBe('Remapped & approved');
    expect(siteLogStatus({ ...report, status: 'rejected' }).label).toBe('Rejected');
  });

  it('does not derive dates from device timezone or invalid values', () => {
    expect(siteLogDate('2026-10-11')).toBe('11 Oct 2026');
    expect(siteLogDate('2026-10-11T02:01:05Z')).toBe('11 Oct 2026');
    expect(siteLogDate(null)).toBe('Date not provided');
  });
});
