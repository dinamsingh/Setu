import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, ChevronRight,
  ClipboardList, FileText, Layers3, LogOut, MapPin,
  PenLine, Plus, RefreshCw, Send, Settings2, UserRound,
} from 'lucide-react';
import { VoiceInputControl } from '../../components/supervisor/VoiceInputControl';
import { getKolkataReferenceDate } from '../../lib/temporalParser';
import {
  analyzeSupervisorNarrative,
  type ClarificationOption,
  type MaterialAmbiguity,
  type SupervisorAnalysisResult,
} from '../../lib/supervisorSemanticAnalyzer';
import { useFieldUpdates } from '../../hooks/useFieldUpdates';
import { useWorkflow } from '../../hooks/useWorkflow';
import { useAuth } from '../../lib/AuthContext';
import { addressedRequests } from '../../lib/workflow';
import { NeedsClarification } from '../../components/supervisor/NeedsClarification';
import { ReportImportWizard } from '../../components/supervisor/ReportImportWizard';
import { ReportAttachmentMenu } from '../../components/supervisor/ReportAttachmentMenu';
import { ownSiteUpdates, siteLogDate, siteLogStatus, type SiteLogTone } from '../../lib/siteLog';
import type { FieldUpdate } from '../../types';

type Screen = 'home' | 'compose' | 'sent' | 'updates' | 'report' | 'account' | 'import';

type SentReport = {
  updateId: string;
  text: string;
  location: string;
  discipline: string;
  date: string;
  reporter: string;
};

const disciplines = ['Piping', 'Pipeline', 'Civil', 'Electrical', 'Mechanical', 'Instrumentation'];
const toneClasses: Record<SiteLogTone, string> = {
  blue: 'bg-blue-50 text-blue-800',
  amber: 'bg-amber-50 text-amber-800',
  green: 'bg-emerald-50 text-emerald-800',
  neutral: 'bg-slate-100 text-slate-600',
};

const card = 'rounded-[1.3rem] border border-slate-200/80 bg-white shadow-[0_10px_35px_-28px_rgba(15,38,76,0.3)]';
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

function Status({ update, rounds }: { update: FieldUpdate; rounds: ReturnType<typeof addressedRequests> }) {
  const state = siteLogStatus(update, rounds);
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:text-xs ${toneClasses[state.tone]}`}>
    {state.label}
  </span>;
}

function FieldUpdateRow({ update, rounds, onClick }: {
  update: FieldUpdate;
  rounds: ReturnType<typeof addressedRequests>;
  onClick: () => void;
}) {
  return <button type="button" onClick={onClick}
    className={`group flex w-full items-start gap-3 border-b border-slate-100 px-4 py-4 text-left transition-colors last:border-0 hover:bg-slate-50 sm:px-5 ${focus}`}>
    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#1557A0]">
      <FileText size={19} aria-hidden="true" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-semibold text-slate-500">{update.update_id}</span>
        <Status update={update} rounds={rounds} />
      </span>
      <span className="block line-clamp-2 text-sm font-semibold leading-6 text-[#13264A] sm:text-[15px]">{update.field_text}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden="true" />{update.site_location || 'Site location not provided'}</span>
        <span className="inline-flex items-center gap-1"><CalendarDays size={13} aria-hidden="true" />{siteLogDate(update.reported_date)}</span>
      </span>
    </span>
    <ChevronRight size={18} className="mt-5 shrink-0 text-slate-400 group-hover:text-[#1557A0]" aria-hidden="true" />
  </button>;
}

export const FieldCapture: React.FC = () => {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const { submitFieldUpdate, updates, loading, error, refetch } = useFieldUpdates();
  const workflow = useWorkflow(() => refetch(true));
  const [screen, setScreen] = useState<Screen>('home');
  const [importLocked, setImportLocked] = useState(false);
  const importEntry = useRef<HTMLButtonElement>(null);
  const previousScreen = useRef<Screen>('home');
  useEffect(() => {
    if (previousScreen.current === 'import' && screen === 'compose') importEntry.current?.focus();
    previousScreen.current = screen;
  }, [screen]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [fieldText, setFieldText] = useState('');
  const [discipline, setDiscipline] = useState('Piping');
  const [siteLocation, setSiteLocation] = useState('Duliajan Manifold Area A');
  const [reportedDate, setReportedDate] = useState(() => {
    return getKolkataReferenceDate().yyyyMmDd;
  });
  const [reportedBy, setReportedBy] = useState('Ramesh Borah (Site Supervisor)');
  const [showDetails, setShowDetails] = useState(false);
  const [showReporter, setShowReporter] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentReport | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [pendingClarification, setPendingClarification] = useState<MaterialAmbiguity | null>(null);
  const [resolvedAmbiguity, setResolvedAmbiguity] = useState<ClarificationOption | null>(null);

  const handleFinalTranscript = (chunk: string) => {
    if (isSubmittingRef.current) return;
    setFieldText(prev => {
      if (!prev) return chunk;
      return /\s$/.test(prev) ? `${prev}${chunk}` : `${prev} ${chunk}`;
    });
  };

  const ownUpdates = useMemo(() => ownSiteUpdates(updates, user?.id), [updates, user?.id]);
  const ownRounds = useMemo(() => user ? addressedRequests(workflow.rounds, user.id) : [], [workflow.rounds, user]);
  const actionableRounds = ownRounds.filter(r => r.status === 'open' || r.status === 'responded');
  const currentReport = ownUpdates.find(u => u.id === selectedReport);
  const defaultLocation = ownUpdates[0]?.site_location || 'Duliajan Manifold Area A';

  const startNew = () => {
    setSubmitError(null);
    setInterimTranscript('');
    setVoiceStatus(null);
    setPendingClarification(null);
    setResolvedAmbiguity(null);
    setScreen('compose');
  };
  const openReport = (update: FieldUpdate) => { setSelectedReport(update.id); setScreen('report'); };

  const executeSubmission = async (
    analysis: SupervisorAnalysisResult,
    clarificationOpt?: ClarificationOption | null
  ) => {
    if (isSubmittingRef.current) return;
    setIsSubmitting(true);
    isSubmittingRef.current = true;
    setSubmitError(null);

    const result = await submitFieldUpdate({
      fieldText: fieldText.trim(),
      siteLocation: siteLocation.trim() || 'Site Area',
      reportedDate,
      reportedBy: reportedBy.trim(),
      discipline,
      sourceType: 'manual_text',
      interpretation: analysis.summary,
      clarification: clarificationOpt
        ? {
            question: analysis.materialAmbiguity?.question,
            answer: clarificationOpt.label,
            resolution: clarificationOpt.resolution,
          }
        : null,
    });

    setIsSubmitting(false);
    isSubmittingRef.current = false;

    if (!result.success) {
      setSubmitError(result.error || 'Update nahi bheji gayi. Kripya dobara koshish karein.');
      return;
    }

    setSent({
      updateId: result.updateId || 'Submitted',
      text: fieldText.trim(),
      location: siteLocation.trim(),
      discipline,
      date: reportedDate,
      reporter: reportedBy.trim(),
    });
    setFieldText('');
    setPendingClarification(null);
    setResolvedAmbiguity(null);
    setScreen('sent');
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fieldText.trim() || isSubmitting) return;

    const analysis = analyzeSupervisorNarrative(fieldText, reportedDate, {
      location: siteLocation,
    });

    if (!analysis.isValid) {
      setSubmitError(analysis.validationError || 'Please enter a valid update.');
      return;
    }

    // If there is an unresolved material ambiguity affecting accuracy, clarify first
    if (analysis.materialAmbiguity && !resolvedAmbiguity) {
      setPendingClarification(analysis.materialAmbiguity);
      return;
    }

    await executeSubmission(analysis, resolvedAmbiguity);
  };

  const handleResolveClarification = async (opt: ClarificationOption) => {
    setResolvedAmbiguity(opt);
    setPendingClarification(null);

    if (opt.resolution === 'yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      setReportedDate(getKolkataReferenceDate(yesterday).yyyyMmDd);
    }

    const analysis = analyzeSupervisorNarrative(fieldText, reportedDate, {
      location: siteLocation,
    });
    await executeSubmission(analysis, opt);
  };

  const handleSignOut = async () => {
    const result = await signOut();
    if (!result.error) navigate('/');
  };

  return <div className="min-h-screen bg-[#F7F9FC] text-[#112344] selection:bg-blue-100">
    <header className="border-b border-slate-200/80 bg-white/95">
      <div className="mx-auto flex h-[72px] w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <button type="button" disabled={importLocked} onClick={() => setScreen('home')} className={`flex items-center gap-3 rounded-lg text-left ${focus}`} aria-label="SETU Site Log home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1557A0] text-white"><Layers3 size={21} strokeWidth={2.3}/></span>
          <span><span className="block text-lg font-extrabold leading-5 tracking-tight">SETU</span>
            <span className="block text-xs font-medium text-slate-500">Site Log · Oil India Limited</span></span>
        </button>
        <div className="flex items-center gap-3">
          <span className="hidden text-right sm:block"><span className="block text-sm font-semibold">{reportedBy.split(' (')[0]}</span>
            <span className="block text-xs text-slate-500">{role === 'engineer' ? 'Field Engineer' : 'Site Supervisor'}</span></span>
          <button type="button" disabled={importLocked} onClick={() => setScreen('account')} aria-label="Account and sign out"
            className={`flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-[#1557A0] ${focus}`}>
            <UserRound size={20}/>
          </button>
        </div>
      </div>
    </header>

    <main className={`mx-auto w-full px-4 pb-32 pt-7 sm:px-8 sm:pt-10 ${screen === 'import' ? 'max-w-6xl' : 'max-w-4xl'}`}>
      {screen === 'import' && <ReportImportWizard onCancel={() => setScreen('compose')}
        submitter={user ? { id: user.id, role } : undefined} onLockChange={setImportLocked} onCompleted={() => void refetch(true)} />}
      {screen === 'home' && <div className="space-y-7">
        <section className="relative overflow-hidden rounded-[1.7rem] bg-[#EAF2FC] px-6 py-7 sm:px-9 sm:py-9">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border-[35px] border-white/45" aria-hidden="true" />
          <div className="relative max-w-xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.17em] text-[#55769E]">Duliajan project · Field workspace</p>
            <h1 className="mt-3 text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.65rem]">Site Log</h1>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600"><MapPin size={16} aria-hidden="true" />{defaultLocation}</p>
            <p className="mt-1 text-sm text-slate-500">Record field progress. SETU handles schedule linking.</p>
            <button type="button" onClick={startNew}
              className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#123F77] px-5 py-4 text-sm font-semibold text-white shadow-[0_12px_25px_-14px_rgba(18,63,119,0.8)] transition-colors hover:bg-[#0C315D] sm:w-auto sm:min-w-[220px] ${focus}`}>
              <Plus size={19} aria-hidden="true" /> New field update <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </section>

        {workflow.error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">Clarification updates unavailable: {workflow.error}</p>}
        {actionableRounds.length > 0 && user && <div className={`${card} overflow-hidden p-4 sm:p-5`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#123F77]"><ClipboardList size={18}/> Planner requested clarification</div>
          <NeedsClarification rounds={actionableRounds} updates={updates} userId={user.id} act={workflow.act} available={!workflow.loading && !workflow.error} />
        </div>}

        <section aria-labelledby="recent-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 id="recent-heading" className="text-xl font-bold tracking-tight sm:text-2xl">Recent updates</h2>
              <p className="text-sm text-slate-500">Your site observations awaiting planner review</p></div>
            <button type="button" onClick={() => setScreen('updates')} className={`text-sm font-semibold text-[#1557A0] ${focus}`}>View all ({ownUpdates.length})</button>
          </div>
          <div className={`${card} overflow-hidden`}>
            {loading ? <p className="p-6 text-sm text-slate-500">Loading updates…</p> : error ? <p role="alert" className="p-6 text-sm text-rose-700">{error}</p> :
              ownUpdates.length ? ownUpdates.slice(0, 3).map(u => <FieldUpdateRow key={u.id} update={u} rounds={ownRounds} onClick={() => openReport(u)}/>) :
              <p className="p-6 text-sm text-slate-500">You haven't sent any updates yet.</p>}
          </div>
        </section>
      </div>}

      {screen === 'compose' && <div className="mx-auto max-w-[700px]">
        <button type="button" onClick={() => setScreen('home')} className={`mb-7 inline-flex items-center gap-2 rounded-lg py-1 text-sm font-semibold text-slate-600 hover:text-[#123F77] ${focus}`}><ArrowLeft size={18}/> Site Log</button>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E5F7F0] text-[#0D8067]"><PenLine size={21}/></span>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.14em] text-[#0C806D]">New update</p>
        <h1 className="mt-2 text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.65rem]">What happened on site?</h1>
        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500 sm:text-base">Write naturally or use voice. SETU handles schedule linking for planner review.</p>
        <form id="site-log-compose" onSubmit={handleSend} className="mt-7 space-y-6">
          <div>
            <div className="relative">
              <label htmlFor="field-report" className="sr-only">Describe field progress</label>
              <textarea id="field-report" rows={7} value={fieldText} required
                onChange={e => {
                  setFieldText(e.target.value);
                  if (pendingClarification) setPendingClarification(null);
                  if (resolvedAmbiguity) setResolvedAmbiguity(null);
                }}
                placeholder="Piping spool erection and line fit-up finished at Manifold A today…"
                className="block min-h-[235px] w-full resize-y rounded-[1.4rem] border border-slate-200 bg-white p-5 pb-16 text-base leading-7 text-[#112344] placeholder:text-slate-400 shadow-sm outline-none focus:border-[#1557A0] focus:ring-4 focus:ring-blue-100 sm:p-6 sm:pb-16 sm:text-lg" />
              <ReportAttachmentMenu triggerRef={importEntry} disabled={isSubmitting} onImport={() => setScreen('import')} />
              <VoiceInputControl
                disabled={isSubmitting}
                onFinalTranscript={handleFinalTranscript}
                onInterimTranscript={setInterimTranscript}
                onStatusChange={setVoiceStatus}
              />
            </div>
            {interimTranscript && (
              <div role="status" className="mt-2 flex items-center gap-2 rounded-xl bg-blue-50 px-3.5 py-2 text-xs text-blue-700">
                <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
                <span className="font-semibold">Listening:</span>
                <span className="italic">{interimTranscript}</span>
              </div>
            )}
            {voiceStatus && (
              <div role="alert" className="mt-2 flex items-start justify-between gap-2 rounded-xl bg-amber-50 px-3.5 py-2 text-xs text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                  <span>{voiceStatus}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setVoiceStatus(null)}
                  className="ml-2 font-bold text-amber-700 hover:text-amber-900"
                  aria-label="Dismiss voice status"
                >
                  ×
                </button>
              </div>
            )}
            <div className="mt-2 flex flex-col gap-1 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] leading-tight text-slate-500">
                Voice input: Mixed-language (Hinglish) accuracy is best-effort. Speech recognition is processed by your browser and may send audio to an external speech service. SETU does not record or store raw audio.
              </p>
              <p className="shrink-0 text-right tabular-nums">{fieldText.length} characters</p>
            </div>
          </div>

          {/* Compact date and location display with accessible 'Change details' control */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 sm:text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                  <CalendarDays size={15} className="text-[#1557A0]" aria-hidden="true" />
                  <span data-testid="compact-date">{siteLogDate(reportedDate)}</span>
                </span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                  <MapPin size={15} className="text-[#1557A0]" aria-hidden="true" />
                  <span data-testid="compact-location">{siteLocation || 'Site Area'}</span>
                </span>
                {discipline && (
                  <>
                    <span className="hidden text-slate-300 sm:inline" aria-hidden="true">·</span>
                    <span className="hidden font-medium text-slate-500 sm:inline">{discipline}</span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowDetails(v => !v)}
                aria-expanded={showDetails}
                aria-controls="report-details-panel"
                className="shrink-0 text-xs font-semibold text-[#1557A0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded px-1 py-0.5"
              >
                {showDetails ? 'Hide details' : 'Change details'}
              </button>
            </div>

            <div id="report-details-panel" className={showDetails ? 'mt-4 border-t border-slate-100 pt-3 block space-y-4' : 'hidden'}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500"><Settings2 size={14}/> Discipline</span>
                  <span className="relative block">
                    <select
                      value={discipline}
                      onChange={e => setDiscipline(e.target.value)}
                      className="w-full appearance-none bg-transparent pr-5 text-sm font-semibold text-[#13264A] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label="Engineering discipline"
                    >
                      {disciplines.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-0 top-1 text-slate-500"/>
                  </span>
                </label>
                <label className="block rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500"><MapPin size={14}/> Site / Area</span>
                  <input
                    value={siteLocation}
                    onChange={e => setSiteLocation(e.target.value)}
                    aria-label="Site location"
                    className="w-full min-w-0 bg-transparent text-sm font-semibold text-[#13264A] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  />
                </label>
                <label className="block rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500"><CalendarDays size={14}/> Reported date</span>
                  <input
                    required
                    type="date"
                    value={reportedDate}
                    onChange={e => setReportedDate(e.target.value)}
                    aria-label="Reported date"
                    className="w-full min-w-0 bg-transparent text-sm font-semibold text-[#13264A] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  />
                </label>
              </div>
              <section className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowReporter(v => !v)}
                  aria-expanded={showReporter}
                  className={`flex w-full items-center gap-3 rounded-xl py-2 text-left ${focus}`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#1557A0]">
                    <UserRound size={18}/>
                  </span>
                  <span className="flex-1">
                    <span className="block text-xs text-slate-500">Reporting as</span>
                    <span className="block text-sm font-semibold">{reportedBy}</span>
                  </span>
                  <ChevronDown className={`text-slate-400 transition-transform ${showReporter ? 'rotate-180' : ''}`} size={18}/>
                </button>
                {showReporter && (
                  <div className="mt-2">
                    <label htmlFor="reporter-name" className="mb-1 block text-xs font-semibold text-slate-600">Reporter name / designation</label>
                    <input
                      id="reporter-name"
                      value={reportedBy}
                      onChange={e => setReportedBy(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                )}
              </section>
            </div>
          </div>

          {/* Minimal Plain-Language Clarification Dialog */}
          {pendingClarification && (
            <div
              role="dialog"
              aria-labelledby="clarification-title"
              className="rounded-2xl border-2 border-amber-300 bg-amber-50/95 p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="mt-0.5 text-amber-700 shrink-0" aria-hidden="true" />
                <div className="flex-1">
                  <h3 id="clarification-title" className="text-xs font-bold uppercase tracking-wider text-amber-800">
                    Kripya spashth karein (Please clarify)
                  </h3>
                  <p className="mt-1.5 text-base font-bold text-slate-900">
                    {pendingClarification.question}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2.5">
                    {pendingClarification.options.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleResolveClarification(opt)}
                        className="rounded-xl bg-[#123F77] px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0C315D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {opt.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPendingClarification(null)}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      Update badlein (Edit update)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI Processing subtle feedback during actual async call */}
          {isSubmitting && (
            <div
              role="status"
              className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900 shadow-sm"
            >
              <RefreshCw size={17} className="animate-spin text-blue-700 shrink-0" aria-hidden="true" />
              <span>SETU aapki update check kar raha hai…</span>
            </div>
          )}

          {/* Submission error with Retry */}
          {submitError && (
            <div
              role="alert"
              className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertCircle size={18} className="mt-0.5 text-rose-600 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-bold text-rose-950">Update nahi bheji gayi</p>
                    <p className="mt-0.5 text-xs text-rose-800">{submitError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSend}
                  className="shrink-0 rounded-xl bg-rose-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  Dobara koshish karein (Retry)
                </button>
              </div>
            </div>
          )}

          <p className="text-xs leading-5 text-slate-500">
            This report is sent for AI schedule linking and human planner review. Submission does not approve or update the baseline schedule.
          </p>

          <button
            type="submit"
            disabled={isSubmitting || !fieldText.trim()}
            className={`hidden w-full items-center justify-center gap-2 rounded-2xl bg-[#123F77] px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-[#0C315D] disabled:cursor-not-allowed disabled:opacity-50 sm:flex ${focus}`}
          >
            <Send size={18}/>
            {isSubmitting ? 'SETU aapki update check kar raha hai…' : 'Update bhejo'}
            {!isSubmitting && <ArrowRight size={18}/>}
          </button>
        </form>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
          <button
            type="submit"
            form="site-log-compose"
            disabled={isSubmitting || !fieldText.trim()}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-[#123F77] px-5 py-4 font-semibold text-white disabled:opacity-50 ${focus}`}
          >
            <Send size={18}/>
            {isSubmitting ? 'SETU aapki update check kar raha hai…' : 'Update bhejo'}
            {!isSubmitting && <ArrowRight size={18}/>}
          </button>
        </div>
      </div>}

      {screen === 'sent' && sent && <div className="mx-auto flex max-w-xl flex-col items-center pt-8 text-center sm:pt-14" role="status">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#E2F8F0] text-[#0E836B]"><Check size={46} strokeWidth={2.8}/></span>
        <h1 className="mt-7 text-[2.3rem] font-bold tracking-tight sm:text-[3rem]">Update sent</h1>
        <p className="mt-2 max-w-sm text-base leading-7 text-slate-500">Your field report is saved and awaiting AI schedule linking and planner review.</p>
        <div className={`${card} mt-9 w-full divide-y divide-slate-100 px-5 text-left`}>
          <div className="py-4"><p className="text-xs font-medium text-slate-500">Report ID</p><p className="mt-1 break-all font-mono text-sm font-semibold">{sent.updateId}</p></div>
          <div className="py-4"><p className="text-xs font-medium text-slate-500">Field update</p><p className="mt-1 text-sm leading-6">{sent.text}</p></div>
          <div className="grid grid-cols-2 gap-4 py-4 text-sm"><div><p className="text-xs text-slate-500">Location</p><p className="mt-1 font-semibold">{sent.location}</p></div>
            <div><p className="text-xs text-slate-500">Date</p><p className="mt-1 font-semibold">{siteLogDate(sent.date)}</p></div></div>
          <div className="py-4 text-sm"><p className="text-xs text-slate-500">Submitted by</p><p className="mt-1 font-semibold">{sent.reporter}</p></div>
        </div>
        <button type="button" onClick={() => setScreen('home')}
          className={`mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#123F77] px-5 py-4 font-semibold text-white hover:bg-[#0C315D] ${focus}`}>
          Back to Site Log <ArrowRight size={18}/>
        </button>
        <button type="button" onClick={startNew} className={`mt-3 rounded-xl px-4 py-3 text-sm font-semibold text-[#1557A0] ${focus}`}>Send another update</button>
      </div>}

      {screen === 'updates' && <section className="mx-auto max-w-2xl">
        <button type="button" onClick={() => setScreen('home')} className={`mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 ${focus}`}><ArrowLeft size={17}/> Site Log</button>
        <div className="mb-6 flex items-center justify-between"><h1 className="text-2xl font-bold tracking-tight">My updates</h1>
          <span className="text-sm font-medium text-slate-500">{ownUpdates.length} total</span></div>
        <div className={`${card} overflow-hidden`}>
          {loading ? <p className="p-6 text-sm text-slate-500">Loading updates…</p> : error ? <p role="alert" className="p-6 text-sm text-rose-700">{error}</p> :
            ownUpdates.length ? ownUpdates.map(u => <FieldUpdateRow key={u.id} update={u} rounds={ownRounds} onClick={() => openReport(u)}/>) :
            <p className="p-6 text-sm text-slate-500">You haven't sent any updates yet.</p>}
        </div>
      </section>}

      {screen === 'report' && <section className="mx-auto max-w-2xl">
        <button type="button" onClick={() => setScreen('updates')} className={`mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 ${focus}`}><ArrowLeft size={17}/> My updates</button>
        {currentReport ? <>
          <div className="mb-6 flex flex-wrap items-center gap-3"><h1 className="break-all font-mono text-xl font-bold sm:text-2xl">{currentReport.update_id}</h1><Status update={currentReport} rounds={ownRounds}/></div>
          <div className={`${card} divide-y divide-slate-100 px-5 sm:px-7`}>
            <div className="py-6"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Field narrative</p>
              <p className="mt-2 text-base leading-7">{currentReport.field_text}</p></div>
            <div className="grid gap-5 py-5 text-sm sm:grid-cols-2"><div><p className="text-xs text-slate-500">Site location</p><p className="mt-1 font-semibold">{currentReport.site_location || 'Not provided'}</p></div>
              <div><p className="text-xs text-slate-500">Reported date</p><p className="mt-1 font-semibold">{siteLogDate(currentReport.reported_date)}</p></div>
              <div><p className="text-xs text-slate-500">Reporter</p><p className="mt-1 font-semibold">{currentReport.reported_by || 'Not provided'}</p></div>
              <div><p className="text-xs text-slate-500">Plan linking</p><p className="mt-1 font-semibold">{currentReport.status === 'approved' || currentReport.status === 'remapped' ? 'Planner decision recorded' : 'Pending planner workflow'}</p></div>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-500">AI recommendations and planner decisions are separate from the original field report.</p>
        </> : <p className="text-sm text-slate-500">Report no longer available in your list.</p>}
      </section>}

      {screen === 'account' && <section className="mx-auto max-w-md">
        <button type="button" onClick={() => setScreen('home')} className={`mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 ${focus}`}><ArrowLeft size={17}/> Site Log</button>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <div className={`${card} mt-6 space-y-5 p-6`}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-800"><UserRound size={22}/></span>
          <div><p className="font-semibold">{reportedBy}</p><p className="text-sm text-slate-500">{user?.email || 'Signed-in account'}</p></div></div>
          <p className="text-sm text-slate-500">Role: {role === 'engineer' ? 'Field Engineer' : 'Site Supervisor'}</p>
          <button type="button" onClick={() => void handleSignOut()} className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-rose-700 ${focus}`}>
            <LogOut size={17}/> Sign out
          </button>
        </div>
      </section>}
    </main>

    {(screen === 'home' || screen === 'updates' || screen === 'account') && <nav aria-label="Site Log navigation" className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
      <div className="grid grid-cols-3 py-2">
        {([{ name:'Site Log', page:'home' as Screen, Icon: ClipboardList }, { name:'My updates', page:'updates' as Screen, Icon: FileText }, { name:'Account', page:'account' as Screen, Icon: UserRound }]).map(n =>
          <button type="button" key={n.page} onClick={() => setScreen(n.page)} aria-current={screen === n.page ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-semibold ${screen === n.page ? 'text-[#1557A0]' : 'text-slate-500'} ${focus}`}>
            <n.Icon size={20} aria-hidden="true"/>{n.name}
          </button>)}
      </div>
    </nav>}
  </div>;
};
