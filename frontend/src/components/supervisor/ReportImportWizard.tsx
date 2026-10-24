import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, LockKeyhole, Upload, X } from 'lucide-react';
import { INTAKE_DISCIPLINES, INTAKE_LIMITS, normalizeIntakeDate, parseFieldReportFile, revalidateIntakePreview,
  type ColumnMapping, type IntakeCorrections, type IntakeField, type IntakeOptions, type IntakePreviewRow } from '../../lib/fieldReportIntake';
import { ReportImportConfirmation, type ImportSubmitter } from './ReportImportConfirmation';
import { isFieldReportImportEnabled } from '../../lib/fieldReportImportDeployment';

const fieldDetails: { key: IntakeField; label: string; required?: boolean; example: string }[] = [
  { key: 'field_text', label: 'Field update', required: true, example: 'Rack B piping spool welding completed' },
  { key: 'reported_date', label: 'Report date', required: true, example: 'The date the site update was reported' },
  { key: 'site_location', label: 'Site / area', example: 'Rack B or Manifold Area A' },
  { key: 'reported_by', label: 'Reported by', example: 'Name of the site engineer or supervisor' },
  { key: 'discipline', label: 'Discipline', example: 'Piping, Pipeline, Civil, Electrical, Mechanical, Instrumentation' },
];
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';
const secondary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#007AFF] hover:bg-slate-50 ${focus}`;
const primary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-5 py-3 text-sm font-semibold text-white hover:bg-[#0066D6] disabled:cursor-not-allowed disabled:opacity-40 ${focus}`;
const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-[#112344] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
const pageSize = 25;

function cellText(value: unknown, format: IntakeOptions['dateFormat']): string {
  if (value instanceof Date) {
    const iso = normalizeIntakeDate(value);
    if (!iso) return 'Invalid spreadsheet date';
    const [year, month, day] = iso.split('-');
    return format === 'DD/MM/YYYY' ? `${day}/${month}/${year}` : format === 'MM/DD/YYYY' ? `${month}/${day}/${year}` : iso;
  }
  return value == null ? '' : String(value);
}

export function ReportImportWizard({ onCancel, submitter, onLockChange, onCompleted }: {
  onCancel: () => void; submitter?: ImportSubmitter; onLockChange?: (locked: boolean) => void; onCompleted?: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateFormat, setDateFormat] = useState<IntakeOptions['dateFormat']>('YYYY-MM-DD');
  const [source, setSource] = useState<Awaited<ReturnType<typeof parseFieldReportFile>> | null>(null);
  const [corrections, setCorrections] = useState<IntakeCorrections>({});
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { onLockChange?.(submissionLocked); return () => onLockChange?.(false); }, [submissionLocked, onLockChange]);
  useEffect(() => {
    if (!file) return;
    let ignore = false;
    void parseFieldReportFile(file, { columnMapping: mapping, dateFormat }).then(result => {
      if (!ignore) { setSource(result); setBusy(false); }
    }).catch(() => {
      if (!ignore) { setSource(null); setReadError('Could not read this file. Choose it again or save a fresh CSV/XLSX copy.'); setBusy(false); }
    });
    return () => { ignore = true; };
  }, [file, mapping, dateFormat]);

  const preview = useMemo(() => source ? revalidateIntakePreview(source, corrections, dateFormat) : null, [source, corrections, dateFormat]);
  const fileIssues = source?.errors.filter(error => error.rowNumber == null) ?? [];
  const fatalIssues = fileIssues.filter(error => !['missing_column', 'invalid_mapping', 'ambiguous_column'].includes(error.code)
    || (error.code === 'ambiguous_column' && !error.field));
  const canMap = !busy && !!source?.headers.length && !fatalIssues.length;
  const canReview = !busy && !!source?.rows.length && !fileIssues.length;
  const rows = preview?.rows.filter(row => filter === 'all' || (filter === 'invalid' ? row.errors.length > 0 : !row.errors.length)) ?? [];
  const duplicates = preview?.rows.filter(row => row.duplicateOf != null).length ?? 0;
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const visiblePage = Math.min(page, lastPage);

  const changeFile = () => {
    setFile(null); setSource(null); setMapping({}); setCorrections({}); setDateFormat('YYYY-MM-DD');
    setReadError(null); setBusy(false); setFilter('all'); setPage(0); setStep(1);
    if (fileInput.current) fileInput.current.value = '';
  };
  const chooseFile = (selected: File | undefined) => {
    if (!selected) return;
    setSource(null); setMapping({}); setCorrections({}); setDateFormat('YYYY-MM-DD'); setReadError(null); setBusy(true); setFile(selected);
    setFilter('all'); setPage(0);
  };
  const valueFor = (row: IntakePreviewRow, field: IntakeField) => corrections[row.rowNumber]?.[field]
    ?? cellText(source?.columnMapping[field] == null ? null : row.raw[source.columnMapping[field]!], dateFormat);
  const correct = (rowNumber: number, field: IntakeField, value: string) => {
    setCorrections(current => ({ ...current, [rowNumber]: { ...current[rowNumber], [field]: value } }));
  };

  return <section aria-label="Field report import" aria-busy={busy} className="min-w-0">
    <div className="mb-6 flex items-center justify-between gap-3">
      <button type="button" disabled={submissionLocked} onClick={() => step === 1 ? onCancel() : setStep(step === 3 ? 2 : 1)} className={`${secondary} border-transparent bg-transparent px-0 disabled:opacity-40`}>
        <ArrowLeft size={17} aria-hidden="true" />{step === 1 ? 'New field update' : 'Back'}</button>
      <button type="button" disabled={submissionLocked} onClick={onCancel} className={`${secondary} border-transparent bg-transparent disabled:opacity-40`}><X size={16} aria-hidden="true" />Cancel</button>
    </div>
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#55769E]">New field update / Import reports</p>
        <h1 ref={heading} tabIndex={-1} className="mt-2 text-3xl font-bold tracking-tight outline-none sm:text-4xl">{step === 1 ? 'Bring your site reports.' : step === 2 ? 'Match your columns.' : 'Check every report.'}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{step === 1 ? 'Import multiple field reports from a CSV/XLSX spreadsheet. Map the columns and check each row. Your unsent field update stays separate.' : step === 2 ? 'Tell SETU which column holds each detail. Required fields cannot be skipped.' : 'Correct the details below. Changes stay in this browser session, not in your spreadsheet or Site Log.'}</p></div>
      <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#007AFF]"><LockKeyhole size={14} aria-hidden="true" />{isFieldReportImportEnabled() ? 'Review before submission' : 'Local preview · submission locked'}</span>
    </div>
    <ol aria-label="Import steps" className="mb-7 grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {['Choose file', 'Map columns', 'Review & correct'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined}
        className={`flex flex-col gap-2 border-r border-slate-200 px-3 py-4 last:border-0 sm:flex-row sm:items-center sm:gap-3 sm:px-5 ${step === index + 1 ? 'bg-[#EAF2FC]' : ''}`}>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step >= index + 1 ? 'bg-[#007AFF] text-white' : 'bg-slate-100 text-slate-500'}`}>{step > index + 1 ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
        <span className={`text-xs font-semibold sm:text-sm ${step === index + 1 ? 'text-[#007AFF]' : 'text-slate-500'}`}>{label}</span></li>)}
    </ol>

    {step === 1 && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <label htmlFor="intake-file" className={`flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-200 bg-[#F7FAFE] p-5 text-center focus-within:ring-2 focus-within:ring-blue-500`}>
          <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-[#007AFF]"><Upload size={25} aria-hidden="true" /></span>
          <span className="text-lg font-bold">Choose a CSV or Excel file</span><span className="mt-2 text-sm text-slate-500">.csv or .xlsx · up to 2 MiB · 1,000 report rows</span>
          <input ref={fileInput} id="intake-file" aria-label="Choose CSV or XLSX file" type="file" accept=".csv,.xlsx" onChange={e => chooseFile(e.target.files?.[0])}
            className="mt-5 block w-full max-w-sm text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#007AFF] file:px-4 file:py-3 file:font-semibold file:text-white" />
        </label>
        {file && <div className="mt-5 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3"><FileSpreadsheet size={20} className="shrink-0 text-[#007AFF]" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="break-all text-sm font-semibold">{file.name}</p><p className="mt-1 text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KiB · {source?.format === 'xlsx' ? 'First worksheet only' : 'CSV records include a header row'}</p></div></div>}
        {readError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{readError}</p>}
        {fatalIssues.length > 0 && <div role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800"><p className="mb-2 font-semibold">This file needs attention</p><ul className="list-disc space-y-1 pl-5">{fatalIssues.map((error, index) => <li key={index}>{error.message}</li>)}</ul><p className="mt-3">Fix the spreadsheet, split large files, or save a plain CSV/XLSX copy, then choose it again.</p></div>}
        <div className="mt-6 flex justify-end"><button type="button" disabled={!canMap} onClick={() => setStep(2)} className={primary}>Map columns <ArrowRight size={16} aria-hidden="true" /></button></div>
      </div>
      <aside className="rounded-2xl border border-slate-200 bg-[#EAF2FC] p-6"><p className="text-xs font-bold uppercase tracking-widest text-[#55769E]">Before you begin</p><h2 className="mt-3 text-xl font-bold">One row. One field report.</h2>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-slate-600"><li>Put column names in the first row.</li><li>Include a written field update and report date.</li><li>Site, reporter and discipline are optional.</li><li>For Excel, place reports on the first worksheet. Remove formulas and external links.</li></ul>
        <p className="mt-6 border-t border-blue-200 pt-4 text-xs leading-5 text-[#55769E]">The file stays in your browser. Only confirmed report rows can be sent after deployment is verified.</p></aside>
    </div>}

    {step > 1 && readError && <div role="alert" className="mb-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800"><p>{readError}</p><button type="button" onClick={changeFile} className={`${secondary} mt-3`}>Change file</button></div>}
    {step === 2 && source && <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-all text-sm font-semibold">{file?.name}<span className="ml-2 font-normal text-slate-500">· {source.headers.length} columns</span></p><button type="button" onClick={changeFile} className={secondary}>Change file</button></div>
      <div className="mb-5 rounded-xl bg-blue-50 p-4 text-sm leading-6 text-[#007AFF]">Known headers are detected automatically. If more than one column could fit, choose one yourself. Changing a mapping or date format clears local row corrections.</div>
      <div className="hidden grid-cols-[1fr_1fr] gap-5 border-b border-slate-200 pb-3 text-xs font-bold uppercase tracking-widest text-slate-500 md:grid"><span>SETU field</span><span>Your spreadsheet column</span></div>
      {fieldDetails.map(field => <div key={field.key} className="grid gap-3 border-b border-slate-100 py-5 md:grid-cols-2 md:items-start md:gap-5">
        <div><label htmlFor={`map-${field.key}`} className="text-sm font-bold">{field.label} <span className={`ml-2 text-xs font-medium ${field.required ? 'text-[#007AFF]' : 'text-slate-500'}`}>{field.required ? 'Required' : 'Optional'}</span></label><p className="mt-1 text-xs leading-5 text-slate-500">{field.example}</p></div>
        <div><select id={`map-${field.key}`} value={Object.hasOwn(mapping, field.key) ? mapping[field.key] ?? '' : source.columnMapping[field.key] ?? ''}
          onChange={e => { setBusy(true); setCorrections({}); setMapping(current => ({ ...current, [field.key]: e.target.value === '' ? null : Number(e.target.value) })); }}
          aria-describedby={`map-help-${field.key}`} aria-required={!!field.required} aria-invalid={fileIssues.some(error => error.field === field.key)} className={inputClass}>
          <option value="">{field.required ? 'Choose a column' : 'Not provided'}</option>{source.headers.map((header, index) => <option value={index} key={index}>{index + 1}. {header}</option>)}</select>
          <div id={`map-help-${field.key}`} className="mt-2 text-xs text-rose-700">{fileIssues.filter(error => error.field === field.key).map((error, index) => <p key={index}>{error.code === 'missing_column' ? `Choose the column containing ${field.label.toLowerCase()}.` : error.message}</p>)}</div></div>
      </div>)}
      <label className="mt-5 block max-w-md text-sm font-bold">Dates written in your file<select aria-label="Spreadsheet date format" value={dateFormat}
        onChange={e => { setBusy(true); setCorrections({}); setDateFormat(e.target.value as IntakeOptions['dateFormat']); }} className={`${inputClass} mt-2 font-normal`}>
        <option value="YYYY-MM-DD">YYYY-MM-DD · 2026-10-11</option><option value="DD/MM/YYYY">DD/MM/YYYY · 11/10/2026</option><option value="MM/DD/YYYY">MM/DD/YYYY · 10/11/2026</option></select></label>
      <p className="mt-2 text-xs leading-5 text-slate-500">SETU never guesses day/month order. Typed Excel dates retain their calendar date.</p>
      {fileIssues.filter(error => !error.field).map((error, index) => <p role="alert" key={index} className="mt-4 text-sm text-rose-700">{error.message}</p>)}
      {readError && <p role="alert" className="mt-4 text-sm text-rose-700">{readError}</p>}
      <div className="mt-7 flex justify-end"><button type="button" disabled={!canReview} onClick={() => { setStep(3); setPage(0); }} className={primary}>Review reports <ArrowRight size={16} aria-hidden="true" /></button></div>
    </div>}

    {step === 3 && preview && <div>
      <fieldset disabled={submissionLocked || busy} className="min-w-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-all text-sm font-semibold">{file?.name}</p><button type="button" onClick={changeFile} className={secondary}>Change file</button></div>
      <div aria-label="Row counts" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
        ['Total rows', preview.summary.totalRows], ['Valid locally', preview.summary.validRows], ['Needs correction', preview.summary.invalidRows], ['Duplicates', duplicates],
      ].map(([label, count]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-4"><p className="text-xs font-medium text-slate-500">{label}</p><p data-count={label} className={`mt-2 text-2xl font-bold tabular-nums ${label === 'Needs correction' && Number(count) ? 'text-amber-700' : 'text-[#007AFF]'}`}>{count}</p></div>)}</div>
      <p className="mb-5 text-xs leading-5 text-slate-500">Duplicates are included in “Needs correction.” Row numbers refer to spreadsheet rows / CSV records, including the header. Structural row errors require fixing the source file. All edits revalidate immediately.</p>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-4 sm:p-5"><h2 className="text-lg font-bold">Report review</h2>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Show<select aria-label="Filter report rows" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }} className={`${inputClass} w-auto`}><option value="all">All reports</option><option value="invalid">Needs correction</option><option value="valid">Valid locally</option></select></label></div>
        <div className="hidden grid-cols-[90px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-5 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 lg:grid"><span>Row / status</span><span>Field update</span><span>Site context</span><span>Date / discipline</span></div>
        {rows.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize).map(row => <article key={row.rowNumber} aria-label={`Spreadsheet row ${row.rowNumber}`} data-testid={`intake-row-${row.rowNumber}`}
          className="grid gap-4 border-b border-slate-200 p-4 last:border-0 sm:p-5 lg:grid-cols-[90px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-5">
          <div className="flex items-center gap-3 lg:block"><h3 className="font-mono text-sm font-bold">Row {row.rowNumber}</h3><span className={`inline-block rounded-lg px-2 py-1 text-[11px] font-semibold lg:mt-2 ${row.errors.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{row.duplicateOf != null ? 'Duplicate' : row.errors.length ? 'Check row' : 'Valid locally'}</span></div>
          <div><label htmlFor={`row-${row.rowNumber}-field_text`} className="mb-2 block text-xs font-semibold text-slate-600">Field update <span className="text-blue-700">Required</span></label>
            <textarea id={`row-${row.rowNumber}-field_text`} rows={3} maxLength={INTAKE_LIMITS.cellChars} value={valueFor(row, 'field_text')}
              onChange={e => correct(row.rowNumber, 'field_text', e.target.value)} aria-required="true" aria-invalid={row.errors.some(error => error.field === 'field_text')}
              aria-describedby={row.errors.length ? `row-${row.rowNumber}-errors` : undefined} className={`${inputClass} min-h-24 resize-y leading-6`} /></div>
          <div className="space-y-4">{(['site_location', 'reported_by'] as const).map(field => <label key={field} className="block text-xs font-semibold text-slate-600">{field === 'site_location' ? 'Site / area' : 'Reported by'} <span className="font-normal">Optional</span><input aria-label={`Row ${row.rowNumber} ${field === 'site_location' ? 'Site / area' : 'Reported by'}`} maxLength={INTAKE_LIMITS.cellChars}
            value={valueFor(row, field)} onChange={e => correct(row.rowNumber, field, e.target.value)} aria-invalid={row.errors.some(error => error.field === field)} aria-describedby={row.errors.length ? `row-${row.rowNumber}-errors` : undefined} className={`${inputClass} mt-2 font-normal`} /></label>)}</div>
          <div className="space-y-4"><label className="block text-xs font-semibold text-slate-600">Report date <span className="text-blue-700">Required</span><input aria-label={`Row ${row.rowNumber} Report date`} value={valueFor(row, 'reported_date')} placeholder={dateFormat} maxLength={INTAKE_LIMITS.cellChars}
            onChange={e => correct(row.rowNumber, 'reported_date', e.target.value)} aria-required="true" aria-invalid={row.errors.some(error => error.field === 'reported_date')} aria-describedby={row.errors.length ? `row-${row.rowNumber}-errors` : undefined} className={`${inputClass} mt-2 font-normal`} /></label>
            <label className="block text-xs font-semibold text-slate-600">Discipline <span className="font-normal">Optional</span><select aria-label={`Row ${row.rowNumber} Discipline`} value={valueFor(row, 'discipline')} onChange={e => correct(row.rowNumber, 'discipline', e.target.value)}
              aria-invalid={row.errors.some(error => error.field === 'discipline')} aria-describedby={row.errors.length ? `row-${row.rowNumber}-errors` : undefined} className={`${inputClass} mt-2 font-normal`}><option value="">Not provided</option>
              {!!valueFor(row, 'discipline') && !INTAKE_DISCIPLINES.some(d => d === valueFor(row, 'discipline')) && <option value={valueFor(row, 'discipline')}>{valueFor(row, 'discipline')} (as written)</option>}
              {INTAKE_DISCIPLINES.map(d => <option key={d}>{d}</option>)}</select></label></div>
          {row.errors.length > 0 && <ul id={`row-${row.rowNumber}-errors`} className="list-disc space-y-1 rounded-xl bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-900 lg:col-start-2 lg:col-span-3">{row.errors.map((error, index) => <li key={index}>{error.message}{error.code === 'malformed_row' ? ' Fix this row in the source spreadsheet and change the file.' : ''}</li>)}</ul>}
        </article>)}
        {!rows.length && <p className="p-8 text-center text-sm text-slate-500">No reports in this view. Choose another filter.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4"><p className="text-xs text-slate-500">{rows.length ? `${visiblePage * pageSize + 1}–${Math.min((visiblePage + 1) * pageSize, rows.length)} of ${rows.length} reports` : '0 reports'}</p>
          <div className="flex gap-2"><button type="button" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)} className={`${secondary} disabled:opacity-40`}>Previous</button><button type="button" disabled={visiblePage === lastPage} onClick={() => setPage(visiblePage + 1)} className={`${secondary} disabled:opacity-40`}>Next</button></div></div>
      </div>
      </fieldset>
      <ReportImportConfirmation preview={preview} submitter={submitter} onLockChange={setSubmissionLocked} onCompleted={onCompleted} />
    </div>}
    <p role="status" aria-live="polite" className={`mt-4 text-xs text-slate-500 ${busy ? '' : 'sr-only'}`}>{busy ? 'Reading and validating your file…' : step === 3 && preview ? `${preview.summary.validRows} valid locally, ${preview.summary.invalidRows} need correction.` : source ? 'File checked locally.' : ''}</p>
    <p className="mt-6 text-xs leading-5 text-slate-500">{submissionLocked ? 'Finish or resolve this request before leaving. An interrupted request is not proof of cancellation.' : 'Cancel returns to your unsent field update and discards the local preview.'} The original spreadsheet is never changed.</p>
  </section>;
}
