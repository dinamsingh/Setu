import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import './RoleSelection.css';

type DemoRole = 'planner' | 'supervisor';
type FieldErrors = { email?: string; password?: string };

const demoCredentials: Record<DemoRole, { email: string; password: string }> = {
  planner: { email: 'planner@setu.local', password: 'password123' },
  supervisor: { email: 'site@setu.local', password: 'password123' },
};

function Icon({ children, className = 'setu-login-v2__icon' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const RoleSelection: React.FC = () => {
  const { signIn, refreshRole } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [signInError, setSignInError] = useState<string | null>(null);

  const selectedDemo: DemoRole | null =
    email === demoCredentials.planner.email && password === demoCredentials.planner.password
      ? 'planner'
      : email === demoCredentials.supervisor.email && password === demoCredentials.supervisor.password
        ? 'supervisor'
        : null;

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = 'Enter your work email to continue.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter an email address such as name@company.com.';
    if (!password) next.password = 'Enter your account password to continue.';
    return next;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const nextFieldErrors = validate();
    setFieldErrors(nextFieldErrors);
    setSignInError(null);
    if (Object.keys(nextFieldErrors).length > 0) return;

    setBusy(true);
    try {
      const result = await signIn(email.trim(), password);
      if (result.error) {
        setSignInError(result.error.message);
        return;
      }

      const role = await refreshRole(result.userId ?? undefined);
      if (role === 'planner' || role === 'admin') {
        navigate('/planner/command-center', { replace: true });
      } else if (role === 'site' || role === 'engineer') {
        navigate('/supervisor/capture', { replace: true });
      } else {
        setSignInError('Authenticated account has no SETU role assignment.');
      }
    } catch (error: unknown) {
      setSignInError(error instanceof Error ? error.message : 'Unable to sign in to SETU.');
    } finally {
      setBusy(false);
    }
  };

  const selectDemo = (role: DemoRole) => {
    const credentials = demoCredentials[role];
    setEmail(credentials.email);
    setPassword(credentials.password);
    setFieldErrors({});
    setSignInError(null);
  };

  const hasMultipleFieldErrors = Boolean(fieldErrors.email && fieldErrors.password);

  return (
    <main className="setu-login-v2">
      <aside className="setu-login-v2__story" aria-labelledby="setu-story-title">
        <div className="setu-login-v2__brand">
          <span className="setu-login-v2__brand-mark">
            <Icon><path d="m12 3 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5" /></Icon>
          </span>
          <span className="setu-login-v2__brand-name">SETU</span>
        </div>

        <div className="setu-login-v2__story-main">
          <p className="setu-login-v2__eyebrow">FIELD-TO-PLAN INTEGRATION</p>
          <h2 className="setu-login-v2__story-title" id="setu-story-title">
            <span>From the field.</span>
            <span className="setu-login-v2__muted-title">Into the plan.</span>
          </h2>
          <p className="setu-login-v2__story-description">A shared workspace for site updates, planner review, and the work ahead.</p>
          <svg className="setu-login-v2__bridge" viewBox="0 0 520 184" fill="none" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1" opacity="0.35">
              <path d="M16 140 124 78 238 140 130 180Z M280 68 388 6 504 68 396 132Z" />
              <path d="M44 124 158 164M70 109 185 149M96 94 210 134M44 155 152 93M72 171 179 108M98 180 206 123" />
              <path d="M306 53 422 117M334 37 450 101M361 22 477 86M308 84 416 22M336 100 444 38M364 116 472 54" />
              <path d="M130 137 130 83M396 71 396 17" strokeDasharray="3 5" />
            </g>
            <path d="M130 122C217 122 211 58 300 58H396" stroke="currentColor" strokeWidth="2" />
            <circle cx="130" cy="122" r="7" fill="currentColor" />
            <circle cx="396" cy="58" r="7" fill="currentColor" />
            <path d="m259 67 10 4-6 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="setu-login-v2__workflow" aria-label="SETU workflow">
            <div><span>01</span><strong>Capture</strong></div>
            <div><span>02</span><strong>Review</strong></div>
            <div><span>03</span><strong>Plan</strong></div>
          </div>
        </div>

        <div className="setu-login-v2__story-footer">
          <p className="setu-login-v2__eyebrow">SIH26122</p>
          <p>Oil India Limited</p>
        </div>
      </aside>

      <section className="setu-login-v2__access" aria-labelledby="setu-login-title">
        <div className="setu-login-v2__access-header">
          <Icon className="setu-login-v2__header-icon"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3 M12 15v2" /></Icon>
          <p className="setu-login-v2__eyebrow">YOUR WORKSPACE STARTS HERE</p>
        </div>

        <div className="setu-login-v2__form-wrap">
          <header className="setu-login-v2__form-heading">
            <h1 id="setu-login-title">Welcome back.</h1>
            <p>Sign in with your assigned SETU account.</p>
          </header>

          <form className="setu-login-v2__form" noValidate onSubmit={submit} aria-busy={busy}>
            {hasMultipleFieldErrors && (
              <div className="setu-login-v2__message setu-login-v2__message--error" role="alert">
                <strong>Check these fields to continue.</strong>
                <a href="#setu-email" onClick={() => document.getElementById('setu-email')?.focus()}>{fieldErrors.email}</a>
                <a href="#setu-password" onClick={() => document.getElementById('setu-password')?.focus()}>{fieldErrors.password}</a>
              </div>
            )}
            {signInError && (
              <div className="setu-login-v2__message setu-login-v2__message--error" role="alert">
                <strong>Sign-in couldn&apos;t be completed.</strong>
                <p>{signInError}</p>
              </div>
            )}

            <div className="setu-login-v2__field">
              <label htmlFor="setu-email">Work email <span>(required)</span></label>
              <input
                id="setu-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                value={email}
                disabled={busy}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'setu-email-error' : undefined}
                onChange={(event) => { setEmail(event.target.value); clearFieldError('email'); setSignInError(null); }}
              />
              {fieldErrors.email && <p className="setu-login-v2__field-error" id="setu-email-error" role="alert">{fieldErrors.email}</p>}
            </div>

            <div className="setu-login-v2__field">
              <label htmlFor="setu-password">Password <span>(required)</span></label>
              <div className={`setu-login-v2__password ${fieldErrors.password ? 'setu-login-v2__password--invalid' : ''}`}>
                <input
                  id="setu-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  disabled={busy}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'setu-password-error' : undefined}
                  onChange={(event) => { setPassword(event.target.value); clearFieldError('password'); setSignInError(null); }}
                />
                <button
                  className="setu-login-v2__reveal"
                  type="button"
                  disabled={busy}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls="setu-password"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword
                    ? <Icon><path d="m3 3 18 18 M10.6 10.6a2 2 0 0 0 2.8 2.8 M9.7 5.3A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-3.2 4.1 M6.3 6.3A18.4 18.4 0 0 0 2 12s3.5 7 10 7a11.8 11.8 0 0 0 5.7-1.7" /></Icon>
                    : <Icon><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></Icon>}
                </button>
              </div>
              {fieldErrors.password && <p className="setu-login-v2__field-error" id="setu-password-error" role="alert">{fieldErrors.password}</p>}
            </div>

            <button className="setu-login-v2__submit" type="submit" disabled={busy}>
              <span>{busy ? 'Signing in…' : 'Sign in to SETU'}</span>
              {!busy && <Icon><path d="M5 12h14m-6-6 6 6-6 6" /></Icon>}
            </button>
          </form>

          <section className="setu-login-v2__demo" aria-labelledby="setu-demo-title">
            <div className="setu-login-v2__demo-heading">
              <h2 id="setu-demo-title">Explore with a demo account</h2>
              <p>Choose a role to fill in the sign-in details.</p>
            </div>
            <div className="setu-login-v2__demo-grid">
              <button type="button" disabled={busy} aria-pressed={selectedDemo === 'planner'} onClick={() => selectDemo('planner')}>
                <Icon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M17 10l2 2 4-4" /><circle cx="9" cy="7" r="4" /></Icon>
                <span>Planner</span>
              </button>
              <button type="button" disabled={busy} aria-pressed={selectedDemo === 'supervisor'} onClick={() => selectDemo('supervisor')}>
                <Icon><path d="M5 17v-3a7 7 0 0 1 5-6.7 M14 7.3A7 7 0 0 1 19 14v3 M10 12V5h4v7 M3 17h18v4H3Z" /></Icon>
                <span>Site Engineer</span>
              </button>
            </div>
            <p className="setu-login-v2__demo-help">Demo accounts must be enabled by your workspace administrator.</p>
          </section>
        </div>

        <footer className="setu-login-v2__access-footer">
          <Icon><path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Z m-4 9 3 3 5-5" /></Icon>
          <p>Account access follows your assigned role.</p>
        </footer>
      </section>
    </main>
  );
};
