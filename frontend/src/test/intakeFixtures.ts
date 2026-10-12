import { zipSync, strToU8 } from 'fflate';

export function intakeFile(contents: string | Uint8Array, name = 'reports.csv'): File {
  const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
  const file = new File([bytes.slice().buffer as ArrayBuffer], name);
  // jsdom File does not implement arrayBuffer; this matches the browser contract.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer as ArrayBuffer });
  return file;
}

export function intakeXlsx(): File {
  const row = (number: number, cells: string[]) => `<row r="${number}">${cells.map((value, index) => `<c r="${String.fromCharCode(65 + index)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
  return intakeFile(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    'xl/workbook.xml': strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reports" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData>${row(1, ['Field update', 'Report date'])}${row(2, ['Welding finished', '2026-10-11'])}</sheetData></worksheet>`),
  }), 'reports.xlsx');
}
