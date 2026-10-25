import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  currentEvaluatorAccess, enterEvaluatorRole, forgetEvaluatorAccess,
  redeemEvaluatorInvite,
} from '../lib/evaluatorAccess';

export function EvaluatorEntry() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState(Boolean(currentEvaluatorAccess()));

  useEffect(() => {
    // The secret stays in the URL fragment so it never reaches static CDN logs.
    const value = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('invite') || '';
    setToken(value);
    if (value) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function start() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (token) {
        // Token is single-use. Failed provisioning requires a fresh private link.
        await redeemEvaluatorInvite(token);
        setToken('');
        setExisting(true);
      }
      await enterEvaluatorRole('site');
      navigate('/supervisor/capture', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open evaluation.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 text-slate-900">
    <section className="w-full max-w-xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-10">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-700">SETU · SIH26122</p>
      <h1 className="text-3xl font-extrabold tracking-tight">Evaluator access</h1>
      <p className="text-slate-600">
        Welcome to the <strong>original SETU application</strong>. Use real Supervisor and Planner
        workflows with temporary, scope-limited test accounts.
      </p>
      <div className="space-y-2 rounded-xl bg-blue-50 p-4 text-sm text-blue-950">
        <p><strong>One click:</strong> No registration, email or password to type.</p>
        <p><strong>24 hours:</strong> Access expires automatically at the database boundary.</p>
        <p><strong>Real application:</strong> Supervisor capture / CSV import and Planner review / audit.</p>
        <p><strong>Test data:</strong> Create reports marked “SIH EVALUATOR DEMO ONLY”. Shared production reports stay isolated.</p>
      </div>
      {!token && !existing && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        This page requires a valid private SIH evaluator link. Ask the SETU team for an invitation.
      </div>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <button type="button" onClick={start} disabled={busy || (!token && !existing)}
        className="w-full rounded-lg bg-blue-700 px-5 py-4 font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? 'Opening real SETU…' : 'Start 24-Hour Evaluation'}
      </button>
      {existing && <button className="block w-full text-sm text-slate-600 underline" type="button"
        onClick={() => { forgetEvaluatorAccess(); setExisting(false); setToken(''); }}>
        Forget this evaluator session
      </button>}
      <p className="text-center text-xs text-slate-500">
        Temporary credentials are kept only in this browser tab; close the tab when finished.
        Manual/voice submission remains subject to the live release gate.
      </p>
      <div className="text-center"><Link className="text-sm font-semibold text-blue-700 underline" to="/">Regular SETU login</Link></div>
    </section>
  </main>;
}
