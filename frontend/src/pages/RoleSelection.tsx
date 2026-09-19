import React, { useState } from 'react';
import { ArrowRight, Layers, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export const RoleSelection: React.FC = () => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    if (result.error) setError(result.error.message);
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col justify-between p-4 sm:p-8">
      <div className="max-w-md mx-auto w-full pt-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-setu-navy text-white text-xs font-semibold mb-4">
            <Layers className="w-4 h-4 text-setu-blue-light" />
            <span>SIH26122 · Oil India Limited</span>
          </div>
          <h1 className="text-5xl font-extrabold text-setu-navy tracking-tight">SETU</h1>
          <p className="text-xl font-bold text-setu-blue mt-2">Secure field-to-plan integration.</p>
          <p className="text-sm text-setu-slate-600 mt-2">
            Sign in with your assigned SETU account. Role selection is now driven by database-backed authorization.
          </p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-setu-slate-200 p-6 shadow-sm">
          <label className="block text-sm font-semibold text-setu-slate-700">Work email</label>
          <input
            className="mt-2 w-full rounded-lg border border-setu-slate-300 px-3 py-2.5 outline-none focus:border-setu-blue"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <label className="block text-sm font-semibold text-setu-slate-700 mt-4">Password</label>
          <input
            className="mt-2 w-full rounded-lg border border-setu-slate-300 px-3 py-2.5 outline-none focus:border-setu-blue"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          {error && <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
          <button
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-setu-navy text-white py-3 font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? 'Signing in…' : 'Sign in'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="text-xs text-setu-slate-500 mt-4 text-center">
          Demo accounts must be created manually in Supabase Auth and mapped in <code>user_roles</code>.
        </p>
      </div>

      <div className="max-w-2xl mx-auto text-center pb-4 text-xs text-setu-slate-500 flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-setu-slate-400" />
        <span>Authentication + database RLS enforce authorization; the UI does not grant roles.</span>
      </div>
    </div>
  );
};