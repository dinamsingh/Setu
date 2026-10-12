import { Unzip, UnzipInflate, zipSync, strFromU8 } from 'fflate';
import { readSheet } from 'read-excel-file/universal';
import { INTAKE_LIMITS, normalizeIntakeDate } from './fieldReportIntake';

const expandedLimit = 16 * 1024 * 1024;
const entryLimit = 8 * 1024 * 1024;
const reject = (message: string): never => { throw new Error(`INTAKE_LIMIT:${message}`); };

/** Bound actual decompressed bytes, not untrusted ZIP size declarations. No extraction to disk. */
function boundedArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length < 22 || new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) !== 0x04034b50) throw new Error('Not XLSX ZIP');
  const files: Record<string, Uint8Array> = Object.create(null);
  const names = new Set<string>(); let total = 0; let completed = 0;
  const archive = new Unzip(file => {
    if (names.size >= 128) reject('Workbook has too many ZIP entries.');
    if (names.has(file.name) || file.name.startsWith('/') || file.name.includes('\\') || file.name.split('/').includes('..')) throw new Error('Unsafe/duplicate ZIP path');
    names.add(file.name);
    if (file.compression !== 0 && file.compression !== 8) throw new Error('Unsupported compression');
    let length = 0; const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      total += chunk.length; length += chunk.length;
      if (total > expandedLimit || length > entryLimit) { file.terminate(); reject('Workbook exceeds decompressed size limits.'); }
      chunks.push(chunk);
      if (final) {
        const contents = new Uint8Array(length); let offset = 0;
        for (const part of chunks) { contents.set(part, offset); offset += part.length; }
        files[file.name] = contents; completed++;
      }
    };
    file.start();
  });
  archive.register(UnzipInflate);
  // Small compressed chunks bound allocation overshoot even when ZIP headers lie.
  for (let offset = 0; offset < bytes.length; offset += 1024) archive.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || completed !== names.size || !completed || view.getUint16(end + 10, true) !== completed
    || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
    || view.getUint32(end + 16, true) + view.getUint32(end + 12, true) !== end) throw new Error('Incomplete/unsupported ZIP');
  return files;
}

export async function readIntakeWorkbook(buffer: ArrayBuffer, sheet: string | number = 1): Promise<unknown[][]> {
  if ((typeof sheet === 'number' && (!Number.isInteger(sheet) || sheet < 1)) || (typeof sheet === 'string' && !sheet.trim())) throw new Error('Invalid sheet selection');
  const files = boundedArchive(new Uint8Array(buffer));
  if (!files['[Content_Types].xml'] || !files['xl/workbook.xml']) throw new Error('Not an XLSX workbook');
  const documents = new Map<string, Document>();
  for (const [name, bytes] of Object.entries(files)) {
    if (/\.bin$/i.test(name)) reject('Macro/binary workbook parts are not supported.');
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const xml = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) reject('XML declarations/entities are not supported.');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length) throw new Error('Malformed workbook XML');
    documents.set(name, document);
    const elements = Array.from(document.getElementsByTagName('*'));
    if (elements.some(element => element.localName === 'Relationship' && element.getAttribute('TargetMode')?.toLowerCase() === 'external')) reject('External workbook relationships are not supported.');
    if (!/^xl\/worksheets\/.*\.xml$/i.test(name)) continue;
    if (elements.some(element => element.localName === 'f')) reject('Formula cells are not accepted as field evidence. Export values only.');
    const rows = elements.filter(element => element.localName === 'row');
    if (rows.length > INTAKE_LIMITS.rows + 1) reject('Worksheet exceeds the row limit.');
    let previousRow = 0;
    for (const row of rows) {
      const number = Number(row.getAttribute('r'));
      if (!Number.isInteger(number) || number < 1 || number > INTAKE_LIMITS.rows + 1) reject('Worksheet row references exceed intake limits.');
      if (number <= previousRow) throw new Error('Duplicate/out-of-order worksheet rows');
      previousRow = number;
    }
    const references = new Set<string>();
    for (const cell of elements.filter(element => element.localName === 'c')) {
      const match = /^([A-Z]+)([1-9]\d*)$/.exec(cell.getAttribute('r') ?? '');
      if (!match) throw new Error('Invalid cell reference');
      const column = [...match[1]].reduce((sum, character) => sum * 26 + character.charCodeAt(0) - 64, 0);
      if (column > INTAKE_LIMITS.columns || Number(match[2]) > INTAKE_LIMITS.rows + 1) reject('Worksheet cell references exceed intake limits.');
      if (references.has(match[0]) || cell.parentElement?.getAttribute('r') !== match[2]) throw new Error('Duplicate/inconsistent cell reference');
      references.add(match[0]);
    }
    // Conservative bounds also cover inflated dimension metadata from spreadsheet editors.
    for (const dimension of elements.filter(element => element.localName === 'dimension')) {
      for (const reference of (dimension.getAttribute('ref') ?? '').split(':')) {
        const match = /^([A-Z]+)([1-9]\d*)$/.exec(reference);
        if (!match) throw new Error('Invalid worksheet dimensions');
        const column = [...match[1]].reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0);
        if (column > INTAKE_LIMITS.columns || Number(match[2]) > INTAKE_LIMITS.rows + 1) reject('Worksheet dimensions exceed intake limits.');
      }
    }
  }
  // Repack verified, bounded contents so the reader never inflates untrusted input itself.
  const safeBytes = zipSync(files, { level: 0 });
  const data: unknown[][] = await readSheet(safeBytes.buffer as ArrayBuffer, sheet, { trim: false });
  const workbook = documents.get('xl/workbook.xml')!;
  const sheets = Array.from(workbook.getElementsByTagNameNS('*', 'sheet'));
  const selected = typeof sheet === 'number' ? sheets[sheet - 1] : sheets.find(element => element.getAttribute('name') === sheet);
  const relationshipId = selected?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relationship = Array.from(documents.get('xl/_rels/workbook.xml.rels')?.getElementsByTagNameNS('*', 'Relationship') ?? [])
    .find(element => element.getAttribute('Id') === relationshipId);
  const target = relationship?.getAttribute('Target');
  if (!target) throw new Error('Missing worksheet relationship');
  const sheetDocument = documents.get(new URL(target, 'https://intake.invalid/xl/workbook.xml').pathname.slice(1));
  if (!sheetDocument) throw new Error('Missing worksheet');
  const epoch1904 = ['1', 'true'].includes(workbook.getElementsByTagNameNS('*', 'workbookPr')[0]?.getAttribute('date1904') ?? '');
  const sourceRows = Array.from(sheetDocument.getElementsByTagNameNS('*', 'row'));
  // The reader trims bottom blank rows. Preserve explicit source rows for honest previews.
  const lastRow = Math.max(0, ...sourceRows.map(row => Number(row.getAttribute('r'))));
  while (data.length < lastRow) data.push(Array(data[0]?.length ?? 0).fill(null));
  for (const cell of Array.from(sheetDocument.getElementsByTagNameNS('*', 'c'))) {
    const [, letters, rowText] = /^([A-Z]+)([1-9]\d*)$/.exec(cell.getAttribute('r')!)!;
    const column = [...letters].reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0) - 1;
    const row = Number(rowText) - 1;
    if (!(data[row]?.[column] instanceof Date)) continue;
    const raw = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent ?? '';
    if (cell.getAttribute('t') === 'd') {
      // JS Date rolls invalid leap dates forward. Validate original date text, not that rollover.
      const calendar = raw.replace(/T00:00:00(?:\.0{1,3})?Z$/, '');
      const normalized = normalizeIntakeDate(calendar);
      data[row][column] = normalized ? new Date(`${normalized}T00:00:00Z`) : raw;
    } else {
      const serial = Number(raw);
      // Reject fractional days and Excel's fictional 1900-02-29; correct pre-March serials.
      if (!Number.isInteger(serial) || serial < (epoch1904 ? 0 : 1) || (!epoch1904 && serial === 60)) data[row][column] = raw;
      else {
        const epoch = Date.parse(epoch1904 ? '1904-01-01T00:00:00Z' : '1899-12-31T00:00:00Z');
        data[row][column] = new Date(epoch + (serial - (!epoch1904 && serial > 60 ? 1 : 0)) * 86400000);
      }
    }
  }
  return data;
}
