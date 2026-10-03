import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Layers, ShieldCheck, UserCheck, HardHat } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export const RoleSelection: React.FC = () => {
  const { signIn, refreshRole } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (targetEmail: string, targetPassword: string) => {
    setBusy(true);
    setError(null);
    const result = await signIn(targetEmail.trim(), targetPassword);
    if (result.error) {
      setError(result.error.message);
    } else {
      try {
        const role = await refreshRole(result.userId ?? undefined);
        if (role === 'planner' || role === 'admin') navigate('/planner/command-center', { replace: true });
        else if (role === 'site' || role === 'engineer') navigate('/supervisor/capture', { replace: true });
        else setError('Authenticated account has no SETU role assignment.');
      } catch (roleError: any) {
        setError(roleError?.message || 'Unable to resolve SETU role.');
      }
    }
    setBusy(false);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    handleSignIn(email, password);
  };

  const setDemoRole = (role: 'planner' | 'supervisor') => {
    const defaultEmail = role === 'planner' ? 'planner@setu.local' : 'site@setu.local';
    setEmail(defaultEmail);
    setPassword('password123'); // Assuming standard demo password
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-setu-slate-100 to-setu-slate-200 flex flex-col justify-between p-4 sm:p-8 font-sans">
      <div className="max-w-md mx-auto w-full pt-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-white border border-setu-slate-200 shadow-sm text-setu-navy text-xs font-bold mb-6">
            <Layers className="w-4 h-4 text-setu-blue" />
            <span>SIH26122 · Oil India Limited</span>
          </div>
          <h1 className="text-5xl font-black text-setu-navy tracking-tight drop-shadow-sm">SETU</h1>
          <p className="text-lg font-semibold text-setu-blue mt-3">Secure field-to-plan integration.</p>
          <p className="text-sm text-setu-slate-500 mt-2">
            Sign in with your assigned SETU account.
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-setu-slate-200 p-8 shadow-xl shadow-setu-slate-200/50">
          <form onSubmit={submit}>
            <label className="block text-sm font-bold text-setu-slate-700">Work email</label>
            <input
              className="mt-2 w-full rounded-xl border border-setu-slate-300 px-4 py-3 outline-none focus:border-setu-blue focus:ring-2 focus:ring-setu-blue/20 transition-all"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="name@setu.local"
              required
            />
            <label className="block text-sm font-bold text-setu-slate-700 mt-5">Password</label>
            <input
              className="mt-2 w-full rounded-xl border border-setu-slate-300 px-4 py-3 outline-none focus:border-setu-blue focus:ring-2 focus:ring-setu-blue/20 transition-all"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
            {error && <p className="mt-5 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3 font-medium">{error}</p>}
            <button
              disabled={busy}
              className="mt-6 w-full rounded-xl bg-setu-navy hover:bg-setu-blue text-white py-3.5 font-bold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors shadow-md"
            >
              {busy ? 'Signing in…' : 'Sign in to SETU'}
              <ArrowRight className="w-5 h-5" />
            </button>
          </form>

          <div className="mt-8">
            <div className="relative flex items-center mb-6">
              <div className="flex-grow border-t border-setu-slate-200"></div>
              <span className="flex-shrink-0 mx-4 text-setu-slate-400 text-xs font-bold uppercase tracking-wider">Demo Access</span>
              <div className="flex-grow border-t border-setu-slate-200"></div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDemoRole('planner')}
                className="flex flex-col items-center justify-center p-3 rounded-xl border border-setu-slate-200 bg-setu-slate-50 hover:bg-setu-blue/5 hover:border-setu-blue/30 transition-all group"
              >
                <UserCheck className="w-6 h-6 text-setu-slate-400 group-hover:text-setu-blue mb-2 transition-colors" />
                <span className="text-xs font-bold text-setu-slate-600 group-hover:text-setu-navy">Planner</span>
              </button>
              <button
                type="button"
                onClick={() => setDemoRole('supervisor')}
                className="flex flex-col items-center justify-center p-3 rounded-xl border border-setu-slate-200 bg-setu-slate-50 hover:bg-setu-blue/5 hover:border-setu-blue/30 transition-all group"
              >
                <HardHat className="w-6 h-6 text-setu-slate-400 group-hover:text-setu-blue mb-2 transition-colors" />
                <span className="text-xs font-bold text-setu-slate-600 group-hover:text-setu-navy">Site Engineer</span>
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs text-setu-slate-500 mt-6 text-center font-medium">
          Demo accounts must be created manually in Supabase Auth and mapped in <code className="bg-setu-slate-200 px-1 py-0.5 rounded text-setu-slate-700">user_roles</code>.
        </p>
      </div>

      <div className="max-w-2xl mx-auto text-center pb-6 text-xs text-setu-slate-400 flex items-center justify-center gap-2 font-medium">
        <ShieldCheck className="w-4 h-4" />
        <span>Authentication + RLS enforce authorization. UI does not grant roles.</span>
      </div>
    </div>
  );
};