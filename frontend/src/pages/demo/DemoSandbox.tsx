import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { parseFieldReportFile, type IntakeResult } from '../../lib/fieldReportIntake';

/**
 * Credential-free interactive evaluator sandbox.
 *
 * SECURITY BOUNDARY: No AuthContext, Supabase client, RPC, persistent storage,
 * backend fetches, production user records or privileged role switches.
 * This is an interactive illustration of SETU's workflow, NOT live authorization,
 * model inference, a P6 integration or a replacement for production tests.
 */
type Persona = 'supervisor' | 'planner';
type Section = 'capture' | 'import' | 'schedule' | 'review' | 'audit';
type Decision = 'pending' | 'approved' | 'rejected' | 'remapped';
type Source = 'manual_text' | 'voice_transcript' | 'spreadsheet_csv' | 'spreadsheet_xlsx';
type Input = {
  fieldText: string;
  siteLocation: string;
  reportedDate: string;
  reportedBy: string;
  discipline: string;
};
type Activity = {
  id: string;
  name: string;
  start: string;
  finish: string;
  location: string;
  discipline: string;
};

const ACTIVITIES: Activity[] = [
  { id: 'OIL-PIP-202-A', name: 'Piping Spool Erection and Field Fit-up - Manifold A',
    start: '2026-05-22', finish: '2026-06-20', location: 'Manifold A', discipline: 'Piping' },
  { id: 'OIL-PIP-208-A', name: 'Pipe Support Erection, Clamping and Spring Hanger Setup - Area A',
    start: '2026-04-04', finish: '2026-04-26', location: 'Area A', discipline: 'Piping' },
  { id: 'OIL-PIP-209-A', name: 'Piping Line Cleaning, Flushing and Chemical Dewatering - Area A',
    start: '2026-04-16', finish: '2026-05-01', location: 'Area A', discipline: 'Piping' },
];
type Evaluation = {
  suggestedId: string | null;
  candidates: string[];
  confidence: string;
  validation: 'pass' | 'warn' | 'block';
  findings: string[];
};
type DemoReport = Input & {
  id: string;
  source: Source;
  status: Decision;
  evaluation: Evaluation;
  selectedId: string | null;
  overrideReason: string;
};
type AuditEvent = { at: string; action: string; reportId: string; details: string };

const START_INPUT: Input = {
  fieldText: 'SYNTHETIC DEMO ONLY: Spool erection and field fit-up completed at Manifold A. This is not actual site progress.',
  siteLocation: 'Manifold A',
  reportedDate: '2026-06-10',
  reportedBy: 'Fictional Site Observer',
  discipline: 'Piping',
};
const BAD_INPUT: Input = {
  fieldText: 'SYNTHETIC DEMO ONLY: Chemical flushing completed in Area A. Not real construction progress.',
  siteLocation: 'Area A',
  reportedDate: '2026-10-22',
  reportedBy: 'Fictional Site Observer',
  discipline: 'Piping',
};
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

function analyze(input: Input, selectedId?: string | null): Evaluation {
  const words = input.fieldText.toLowerCase();
  const candidates = words.includes('spool') || words.includes('fit-up') ?
    ['OIL-PIP-202-A', 'OIL-PIP-208-A', 'OIL-PIP-209-A'] :
    words.includes('support') || words.includes('hanger') || words.includes('clamping') ?
      ['OIL-PIP-208-A', 'OIL-PIP-202-A', 'OIL-PIP-209-A'] :
      words.includes('flushing') || words.includes('cleaning') || words.includes('dewatering') ?
        ['OIL-PIP-209-A', 'OIL-PIP-208-A', 'OIL-PIP-202-A'] : [];
  const chosen = selectedId || candidates[0] || null;
  const match = ACTIVITIES.find(activity => activity.id === chosen);
  const findings: string[] = [];
  if (!match) findings.push('No supported synthetic activity keyword found. Planner must investigate.');
  if (match) {
    const after = daysBetween(input.reportedDate, match.finish);
    const before = daysBetween(match.start, input.reportedDate);
    if (after > 60) findings.push('Date plausibility BLOCK: report is ' + after + ' days after planned finish (60-day tolerance).');
    if (before > 0) findings.push('Date plausibility BLOCK: report predates the planned activity start.');
    if (!input.siteLocation.toLowerCase().includes(match.location.toLowerCase())) {
      findings.push('Location mismatch: source and selected synthetic activity refer to different areas.');
    }
    if (input.discipline && input.discipline !== match.discipline) {
      findings.push('Discipline mismatch: the selected synthetic activity is ' + match.discipline + '.');
    }
  }
  const blocked = findings.length > 0;
  if (!blocked && candidates.length) findings.push('Synthetic date, location and discipline checks passed.');
  if (!blocked && !selectedId && words.includes('piping') && !words.includes('spool')) {
    findings.push('Candidate ambiguity: verify the selected activity before approval.');
  }
  return {
    suggestedId: chosen,
    candidates,
    confidence: !match ? 'Unmatched' : candidates[0] === 'OIL-PIP-202-A' ? 'High (illustrative)' : 'Medium (illustrative)',
    validation: blocked ? 'block' : findings.some(f => f.includes('ambiguity')) ? 'warn' : 'pass',
    findings,
  };
}

function newReport(id: string, input: Input, source: Source): DemoReport {
  return { ...input, id, source, status: 'pending', selectedId: null,
    evaluation: analyze(input), overrideReason: '' };
}
const START_REPORTS = [
  newReport('DEMO-001', START_INPUT, 'manual_text'),
  newReport('DEMO-002', BAD_INPUT, 'spreadsheet_csv'),
];

function csvValue(value: unknown): string {
  let s = String(value ?? '');
  // Protect spreadsheet users from formula execution in untrusted narratives.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers, ...rows].map(row => row.map(csvValue).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const fieldClass = 'block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400';
const primary = 'rounded-lg bg-blue-700 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400';
const secondary = 'rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400';

export function DemoSandbox() {
  const [persona, setPersona] = useState<Persona>('supervisor');
  const [section, setSection] = useState<Section>('capture');
  const [reports, setReports] = useState<DemoReport[]>(START_REPORTS);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [nextId, setNextId] = useState(3);
  const [form, setForm] = useState<Input>(START_INPUT);
  const [source, setSource] = useState<'manual_text' | 'voice_transcript'>('manual_text');
  const [preview, setPreview] = useState<IntakeResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [selected, setSelected] = useState('DEMO-001');
  const [remarks, setRemarks] = useState('');
  const [remapId, setRemapId] = useState(ACTIVITIES[0].id);
  const [notice, setNotice] = useState('Demo initialized with fictional example reports. No production data is connected.');

  const active = reports.find(report => report.id === selected);
  const pending = reports.filter(report => report.status === 'pending');
  const finalized = reports.filter(report => report.status === 'approved' || report.status === 'remapped');

  const record = (reportId: string, action: string, details: string) => {
    setAudit(items => [...items, { at: new Date().toISOString(), reportId, action, details }]);
  };
  const go = (role: Persona) => {
    setPersona(role);
    setSection(role === 'supervisor' ? 'capture' : 'review');
    setNotice('Switched demo persona to ' + role + '. This is not an authenticated production role.');
  };
  const add = (input: Input, inputSource: Source) => {
    const id = 'DEMO-' + String(nextId).padStart(3, '0');
    setNextId(n => n + 1);
    setReports(items => [...items, newReport(id, input, inputSource)]);
    record(id, 'submitted', inputSource + ' · synthetic browser-only report');
    setSelected(id);
    setNotice(id + ' created inside this browser sandbox. Switch to Planner to review.');
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (form.fieldText.trim().length < 3 || form.siteLocation.trim().length < 2 ||
        !DATE_FORMAT.test(form.reportedDate) || !Number.isFinite(Date.parse(form.reportedDate + 'T00:00:00Z'))) {
      setNotice('Provide a narrative, site location and valid YYYY-MM-DD observation date.');
      return;
    }
    add({ ...form, fieldText: form.fieldText.trim(), siteLocation: form.siteLocation.trim() }, source);
  };
  const readFile = async (file?: File) => {
    setPreview(null);
    if (!file) return;
    setImportBusy(true);
    try {
      const parsed = await parseFieldReportFile(file);
      setPreview(parsed);
      setNotice(parsed.valid ? 'CSV/XLSX parsed with the actual SETU browser intake validator.' :
        'File validation found issues. Correct the source file before importing.');
    } catch {
      setNotice('Could not read the selected file.');
    } finally {
      setImportBusy(false);
    }
  };
  const importRows = () => {
    if (!preview?.valid || !preview.format) return;
    const rows = preview.rows.map(row => row.data);
    let newItems = [...reports];
    let next = nextId;
    let newCount = 0;
    let duplicateCount = 0;
    const newEvents: AuditEvent[] = [];
    const same = (input: Input) => JSON.stringify([
      input.fieldText, input.siteLocation, input.reportedDate, input.reportedBy, input.discipline,
    ]);
    for (const row of rows) {
      const input: Input = {
        fieldText: row.field_text, siteLocation: row.site_location || 'Site Area',
        reportedDate: row.reported_date || '', reportedBy: row.reported_by || 'Demo Reporter',
        discipline: row.discipline || 'Piping',
      };
      if (newItems.some(item => same(item) === same(input))) { duplicateCount++; continue; }
      const id = 'DEMO-' + String(next++).padStart(3, '0');
      newItems.push(newReport(id, input, 'spreadsheet_' + preview.format as Source));
      newEvents.push({ at: new Date().toISOString(), reportId: id,
        action: 'imported', details: preview.format.toUpperCase() + ' synthetic report' });
      newCount++;
    }
    setReports(newItems);
    setNextId(next);
    setAudit(items => [...items, ...newEvents]);
    setPreview(null);
    setNotice(newCount + ' synthetic reports imported to this browser sandbox; ' +
      duplicateCount + ' duplicate reports skipped. Switch to Planner to inspect.');
  };
  const act = (action: 'approve' | 'reject' | 'remap' | 'override') => {
    if (!active || active.status !== 'pending') return;
    const reason = remarks.trim();
    const target = action === 'remap' ? remapId : active.selectedId || active.evaluation.suggestedId;
    const check = action === 'remap' ? analyze(active, target) : active.evaluation;
    if (action === 'approve' && !target) { setNotice('Choose a supported activity first.'); return; }
    if (action === 'approve' && check.validation === 'block' && !active.overrideReason) {
      setNotice('Validation is blocked. Investigate or record an explicit override reason first.');
      return;
    }
    if ((action === 'reject' || action === 'remap' || action === 'override') && reason.length < 10) {
      setNotice('Enter a reason of at least 10 characters for this governed demo action.');
      return;
    }
    if (action === 'remap' && check.validation === 'block' && !active.overrideReason) {
      setNotice('Selected activity still fails checks. Investigate or explicitly override the validation.');
      return;
    }
    const nextStatus: Decision = action === 'approve' ? 'approved' : action === 'remap' ? 'remapped'
      : action === 'reject' ? 'rejected' : 'pending';
    setReports(items => items.map(r => r.id !== active.id ? r : ({
      ...r, status: nextStatus,
      selectedId: action === 'remap' ? target : r.selectedId,
      evaluation: action === 'remap' ? check : r.evaluation,
      overrideReason: action === 'override' ? reason : r.overrideReason,
    })));
    record(active.id, action, (reason || 'Synthetic planner acceptance') + (target ? ' · ' + target : ''));
    setNotice(active.id + ': ' + action + ' saved to the demo audit only.');
    setRemarks('');
  };
  const exportMappings = () => downloadCsv('setu_demo_approved_mappings.csv',
    ['Report ID', 'Activity ID', 'Planner Status', 'Source', 'Narrative'],
    finalized.map(r => [r.id, r.selectedId || r.evaluation.suggestedId, r.status, r.source, r.fieldText]));
  const exportAudit = () => downloadCsv('setu_demo_audit.csv',
    ['Timestamp', 'Report ID', 'Action', 'Details'],
    audit.map(a => [a.at, a.reportId, a.action, a.details]));
  const restart = () => {
    setReports(START_REPORTS); setAudit([]); setNextId(3); setPersona('supervisor');
    setSection('capture'); setSelected('DEMO-001'); setForm(START_INPUT);
    setPreview(null); setRemarks(''); setNotice('Demo restarted. All test changes were discarded.');
  };
  const summary = useMemo(() => ({
    pending: pending.length, approved: finalized.length, blocked: pending.filter(r => r.evaluation.validation === 'block').length,
  }), [pending, finalized]);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-blue-900 bg-slate-950 px-4 py-5 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">SETU · SIH26122</p>
            <h1 className="text-2xl font-extrabold">Interactive Evaluator Demo</h1>
            <p className="text-sm text-slate-300">No email or password · Isolated synthetic browser session</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={secondary} to="/">Real SETU login</Link>
            <button type="button" className={secondary} onClick={restart}>Restart demo</button>
          </div>
        </div>
      </header>
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
        <p className="mx-auto max-w-6xl text-sm text-amber-950">
          <strong>SIMULATED SANDBOX:</strong> Reports, matching suggestions, validation, decisions and audit are interactive
          synthetic examples in browser memory. No Supabase login, live AI model, Primavera writeback, production report
          or database mutation occurs. Refreshing the page resets the demo.
        </p>
      </div>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-center gap-2" aria-label="Demo personas">
            <strong className="mr-2 text-sm">Explore as:</strong>
            <button type="button" onClick={() => go('supervisor')} aria-pressed={persona === 'supervisor'}
              className={persona === 'supervisor' ? primary : secondary}>Site / Supervisor</button>
            <button type="button" onClick={() => go('planner')} aria-pressed={persona === 'planner'}
              className={persona === 'planner' ? primary : secondary}>Planner</button>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900">Demo persona · not a production account</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            ['Pending review', summary.pending], ['Finalized', summary.approved], ['Blocked validations', summary.blocked],
          ].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4">
            <p className="text-xs font-semibold text-slate-600">{label}</p>
            <p className="mt-2 text-3xl font-bold">{value}</p>
          </div>)}
        </div>
        <div role="status" aria-live="polite" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">{notice}</div>
        <nav className="flex flex-wrap gap-2" aria-label="Demo workspace">
          {(persona === 'supervisor' ? [
            ['capture', 'Field Capture'], ['import', 'CSV/XLSX Import'],
          ] : [
            ['review', 'Planner Review'], ['schedule', 'Schedule'], ['audit', 'Audit & Export'],
          ]).map(([key, label]) => <button key={key} type="button" onClick={() => setSection(key as Section)}
            aria-current={section === key ? 'page' : undefined}
            className={section === key ? primary : secondary}>{label}</button>)}
        </nav>
        {persona === 'supervisor' && section === 'capture' && <section className="rounded-xl border bg-white p-5">
          <h2 className="text-xl font-bold">Submit a synthetic field update</h2>
          <p className="mb-5 mt-1 text-sm text-slate-600">Try changing narrative, location and report date to see matching and validation outcomes. Nothing is sent to a server.</p>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-semibold">Narrative
              <textarea required minLength={3} maxLength={4000} rows={4} className={fieldClass}
                value={form.fieldText} onChange={e => setForm({ ...form, fieldText: e.target.value })}/>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Site / area
                <input required minLength={2} className={fieldClass} value={form.siteLocation}
                  onChange={e => setForm({ ...form, siteLocation: e.target.value })}/>
              </label>
              <label className="block text-sm font-semibold">Reported date
                <input type="date" required className={fieldClass} value={form.reportedDate}
                  onChange={e => setForm({ ...form, reportedDate: e.target.value })}/>
              </label>
              <label className="block text-sm font-semibold">Reported by (fictional)
                <input className={fieldClass} value={form.reportedBy}
                  onChange={e => setForm({ ...form, reportedBy: e.target.value })}/>
              </label>
              <label className="block text-sm font-semibold">Discipline
                <select className={fieldClass} value={form.discipline}
                  onChange={e => setForm({ ...form, discipline: e.target.value })}>
                  {['Piping','Pipeline','Civil','Electrical','Mechanical','Instrumentation'].map(x => <option key={x}>{x}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">Input type
                <select className={fieldClass} value={source}
                  onChange={e => setSource(e.target.value as 'manual_text' | 'voice_transcript')}>
                  <option value="manual_text">Typed note</option>
                  <option value="voice_transcript">Voice transcript text (manual simulation)</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">Evidence attachment (local preview only)
                <input type="file" accept="image/*,.pdf" className={fieldClass}
                  onChange={e => setNotice(e.target.files?.[0] ? 'Local file selected: ' + e.target.files[0].name + '. Not uploaded or stored.' : 'No evidence selected.')}/>
              </label>
            </div>
            <button type="submit" className={primary}>Submit to demo review queue</button>
          </form>
        </section>}
        {persona === 'supervisor' && section === 'import' && <section className="rounded-xl border bg-white p-5">
          <h2 className="text-xl font-bold">Import synthetic CSV/XLSX</h2>
          <p className="my-3 text-sm text-slate-600">Uses SETU's existing client-side file parser, mapping and input validation. Import writes only to browser memory.</p>
          <label className="block text-sm font-semibold">Choose file
            <input className={fieldClass} type="file" accept=".csv,.xlsx" onChange={e => { void readFile(e.target.files?.[0]); }}/>
          </label>
          {importBusy && <p role="status" className="mt-3">Validating file...</p>}
          {preview && <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
            <p><strong>{preview.summary.validRows} valid</strong> / {preview.summary.totalRows} rows · {preview.summary.invalidRows} needing correction</p>
            {preview.errors.slice(0,6).map((e,i) => <p role="alert" key={i}>{e.rowNumber ? 'Row ' + e.rowNumber + ': ' : ''}{e.message}</p>)}
            {preview.valid && <button type="button" className={primary} onClick={importRows}>Import all valid rows to demo</button>}
          </div>}
        </section>}
        {persona === 'planner' && section === 'review' && <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-xl border bg-white p-5">
            <h2 className="mb-3 text-xl font-bold">Review Queue</h2>
            <div className="space-y-2">
              {reports.map(r => <button key={r.id} type="button" onClick={() => {setSelected(r.id); setRemapId(r.evaluation.suggestedId || ACTIVITIES[0].id); setRemarks('');}}
                aria-pressed={selected === r.id}
                className={'block w-full rounded-lg border p-3 text-left text-sm ' +
                  (selected === r.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white')}>
                <div className="flex flex-wrap items-center justify-between gap-2"><strong>{r.id}</strong>
                  <span className={r.status === 'pending' && r.evaluation.validation === 'block' ? 'text-red-700' : 'text-emerald-700'}>
                    {r.status === 'pending' ? 'Pending · ' + r.evaluation.validation : r.status}
                  </span></div>
                <p className="mt-2 line-clamp-2 text-slate-600">{r.fieldText}</p>
              </button>)}
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            {!active ? <p>Select a report.</p> : <>
              <h2 className="text-xl font-bold">{active.id}</h2>
              <p className="mt-2 text-sm">{active.fieldText}</p>
              <p className="mt-2 text-xs text-slate-500">{active.siteLocation} · {active.reportedDate} · {active.source}</p>
              <div className="mt-4 rounded-lg bg-slate-100 p-3 text-sm">
                <h3 className="font-bold">Illustrative matching: {active.evaluation.confidence}</h3>
                <p>Selected: {active.selectedId || active.evaluation.suggestedId || 'Unmatched'}</p>
                <p className="mt-2 text-xs">Candidates: {active.evaluation.candidates.join(' · ') || 'none'}</p>
                <h3 className="mt-3 font-bold">Illustrative validation: {active.evaluation.validation.toUpperCase()}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {active.evaluation.findings.map((s,i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              {active.overrideReason && <p className="mt-3 text-sm text-amber-900">Demo override recorded: {active.overrideReason}</p>}
              {active.status === 'pending' ? <div className="mt-4 space-y-3">
                <label className="block text-sm font-semibold">Review justification / reason
                  <textarea rows={2} className={fieldClass} value={remarks}
                    onChange={e => setRemarks(e.target.value)} placeholder="Required for reject, remap or override"/>
                </label>
                <label className="block text-sm font-semibold">Remap candidate
                  <select className={fieldClass} value={remapId} onChange={e => setRemapId(e.target.value)}>
                    {ACTIVITIES.map(a => <option value={a.id} key={a.id}>{a.id} · {a.name}</option>)}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={primary} onClick={() => act('approve')}>Approve</button>
                  <button type="button" className={secondary} onClick={() => act('remap')}>Validate & remap</button>
                  <button type="button" className={secondary} onClick={() => act('reject')}>Reject</button>
                  <button type="button" className={secondary} onClick={() => act('override')}>Record override</button>
                </div>
                <p className="text-xs text-slate-500">All actions are fictional and cannot change the real schedule or reports.</p>
              </div> : <p className="mt-4 font-semibold text-green-700">Demo decision finalized: {active.status}</p>}
            </>}
          </section>
        </div>}
        {persona === 'planner' && section === 'schedule' && <section className="overflow-x-auto rounded-xl border bg-white p-5">
          <h2 className="text-xl font-bold">Read-only synthetic schedule</h2>
          <p className="mb-3 text-sm text-slate-600">A small fictional fixture for exercising report-to-activity linking; not a P6 baseline.</p>
          <table className="w-full text-left text-sm"><thead><tr>
            {['Activity ID','Activity name','Planned start','Planned finish'].map(h=><th className="border-b p-3" key={h}>{h}</th>)}
          </tr></thead><tbody>{ACTIVITIES.map(a=><tr key={a.id}>
            <td className="border-b p-3 font-semibold">{a.id}</td><td className="border-b p-3">{a.name}</td>
            <td className="border-b p-3">{a.start}</td><td className="border-b p-3">{a.finish}</td>
          </tr>)}</tbody></table>
        </section>}
        {persona === 'planner' && section === 'audit' && <section className="rounded-xl border bg-white p-5">
          <h2 className="text-xl font-bold">Synthetic Audit & Export</h2>
          <p className="my-3 text-sm text-slate-600">Every demo action has an in-memory event. Only finalized mappings go into the downloadable CSV. No Primavera baseline is changed.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} disabled={!finalized.length} onClick={exportMappings}>Download demo approved mapping CSV ({finalized.length})</button>
            <button type="button" className={secondary} disabled={!audit.length} onClick={exportAudit}>Download demo audit CSV ({audit.length})</button>
          </div>
          <h3 className="mb-2 mt-6 font-bold">Review history</h3>
          {!audit.length && <p className="text-sm text-slate-600">No new demo decisions yet. Capture a report and test a Planner action.</p>}
          <ul className="space-y-2">{[...audit].reverse().map((a,i)=><li className="rounded-lg bg-slate-50 p-3 text-sm" key={i}>
            <strong>{a.reportId} · {a.action}</strong> <span className="text-slate-500">{a.at}</span>
            <p>{a.details}</p>
          </li>)}</ul>
        </section>}
        <p className="border-t py-4 text-xs text-slate-500">
          SETU interactive sandbox is a credential-free illustration, not a live authenticated demo account.
          Production feature verification requires a separate, access-controlled environment with verified data isolation.
        </p>
      </div>
    </main>
  );
}
