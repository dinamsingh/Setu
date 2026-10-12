// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseFieldReportFile, revalidateIntakePreview, INTAKE_LIMITS } from './fieldReportIntake';
import { intakeFile } from '../test/intakeFixtures';

describe('local correction validation, using the intake parser rules', () => {
  it('corrects required values and unsupported discipline without mutating source evidence', async () => {
    const source = await parseFieldReportFile(intakeFile('field_text,reported_date,discipline\n,2026-02-29,Mining'));
    const original = JSON.stringify(source);
    const result = revalidateIntakePreview(source, { 2: { field_text: 'Work started', reported_date: '2024-02-29', discipline: 'Civil' } });
    expect(result.valid).toBe(true); expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[0].raw).toBe(source.rows[0].raw);
    expect(JSON.stringify(source)).toBe(original);
  });
  it('detects duplicates introduced by an edit, and resolves them after a correction', async () => {
    const source = await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A,2026-10-11\nWork B,2026-10-11'));
    const duplicate = revalidateIntakePreview(source, { 3: { field_text: 'Work A' } });
    expect(duplicate.valid).toBe(false); expect(duplicate.rows[1].duplicateOf).toBe(2);
    expect(duplicate.summary).toEqual({ totalRows: 2, validRows: 1, invalidRows: 1 });
    expect(revalidateIntakePreview(source, { 3: { field_text: 'Work C' } }).valid).toBe(true);
  });
  it('recalculates all duplicates when the original duplicate target changes', async () => {
    const source = await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A,2026-10-11\nWork A,2026-10-11'));
    const fixed = revalidateIntakePreview(source, { 2: { field_text: 'Work B' } });
    expect(fixed.summary.validRows).toBe(2); expect(fixed.rows[1].duplicateOf).toBeUndefined();
  });
  it('allows local optional values even when their columns were not mapped', async () => {
    const source = await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A,2026-10-11'));
    const fixed = revalidateIntakePreview(source, { 2: { site_location: 'Rack B', reported_by: 'S. Das', discipline: 'Piping' } });
    expect(fixed.valid).toBe(true); expect(fixed.rows[0].data.site_location).toBe('Rack B');
    expect(fixed.rows[0].data.reported_by).toBe('S. Das'); expect(fixed.rows[0].data.discipline).toBe('Piping');
  });
  it('retains malformed source row errors after value edits', async () => {
    const source = await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A'));
    const result = revalidateIntakePreview(source, { 2: { reported_date: '2026-10-11' } });
    expect(result.valid).toBe(false); expect(result.rows[0].errors.some(e => e.code === 'malformed_row')).toBe(true);
  });
  it('cannot turn an unsafe or incomplete file into a valid preview', async () => {
    const source = await parseFieldReportFile(intakeFile('Notes,Day\nWork A,2026-10-11'));
    expect(revalidateIntakePreview(source, { 2: { field_text: 'Work A', reported_date: '2026-10-11' } })).toBe(source);
    const unsupported = await parseFieldReportFile(intakeFile('text', 'a.xlsm'));
    expect(revalidateIntakePreview(unsupported, {})).toBe(unsupported);
  });
  it('preserves length limits on edited and unused source cells', async () => {
    const source = await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A,2026-10-11'));
    expect(revalidateIntakePreview(source, { 2: { field_text: 'a'.repeat(INTAKE_LIMITS.cellChars + 1) } }).valid).toBe(false);
    const oversized = await parseFieldReportFile(intakeFile(`field_text,reported_date,Unused\nWork A,2026-10-11,${'a'.repeat(INTAKE_LIMITS.cellChars + 1)}`));
    expect(revalidateIntakePreview(oversized, { 2: { field_text: 'Work B' } }).valid).toBe(false);
  });
  it('validates corrected dates using the explicitly selected format', async () => {
    const source = await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A,11/10/2026'), { dateFormat: 'DD/MM/YYYY' });
    expect(revalidateIntakePreview(source, { 2: { reported_date: '12/10/2026' } }, 'DD/MM/YYYY').rows[0].data.reported_date).toBe('2026-10-12');
    expect(revalidateIntakePreview(source, { 2: { reported_date: '31/02/2026' } }, 'DD/MM/YYYY').valid).toBe(false);
  });
  it('retains control-character rejection and literal untrusted narrative', async () => {
    const source = await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A,2026-10-11'));
    expect(revalidateIntakePreview(source, { 2: { field_text: 'bad\0text' } }).valid).toBe(false);
    expect(revalidateIntakePreview(source, { 2: { field_text: '<script>doNotRun()</script>' } }).rows[0].data.field_text).toBe('<script>doNotRun()</script>');
  });
});
