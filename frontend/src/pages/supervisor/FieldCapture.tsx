import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Send, 
  Sparkles, 
  MapPin, 
  Calendar, 
  Paperclip, 
  HardHat, 
  CheckCircle2, 
  ArrowRight,
  Info
} from 'lucide-react';
import { Header } from '../../components/common/Header';
import { useFieldUpdates } from '../../hooks/useFieldUpdates';

export const FieldCapture: React.FC = () => {
  const navigate = useNavigate();
  const { submitFieldUpdate } = useFieldUpdates();

  const [fieldText, setFieldText] = useState('');
  const [discipline, setDiscipline] = useState('Piping');
  const [siteLocation, setSiteLocation] = useState('Duliajan Manifold Area A');
  const [reportedBy, setReportedBy] = useState('Ramesh Borah (Site Supervisor)');
  const [reportedDate, setReportedDate] = useState(new Date().toISOString().split('T')[0]);
  const [evidenceFilename, setEvidenceFilename] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{
    success: boolean;
    updateId?: string;
  } | null>(null);

  const demoExamples = [
    {
      text: 'Piping spool erection and line fit-up successfully finished at Manifold A today.',
      discipline: 'Piping',
      location: 'Duliajan Manifold Area A',
    },
    {
      text: '100% NDT radiography testing carried out on all 12 weld joints at KP 16 to 30.',
      discipline: 'Pipeline',
      location: 'Section B KP 16-30',
    },
    {
      text: 'Dyke bund wall civil construction around crude storage Tank B finished up to 2m height.',
      discipline: 'Civil',
      location: 'Crude Storage Tank Farm B',
    },
    {
      text: 'Cable trench excavation and conduit laying done along transformer line bay C.',
      discipline: 'Electrical',
      location: 'Substation Area Bay C',
    },
  ];

  const handleFillDemo = () => {
    const random = demoExamples[Math.floor(Math.random() * demoExamples.length)];
    setFieldText(random.text);
    setDiscipline(random.discipline);
    setSiteLocation(random.location);
    setEvidenceFilename('site_photo_dpr_log.jpg');
    setSubmissionResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldText.trim()) return;

    setIsSubmitting(true);
    setSubmissionResult(null);

    const res = await submitFieldUpdate({
      fieldText,
      siteLocation,
      reportedBy,
      reportedDate,
    });

    setIsSubmitting(false);
    if (res.success) {
      setSubmissionResult({ success: true, updateId: res.updateId });
      setFieldText('');
    } else {
      setSubmissionResult({ success: false });
    }
  };

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="supervisor" />

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* Page Banner */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2 text-xs font-bold text-setu-teal uppercase tracking-wider">
              <HardHat className="w-4 h-4" />
              <span>Supervisor Field Ingestion</span>
            </div>
            <h1 className="text-2xl font-extrabold text-setu-slate-900 mt-1">
              Field Progress Capture
            </h1>
            <p className="text-xs text-setu-slate-500 mt-0.5">
              Enter real-time progress in plain language. SETU handles semantic schedule mapping.
            </p>
          </div>

          <button
            type="button"
            onClick={handleFillDemo}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-setu-teal border border-teal-200 hover:bg-teal-50 shadow-2xs transition-colors self-start sm:self-center"
          >
            <Sparkles className="w-3.5 h-3.5 text-setu-amber" />
            <span>Fill Demo Example</span>
          </button>
        </div>

        {/* Success Confirmation State */}
        {submissionResult?.success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 animate-fadeIn">
            <div className="flex items-start space-x-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-bold">
                  Update captured successfully ({submissionResult.updateId})
                </h3>
                <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                  Update captured. SETU will prepare a schedule-link suggestion for planner review.
                </p>
                <div className="mt-3 flex items-center space-x-3">
                  <button
                    onClick={() => setSubmissionResult(null)}
                    className="text-xs font-bold text-emerald-800 underline hover:text-emerald-950"
                  >
                    Submit Another Report
                  </button>
                  <button
                    onClick={() => navigate('/planner/review')}
                    className="inline-flex items-center space-x-1 text-xs font-bold px-2.5 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800"
                  >
                    <span>View in Planner Queue</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Capture Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-setu-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
          {/* Main Field Narrative */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-setu-slate-700 mb-2">
              Field Update Narrative <span className="text-rose-500">*</span>
            </label>
            <textarea
              required
              rows={4}
              value={fieldText}
              onChange={(e) => setFieldText(e.target.value)}
              placeholder="e.g. Spool erection and welding finished at manifold A today. Hydrotest prep ongoing for section 3."
              className="w-full text-sm p-3.5 rounded-xl border border-setu-slate-300 focus:outline-none focus:ring-2 focus:ring-setu-teal focus:border-setu-teal placeholder:text-setu-slate-400 font-sans leading-relaxed"
            />
            <p className="text-[11px] text-setu-slate-500 mt-1">
              Plain text, WhatsApp field notes, or shift supervisor summaries. No Primavera codes required.
            </p>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Discipline Dropdown */}
            <div>
              <label className="block text-xs font-bold text-setu-slate-700 mb-1.5">
                Engineering Discipline
              </label>
              <select
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value)}
                className="w-full text-xs p-2.5 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-teal bg-white"
              >
                <option value="Piping">Piping</option>
                <option value="Pipeline">Pipeline</option>
                <option value="Civil">Civil</option>
                <option value="Electrical">Electrical</option>
                <option value="Mechanical">Mechanical</option>
                <option value="Instrumentation">Instrumentation</option>
              </select>
            </div>

            {/* Site Location */}
            <div>
              <label className="block text-xs font-bold text-setu-slate-700 mb-1.5">
                Site Location / Area
              </label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 absolute left-3 top-3 text-setu-slate-400" />
                <input
                  type="text"
                  value={siteLocation}
                  onChange={(e) => setSiteLocation(e.target.value)}
                  placeholder="e.g. Duliajan Manifold Area A"
                  className="w-full text-xs pl-8 pr-3 py-2.5 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-teal"
                />
              </div>
            </div>

            {/* Reported Date */}
            <div>
              <label className="block text-xs font-bold text-setu-slate-700 mb-1.5">
                Reported Date
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 absolute left-3 top-3 text-setu-slate-400" />
                <input
                  type="date"
                  value={reportedDate}
                  onChange={(e) => setReportedDate(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-2.5 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-teal bg-white"
                />
              </div>
            </div>

            {/* Reported By */}
            <div>
              <label className="block text-xs font-bold text-setu-slate-700 mb-1.5">
                Reported By (Supervisor)
              </label>
              <input
                type="text"
                value={reportedBy}
                onChange={(e) => setReportedBy(e.target.value)}
                placeholder="e.g. Ramesh Borah (Piping Foreman)"
                className="w-full text-xs px-3 py-2.5 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-teal"
              />
            </div>
          </div>

          {/* Optional File Attachment Placeholder */}
          <div>
            <label className="block text-xs font-bold text-setu-slate-700 mb-1.5">
              Evidence Document / Photo (Optional)
            </label>
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <Paperclip className="w-3.5 h-3.5 absolute left-3 top-3 text-setu-slate-400" />
                <input
                  type="text"
                  value={evidenceFilename}
                  onChange={(e) => setEvidenceFilename(e.target.value)}
                  placeholder="Upload site DPR photo, weld radiograph report, or inspection note..."
                  className="w-full text-xs pl-8 pr-3 py-2.5 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-teal bg-setu-slate-50"
                />
              </div>
              <button
                type="button"
                onClick={() => setEvidenceFilename('dpr_site_evidence_photo.jpg')}
                className="px-3 py-2.5 text-xs font-medium text-setu-slate-600 bg-setu-slate-100 hover:bg-setu-slate-200 rounded-lg border border-setu-slate-200"
              >
                Browse
              </button>
            </div>
          </div>

          {/* Architecture Trust Note */}
          <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-100 text-xs text-blue-900 flex items-start space-x-2">
            <Info className="w-4 h-4 text-setu-blue shrink-0 mt-0.5" />
            <p>
              <strong>Architecture Note:</strong> Browser does not perform local matching. The report is saved into Supabase, where SETU's backend matching pipeline links it to schedule activities with explainability scores.
            </p>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !fieldText.trim()}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-sm font-bold bg-setu-teal hover:bg-setu-teal-dark text-white shadow-md hover:shadow-lg transition-all disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{isSubmitting ? 'Submitting to Supabase...' : 'Submit for Plan Linking'}</span>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};
