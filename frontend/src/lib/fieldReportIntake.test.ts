// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { INTAKE_LIMITS, normalizeIntakeDate, parseFieldReportFile } from './fieldReportIntake';

const header = 'field_text,site_location,reported_date,reported_by,discipline';
const body = 'Rack B welding completed,Rack B,2026-10-11,R. Das,Piping';
function file(contents: string | Uint8Array, name = 'reports.csv') {
  const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer };
}
const codes = (result: Awaited<ReturnType<typeof parseFieldReportFile>>) => result.errors.map(error => error.code);
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Real OOXML test archives, decoded through the real browser-compatible reader, not mocks.
function workbook(sheetXml?: string, extra: Record<string, Uint8Array> = {}, date1904 = false) {
  const headers = ['field_text', 'site_location', 'reported_date', 'reported_by', 'discipline'];
  const values = ['Rack B welding completed', 'Rack B', '2026-10-11', 'R. Das', 'Piping'];
  const row = (items: string[], number: number) => `<row r="${number}">${items.map((text, index) => `<c r="${String.fromCharCode(65 + index)}${number}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`).join('')}</row>`;
  const main = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E2"/><sheetData>${row(headers, 1)}${row(values, 2)}</sheetData></worksheet>`;
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    'xl/workbook.xml': strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${date1904 ? '1' : '0'}"/><sheets><sheet name="Reports" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/styles.xml': strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml ?? main),
    ...extra,
  };
  return { entries, bytes: zipSync(entries) };
}

describe('CSV field-report intake', () => {
  it('normalizes valid source headers/values, quoted multiline narrative and BOM without writing anywhere', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    try {
      const result = await parseFieldReportFile(file('\uFEFFNarrative,Location,Report Date,Reporter,Engineering Discipline\r\n"Rack B, welding\ncompleted", Rack B ,2026-10-11, R. Das , piping \r\n'));
      expect(result.valid).toBe(true);
      expect(result.rows[0].rowNumber).toBe(2);
      expect(result.rows[0].data).toEqual({ field_text: 'Rack B, welding\ncompleted', site_location: 'Rack B', reported_date: '2026-10-11', reported_by: 'R. Das', discipline: 'Piping' });
      expect(network).not.toHaveBeenCalled();
      expect(Object.keys(result.rows[0].data)).not.toContain('submitted_by_user_id');
    } finally { network.mockRestore(); }
  });
  it('supports explicit header and zero-based index mapping', async () => {
    const result = await parseFieldReportFile(file('Notes,Place,Day,Author,Team\nFinished,Rack B,11/10/2026,R. Das,Civil'), {
      columnMapping: { field_text: 'Notes', site_location: 1, reported_date: 'Day', reported_by: 'Author', discipline: 'Team' }, dateFormat: 'DD/MM/YYYY',
    });
    expect(result.valid).toBe(true); expect(result.rows[0].data.reported_date).toBe('2026-10-11');
  });
  it('keeps optional missing fields null instead of inventing submitter/location/discipline', async () => {
    const result = await parseFieldReportFile(file('field_text,reported_date\nFinished,2026-10-11'));
    expect(result.valid).toBe(true);
    expect(result.rows[0].data).toEqual({ field_text: 'Finished', reported_date: '2026-10-11', site_location: null, reported_by: null, discipline: null });
  });
  it.each(['field_text\nFinished', 'reported_date\n2026-10-11', 'Notes,Day\nFinished,2026-10-11'])('exposes missing columns for mapping: %s', async csv => {
    const result = await parseFieldReportFile(file(csv));
    expect(result.valid).toBe(false); expect(codes(result)).toContain('missing_column'); expect(result.headers.length).toBeGreaterThan(0);
  });
  it('requires explicit resolution of competing narrative aliases', async () => {
    const csv = 'Narrative,Description,Date\nFinished,Wrong narrative,2026-10-11';
    expect(codes(await parseFieldReportFile(file(csv)))).toContain('ambiguous_column');
    const result = await parseFieldReportFile(file(csv), { columnMapping: { field_text: 'Narrative' } });
    expect(result.valid).toBe(true); expect(result.rows[0].data.field_text).toBe('Finished');
  });
  it('rejects duplicate normalized headers before Papa can silently rename them', async () => {
    expect(codes(await parseFieldReportFile(file('field_text,Field Text,Date\nDone,Done,2026-10-11')))).toContain('ambiguous_column');
  });
  it.each([{ field_text: 9 }, { field_text: -1 }, { field_text: 'Absent' }, { field_text: null }, { field_text: 0, reported_date: 0 }])('rejects invalid mappings %j', async columnMapping => {
    expect((await parseFieldReportFile(file(`${header}\n${body}`), { columnMapping })).valid).toBe(false);
  });
  it('returns exact row/field errors for missing narrative/date and unsupported discipline', async () => {
    const result = await parseFieldReportFile(file(`${header}\n,Rack B,,R. Das,Unknown`));
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'required_value', rowNumber: 2, field: 'field_text' }),
      expect.objectContaining({ code: 'required_value', rowNumber: 2, field: 'reported_date' }),
      expect.objectContaining({ code: 'unsupported_discipline', rowNumber: 2, field: 'discipline' }),
    ]));
  });
  it.each(['', '   ', 'field_text,reported_date'])('rejects empty/header-only content %s', async csv => {
    const result = await parseFieldReportFile(file(csv)); expect(result.valid).toBe(false); expect(codes(result)).toContain('empty_file');
  });
  it('keeps interior blank rows visible and numbered; ignores only the final record terminator', async () => {
    const result = await parseFieldReportFile(file(`${header}\n${body}\n\n${body.replace('Rack B welding', 'Rack C welding')}\n`));
    expect(result.rows.map(row => row.rowNumber)).toEqual([2, 3, 4]);
    expect(result.rows[1].errors.map(error => error.code)).toContain('empty_row');
    expect(result.summary).toEqual({ totalRows: 3, validRows: 2, invalidRows: 1 });
  });
  it.each([`${header}\n"unterminated,Rack B,2026-10-11,R. Das,Piping`, `${header}\n${body},extra`, `${header}\nFinished,Rack B`])('rejects malformed CSV rows', async csv => {
    expect(codes(await parseFieldReportFile(file(csv)))).toContain('malformed_row');
  });
  it('flags normalized duplicates without silently discarding them or merging distinct evidence', async () => {
    const result = await parseFieldReportFile(file(`${header}\n${body}\n${body.replace('Piping', ' piping ')}\n${body.replace('2026-10-11', '2026-10-12')}`));
    expect(result.valid).toBe(false); expect(result.rows).toHaveLength(3);
    expect(result.rows[1].duplicateOf).toBe(2); expect(result.rows[1].errors[0].code).toBe('duplicate_row');
    expect(result.rows[2].errors).toEqual([]);
  });
  it('accepts exactly the row limit; refuses larger files without a partial success', async () => {
    const csv = 'field_text,reported_date\n' + Array.from({ length: INTAKE_LIMITS.rows }, (_, i) => `Finished ${i},2026-10-11`).join('\n');
    expect((await parseFieldReportFile(file(csv))).valid).toBe(true);
    const result = await parseFieldReportFile(file(csv + '\nOverflow,2026-10-11'));
    expect(codes(result)).toContain('row_limit'); expect(result.rows).toEqual([]);
  });
  it('rejects file size before reading bytes and checks actual buffer size too', async () => {
    const read = vi.fn();
    expect(codes(await parseFieldReportFile({ name: 'a.csv', size: INTAKE_LIMITS.fileBytes + 1, arrayBuffer: read }))).toContain('file_too_large');
    expect(read).not.toHaveBeenCalled();
    expect(codes(await parseFieldReportFile({ ...file(new Uint8Array(INTAKE_LIMITS.fileBytes + 1)), size: 1 }))).toContain('file_too_large');
  });
  it.each(['reports.xls', 'reports.xlsm', 'reports.json', 'reports.csv.exe', 'reports'])('rejects unsupported formats %s', async name => {
    expect(codes(await parseFieldReportFile(file(body, name)))).toContain('unsupported_format');
  });
  it('returns read errors and rejects invalid UTF-8/binary disguised as CSV', async () => {
    expect(codes(await parseFieldReportFile({ name: 'a.csv', size: 1, arrayBuffer: async () => { throw new Error('secret'); } }))).toContain('file_read_error');
    expect(codes(await parseFieldReportFile(file(new Uint8Array([0xff, 0xfe]))))).toContain('malformed_file');
    expect(codes(await parseFieldReportFile(file('PK\0binary')))).toContain('malformed_file');
  });
  it('bounds header width and cell text without evaluating spreadsheet-like narrative', async () => {
    expect(codes(await parseFieldReportFile(file(Array.from({ length: 65 }, (_, i) => `Column${i}`).join(',') + '\na')))).toContain('column_limit');
    expect(codes(await parseFieldReportFile(file(`field_text,reported_date\n${'a'.repeat(10001)},2026-10-11`)))).toContain('cell_too_large');
    const literal = await parseFieldReportFile(file('field_text,reported_date\n=HYPERLINK("example"),2026-10-11'));
    expect(literal.rows[0].data.field_text).toBe('=HYPERLINK("example")'); // Plain text, never executed/exported here.
  });
});

describe('date normalization', () => {
  it.each(['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31', '2026-10-11'])('preserves valid calendar date %s', date => expect(normalizeIntakeDate(date)).toBe(date));
  it.each(['2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '0000-01-01', '11/10/2026', 'today', '2026-10-11T00:00:00Z', '2026-1-1'])('rejects invalid/ambiguous date %s', date => expect(normalizeIntakeDate(date)).toBeNull());
  it('requires explicit regional order and never changes dates to device timezone', () => {
    expect(normalizeIntakeDate('11/10/2026', 'DD/MM/YYYY')).toBe('2026-10-11');
    expect(normalizeIntakeDate('11/10/2026', 'MM/DD/YYYY')).toBe('2026-11-10');
    expect(normalizeIntakeDate(new Date('2026-10-11T00:00:00Z'))).toBe('2026-10-11');
    expect(normalizeIntakeDate(new Date('2026-10-11T12:30:00Z'))).toBeNull();
    expect(normalizeIntakeDate(46306)).toBeNull(); expect(normalizeIntakeDate(new Date('bad'))).toBeNull();
  });
  it('keeps calendar validation errors in preview rows', async () => {
    const result = await parseFieldReportFile(file(`field_text,reported_date\nFinished,2026-02-29`));
    expect(result.rows[0].errors).toContainEqual(expect.objectContaining({ field: 'reported_date', code: 'invalid_date', rowNumber: 2 }));
  });
});

describe('real XLSX parsing and safety', () => {
  it('reads valid XLSX data with the real reader, including explicit sheet selection', async () => {
    const result = await parseFieldReportFile(file(workbook().bytes, 'reports.XLSX'), { sheet: 'Reports' });
    expect(result.valid).toBe(true); expect(result.format).toBe('xlsx'); expect(result.rows[0].data.field_text).toBe('Rack B welding completed');
    expect(result.rows[0].data.reported_date).toBe('2026-10-11');
  });
  it.each([false, true])('handles typed Excel dates using the workbook date system (1904=%s)', async date1904 => {
    const original = workbook(undefined, {}, date1904);
    const xml = new TextDecoder().decode(original.entries['xl/worksheets/sheet1.xml'])
      .replace('<c r="C2" t="inlineStr"><is><t>2026-10-11</t></is></c>', `<c r="C2" s="1"><v>${date1904 ? 44844 : 46306}</v></c>`);
    const result = await parseFieldReportFile(file(workbook(xml, {}, date1904).bytes, 'typed.xlsx'));
    expect(result.valid).toBe(true); expect(result.rows[0].data.reported_date).toBe('2026-10-11');
  });
  it('does not convert unformatted numeric narrative/date cells into invented text/dates', async () => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml'])
      .replace('<c r="C2" t="inlineStr"><is><t>2026-10-11</t></is></c>', '<c r="C2"><v>46306</v></c>');
    expect(codes(await parseFieldReportFile(file(workbook(xml).bytes, 'a.xlsx')))).toContain('invalid_date');
  });
  it.each([
    [1, false, '1900-01-01'], [59, false, '1900-02-28'], [60, false, null],
    [61, false, '1900-03-01'], [0, true, '1904-01-01'], [46306.5, false, null],
  ] as const)('handles early Excel and fractional serial %s (1904=%s)', async (serial, date1904, expected) => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml'])
      .replace('<c r="C2" t="inlineStr"><is><t>2026-10-11</t></is></c>', `<c r="C2" s="1"><v>${serial}</v></c>`);
    const result = await parseFieldReportFile(file(workbook(xml, {}, date1904).bytes, 'a.xlsx'));
    expect(result.valid).toBe(expected != null); expect(result.rows[0].data.reported_date).toBe(expected);
    if (!expected) expect(codes(result)).toContain('invalid_date');
  });
  it.each(['2026-02-29', '1900-02-29', '2026-10-11T12:00:00Z', '2026-10-11T00:00:00+05:30'])('rejects rolled/clock-bearing typed ISO date %s', async value => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml'])
      .replace('<c r="C2" t="inlineStr"><is><t>2026-10-11</t></is></c>', `<c r="C2" t="d"><v>${value}</v></c>`);
    expect(codes(await parseFieldReportFile(file(workbook(xml).bytes, 'a.xlsx')))).toContain('invalid_date');
  });
  it('preserves real typed ISO dates even with a regional text-date mapping', async () => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml'])
      .replace('<c r="C2" t="inlineStr"><is><t>2026-10-11</t></is></c>', '<c r="C2" t="d"><v>2026-10-11T00:00:00Z</v></c>');
    const result = await parseFieldReportFile(file(workbook(xml).bytes, 'a.xlsx'), { dateFormat: 'DD/MM/YYYY' });
    expect(result.valid).toBe(true); expect(result.rows[0].data.reported_date).toBe('2026-10-11');
  });
  it('retains explicit blank spreadsheet rows as row-level errors', async () => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml'])
      .replace('A1:E2', 'A1:E3').replace('</sheetData>', '<row r="3"><c r="A3"/></row></sheetData>');
    const result = await parseFieldReportFile(file(workbook(xml).bytes, 'a.xlsx'));
    expect(result.rows).toHaveLength(2); expect(result.rows[1].rowNumber).toBe(3);
    expect(result.rows[1].errors).toContainEqual(expect.objectContaining({ code: 'empty_row', rowNumber: 3 }));
  });
  it('rejects duplicate and inconsistent cell references rather than accepting an overwritten value', async () => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml']);
    for (const modified of [xml.replace('r="C2"', 'r="A2"'), xml.replace('r="C2"', 'r="C3"')]) {
      expect(codes(await parseFieldReportFile(file(workbook(modified).bytes, 'a.xlsx')))).toContain('malformed_file');
    }
  });
  it('rejects unknown sheets, bad ZIP/XML and truncated workbooks', async () => {
    expect(codes(await parseFieldReportFile(file(workbook().bytes, 'a.xlsx'), { sheet: 'Missing' }))).toContain('malformed_file');
    expect(codes(await parseFieldReportFile(file('not a workbook', 'a.xlsx')))).toContain('malformed_file');
    expect(codes(await parseFieldReportFile(file(workbook('<bad>').bytes, 'a.xlsx')))).toContain('malformed_file');
    expect(codes(await parseFieldReportFile(file(workbook().bytes.slice(0, -22), 'a.xlsx')))).toContain('malformed_file');
  });
  it('rejects formula cells even when a plausible cached value is present', async () => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml']).replace('<c r="C2" t="inlineStr"><is><t>2026-10-11</t></is></c>', '<c r="C2" s="1"><f>TODAY()</f><v>46306</v></c>');
    expect(codes(await parseFieldReportFile(file(workbook(xml).bytes, 'a.xlsx')))).toContain('unsafe_workbook');
  });
  it('rejects external links, macros and XML entities without following/executing them', async () => {
    const extras: Record<string, Uint8Array>[] = [
      { 'xl/evil.rels': strToU8('<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>') },
      { 'xl/vbaProject.bin': new Uint8Array([1, 2, 3]) },
      { 'xl/evil.xml': strToU8('<!DOCTYPE x [<!ENTITY a "evidence">]><x>&a;</x>') },
    ];
    for (const extra of extras) expect(codes(await parseFieldReportFile(file(workbook(undefined, extra).bytes, 'a.xlsx')))).toContain('unsafe_workbook');
  });
  it('bounds actual expanded ZIP content even when compressed input is tiny', async () => {
    const result = await parseFieldReportFile(file(workbook(undefined, { 'xl/large.xml': strToU8('x'.repeat(8 * 1024 * 1024 + 1)) }).bytes, 'bomb.xlsx'));
    expect(codes(result)).toContain('unsafe_workbook'); expect(result.rows).toEqual([]);
  });
  it('rejects sparse giant cell references and dimensions before the reader allocates rows', async () => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml']);
    for (const modified of [xml.replace('A1:E2', 'A1:XFD1048576'), xml.replace('r="C2"', 'r="C1048576"'), xml.replace('r="C2"', 'r="XFD2"')]) {
      expect(codes(await parseFieldReportFile(file(workbook(modified).bytes, 'a.xlsx')))).toContain('unsafe_workbook');
    }
  });
  it('uses the same missing-column and duplicate validation as CSV', async () => {
    const xml = new TextDecoder().decode(workbook().entries['xl/worksheets/sheet1.xml']);
    expect(codes(await parseFieldReportFile(file(workbook(xml.replace('<t>reported_date</t>', '<t>Day</t>')).bytes, 'a.xlsx')))).toContain('missing_column');
    const row2 = /<row r="2">.*?<\/row>/.exec(xml)![0];
    const duplicated = xml.replace('</sheetData>', row2.replace(/([A-E])2/g, '$13').replace('r="2"', 'r="3"') + '</sheetData>').replace('A1:E2', 'A1:E3');
    const result = await parseFieldReportFile(file(workbook(duplicated).bytes, 'a.xlsx'));
    expect(codes(result)).toContain('duplicate_row'); expect(result.rows[1].duplicateOf).toBe(2);
  });
});
