import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import './RoleSelection.css';
import { currentEvaluatorAccess, enterEvaluatorRole, createEvaluatorWorkspace, forgetEvaluatorAccess, type EvaluatorAccess, type EvaluatorRole } from '../lib/evaluatorAccess';
import { evaluatorProof } from '../lib/evaluatorChallenge';

type WorkspaceRole = 'planner' | 'supervisor';
type FieldErrors = { role?: string; email?: string; password?: string };

function assignedWorkspaceRole(role: string): WorkspaceRole | null {
  if (role === 'planner' || role === 'admin') return 'planner';
  if (role === 'site' || role === 'engineer') return 'supervisor';
  return null;
}

function Icon({ children, className = 'setu-login-v2__icon' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const RoleSelection: React.FC = () => {
  const { signIn, signOut, refreshRole, sessionIssue } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [signInError, setSignInError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole | null>(null);
  const [evaluatorCredentials, setEvaluatorCredentials] = useState<EvaluatorAccess | null>(() => currentEvaluatorAccess());
  const [showEvaluator, setShowEvaluator] = useState(() => Boolean(currentEvaluatorAccess()));
  const [evaluatorBusy, setEvaluatorBusy] = useState(false);
  const [evaluatorError, setEvaluatorError] = useState('');
  const [copied, setCopied] = useState('');

  const startEvaluatorLogin = async () => {
    if (evaluatorBusy) return;
    setShowEvaluator(true);
    setEvaluatorError('');
    const current = currentEvaluatorAccess();
    if (current) { setEvaluatorCredentials(current); return; }
    setEvaluatorBusy(true);
    try {
      // A Turnstile check runs in the background; most evaluators need only
      // this one click. The backend also enforces admission quotas.
      const token = await evaluatorProof();
      const pair = await createEvaluatorWorkspace(token);
      setEvaluatorCredentials(pair);
    } catch (error) {
      setEvaluatorError(error instanceof Error ? error.message : 'Unable to create a demo workspace.');
    } finally {
      setEvaluatorBusy(false);
    }
  };

  const loginEvaluatorRole = async (role: EvaluatorRole) => {
    setEvaluatorError('');
    setEvaluatorBusy(true);
    try {
      await enterEvaluatorRole(role);
      const resolved = await refreshRole();
      if (resolved !== role) throw new Error('The temporary account has expired or its role is unavailable.');
      navigate(role === 'site' ? '/supervisor/capture' : '/planner/command-center', { replace: true });
    } catch (error) {
      setEvaluatorError(error instanceof Error ? error.message : 'Evaluator sign-in failed.');
    } finally {
      setEvaluatorBusy(false);
    }
  };

  const copyEvaluatorValue = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label + ' copied');
    } catch {
      setCopied('Copy unavailable. Select the credential text manually.');
    }
  };


  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!selectedRole) next.role = 'Choose your role before signing in.';
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

      if (!result.userId) {
        setSignInError('Sign-in did not create an active session. Please try again.');
        return;
      }

      let role;
      try {
        role = await refreshRole(result.userId);
      } catch (error: unknown) {
        // Verification failed, so no access is granted: end the session
        // instead of leaving a half-signed-in account on the login page.
        try { await signOut(); } catch { /* sign-out is best effort here */ }
        setSignInError(error instanceof Error ? error.message : 'SETU role lookup failed. Please try again.');
        return;
      }

      const assigned = role ? assignedWorkspaceRole(role) : null;
      if (!assigned) {
        try { await signOut(); } catch { /* sign-out is best effort here */ }
        setSignInError('Authenticated account has no SETU role assignment.');
        return;
      }

      if (assigned !== selectedRole) {
        // Security: deny this login without disclosing the assigned
        // role. Naming it (or a switch button naming it) would let
        // anyone probing the role buttons learn the account's role.
        // The session is signed out, and the password is cleared like
        // any other failed sign-in.
        try { await signOut(); } catch { /* sign-out is best effort here */ }
        setPassword('');
        setSignInError('This account does not have access with the selected role. Try another role, or contact your workspace administrator.');
        return;
      }

      if (assigned === 'planner') {
        try {
          navigate('/planner/command-center', { replace: true });
        } catch {
          setSignInError('Sign-in succeeded, but SETU could not open your planner workspace. Please reload.');
        }
      } else {
        try {
          navigate('/supervisor/capture', { replace: true });
        } catch {
          setSignInError('Sign-in succeeded, but SETU could not open your site workspace. Please reload.');
        }
      }
    } catch (error: unknown) {
      setSignInError(error instanceof Error ? error.message : 'Unable to sign in to SETU.');
    } finally {
      setBusy(false);
    }
  };

  const selectRole = (role: WorkspaceRole) => {
    setSelectedRole(role);
    setFieldErrors((current) => (current.role ? { ...current, role: undefined } : current));
    setSignInError(null);
  };

  const hasMultipleFieldErrors = Boolean(fieldErrors.email && fieldErrors.password);

  return (
    <main className="setu-login-v2">
      <header className="setu-login-v2__desktop-header">
        <span className="setu-login-v2__desktop-brand" aria-hidden="true">SETU</span>
        <span className="setu-login-v2__desktop-help">Need help? <span>Contact administrator</span></span>
      </header>

      <section className="setu-login-v2__access" aria-labelledby="setu-login-title">

        <div className="setu-login-v2__form-wrap">
          <div className="setu-login-v2__brand" aria-hidden="true">SETU</div>
          <header className="setu-login-v2__form-heading">
            <h1 id="setu-login-title">Sign in to SETU</h1>
            <p>Use your workspace account to continue.</p>
          </header>


          <form className="setu-login-v2__form" noValidate onSubmit={submit} aria-busy={busy}>
            {hasMultipleFieldErrors && (
              <div className="setu-login-v2__message setu-login-v2__message--error" role="alert">
                <strong>Check these fields to continue.</strong>
                <a href="#setu-email" onClick={() => document.getElementById('setu-email')?.focus()}>{fieldErrors.email}</a>
                <a href="#setu-password" onClick={() => document.getElementById('setu-password')?.focus()}>{fieldErrors.password}</a>
              </div>
            )}
            {(signInError || sessionIssue) && (
              <div className="setu-login-v2__message setu-login-v2__message--error" role="alert">
                <strong>{signInError ? 'Sign-in couldn&apos;t be completed.' : 'Session needs attention.'}</strong>
                <p>{signInError ?? sessionIssue}</p>
              </div>
            )}

            <div className="setu-login-v2__field">
              <div className="setu-login-v2__role-grid" role="group" aria-label="Your role">
                <button type="button" disabled={busy} aria-pressed={selectedRole === 'planner'} onClick={() => selectRole('planner')}>
                  Planner
                </button>
                <button type="button" disabled={busy} aria-pressed={selectedRole === 'supervisor'} onClick={() => selectRole('supervisor')}>
                  Site Engineer
                </button>
              </div>
              {fieldErrors.role && <p className="setu-login-v2__field-error" role="alert">{fieldErrors.role}</p>}
            </div>

            <div className="setu-login-v2__field">
              <label htmlFor="setu-email">Work email</label>
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
              <label htmlFor="setu-password">Password</label>
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
              <span>{busy ? 'Signing in…' : 'Sign in'}</span>
              {!busy && <Icon><path d="M5 12h14m-6-6 6 6-6 6" /></Icon>}
            </button>
          </form>

          <div className="setu-login-v2__divider" aria-hidden="true">or</div>

          <section className="setu-login-v2__evaluator" aria-label="SIH evaluator access">
            <button
              type="button"
              className="setu-login-v2__evaluator-button"
              disabled={busy || evaluatorBusy}
              aria-expanded={showEvaluator}
              onClick={() => { void startEvaluatorLogin(); }}
            >
              {evaluatorBusy ? 'Generating secure credentials…' : 'SIH Evaluator Login'}
            </button>
            {showEvaluator && (
              <div className="setu-login-v2__evaluator-result" role="region" aria-label="Temporary evaluator credentials">
                {evaluatorError && <p className="setu-login-v2__message setu-login-v2__message--error" role="alert">{evaluatorError}</p>}
                {evaluatorBusy && <p role="status">Preparing real SETU accounts…</p>}
                {evaluatorCredentials && (
                  <>
                    <p className="setu-login-v2__evaluator-summary">
                      <strong>Pair ready · 48 hours</strong>
                      {' '}· Expires {new Date(evaluatorCredentials.expiresAt).toLocaleString()}
                      {' '}· Workspace {evaluatorCredentials.site.email.split('@')[0].replace('supervisor-', '')}
                    </p>
                    <p className="setu-login-v2__evaluator-caption">
                      <code>@setu.invalid</code> is a login name, not an inbox. Both roles share this workspace.
                    </p>
                    <div className="setu-login-v2__evaluator-list">
                      {(['site', 'planner'] as const).map(role => (
                        <div className="setu-login-v2__evaluator-row" key={role}>
                          <div className="setu-login-v2__evaluator-row-head">
                            <strong>{role === 'site' ? 'Supervisor' : 'Planner'}</strong>
                            <button type="button" className="setu-login-v2__evaluator-enter-compact"
                              disabled={evaluatorBusy} onClick={() => { void loginEvaluatorRole(role); }}>
                              {role === 'site' ? 'Login as Supervisor' : 'Login as Planner'}
                            </button>
                          </div>
                          <div className="setu-login-v2__evaluator-field">
                            <span>Email</span>
                            <input readOnly aria-label={(role === 'site' ? 'Supervisor' : 'Planner') + ' demo email'} value={evaluatorCredentials[role].email} />
                            <button type="button" className="setu-login-v2__evaluator-copy" aria-label={'Copy ' + (role === 'site' ? 'Supervisor' : 'Planner') + ' email'} onClick={() => { void copyEvaluatorValue(evaluatorCredentials[role].email, role + ' email'); }}>Copy</button>
                          </div>
                          <div className="setu-login-v2__evaluator-field">
                            <span>Password</span>
                            <input readOnly type="text" autoComplete="off"
                              aria-label={(role === 'site' ? 'Supervisor' : 'Planner') + ' demo password'} value={evaluatorCredentials[role].password} />
                            <button type="button" className="setu-login-v2__evaluator-copy" aria-label={'Copy ' + (role === 'site' ? 'Supervisor' : 'Planner') + ' password'} onClick={() => { void copyEvaluatorValue(evaluatorCredentials[role].password, role + ' password'); }}>Copy</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {copied && <p role="status" className="setu-login-v2__evaluator-caption">{copied}</p>}
                    <p className="setu-login-v2__evaluator-caption">
                      Sign out of one role to open the other, or use Open Planner / Open Supervisor in the header.
                      Use fictional reports labelled SIH EVALUATOR DEMO ONLY.
                    </p>
                    <button type="button" className="setu-login-v2__evaluator-clear"
                      onClick={() => {
                        if (!window.confirm('End this evaluation and forget both temporary credentials?')) return;
                        forgetEvaluatorAccess();
                        setEvaluatorCredentials(null);
                        setShowEvaluator(false);
                        setCopied('');
                      }}>
                      End demo &amp; forget credentials in this browser
                    </button>
                  </>
                )}
                {!evaluatorCredentials && !evaluatorBusy && (
                  <p className="setu-login-v2__evaluator-note">
                    Each visitor can generate a separate Supervisor/Planner pair after a short security verification.
                  </p>
                )}
              </div>
            )}
          </section>

          <p className="setu-login-v2__footer">Need help? Contact your workspace administrator.</p>
        </div>

      </section>
      <p className="setu-login-v2__desktop-footer">SETU · Workspace sign-in</p>
    </main>
  );
};
