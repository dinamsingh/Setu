import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, SUPABASE_CONFIGURATION_ERROR, supabase } from './supabase';
import type { UserRole } from '../types';

type AppRole = Exclude<UserRole, null>;
type RoleRequest = {
  generation: number;
  promise: Promise<AppRole | null>;
  userId: string;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  loading: boolean;
  sessionIssue: string | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null; userId: string | null }>;
  signOut: () => Promise<{ error: Error | null }>;
  refreshRole: (userId?: string) => Promise<AppRole | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isNetworkError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /network|fetch|offline|timeout|timed out|connection/i.test(`${name} ${message}`);
}

function authError(operation: 'sign-in' | 'role' | 'session' | 'sign-out', error: unknown) {
  if (operation === 'sign-in') {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/invalid login credentials|invalid.*(?:email|password)|email not confirmed/i.test(message)) {
      return new Error('Invalid email or password. Please try again.');
    }
    if (isNetworkError(error)) return new Error('Network error while signing in. Check your connection and try again.');
    return new Error('SETU could not sign you in. Please try again.');
  }

  if (operation === 'role') {
    if (isNetworkError(error)) return new Error('Network error while resolving your SETU role. Check your connection and try again.');
    return new Error('SETU role lookup failed. Please try again.');
  }

  if (operation === 'session') {
    if (isNetworkError(error)) return new Error('Network error while restoring your SETU session. Please sign in again when you are online.');
    return new Error('We could not restore your SETU session. Please sign in again.');
  }

  if (isNetworkError(error)) return new Error('Network error while signing out. Check your connection and try again.');
  return new Error('SETU could not sign you out. Please try again.');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [sessionIssue, setSessionIssue] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const sessionRef = useRef<Session | null>(null);
  const sessionGenerationRef = useRef(0);
  const roleGenerationRef = useRef(0);
  const roleRequestRef = useRef<RoleRequest | null>(null);

  const resolveRoleForUser = useCallback((userId: string): Promise<AppRole | null> => {
    if (!isSupabaseConfigured) {
      if (mountedRef.current) setRole(null);
      return Promise.reject(new Error(SUPABASE_CONFIGURATION_ERROR));
    }

    const generation = roleGenerationRef.current;
    const inFlight = roleRequestRef.current;
    if (inFlight && inFlight.userId === userId && inFlight.generation === generation) return inFlight.promise;

    const promise = (async () => {
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;

        const nextRole = (data?.role as AppRole | undefined) ?? null;
        if (mountedRef.current && roleGenerationRef.current === generation) setRole(nextRole);
        return nextRole;
      } catch (error) {
        if (mountedRef.current && roleGenerationRef.current === generation) setRole(null);
        throw authError('role', error);
      }
    })();

    roleRequestRef.current = { generation, promise, userId };
    void promise.finally(() => {
      if (roleRequestRef.current?.promise === promise) roleRequestRef.current = null;
    }).catch(() => undefined);
    return promise;
  }, []);

  const refreshRole = useCallback((userId?: string) => {
    if (!isSupabaseConfigured) {
      if (mountedRef.current) setRole(null);
      return Promise.reject(new Error(SUPABASE_CONFIGURATION_ERROR));
    }

    const activeUserId = userId ?? sessionRef.current?.user?.id;
    if (!activeUserId) {
      if (mountedRef.current) setRole(null);
      return Promise.resolve(null);
    }
    return resolveRoleForUser(activeUserId);
  }, [resolveRoleForUser]);

  useEffect(() => {
    mountedRef.current = true;
    if (!isSupabaseConfigured) {
      return () => {
        mountedRef.current = false;
      };
    }

    let active = true;
    let roleTimer: ReturnType<typeof setTimeout> | undefined;

    const invalidateRoleRequest = () => {
      roleGenerationRef.current += 1;
      roleRequestRef.current = null;
    };

    const scheduleRoleResolution = (nextSession: Session, generation: number) => {
      if (roleTimer) clearTimeout(roleTimer);
      roleTimer = setTimeout(() => {
        if (!active || generation !== sessionGenerationRef.current) return;

        // Supabase requires this call to occur after onAuthStateChange has returned.
        void refreshRole(nextSession.user.id)
          .catch((error) => {
            if (active && generation === sessionGenerationRef.current) {
              setSessionIssue(error instanceof Error ? error.message : authError('session', error).message);
            }
          })
          .finally(() => {
            if (active && generation === sessionGenerationRef.current) setLoading(false);
          });
      }, 0);
    };

    const applySession = (nextSession: Session | null) => {
      const generation = ++sessionGenerationRef.current;
      invalidateRoleRequest();
      sessionRef.current = nextSession;
      setSession(nextSession);
      setRole(null);
      setSessionIssue(null);

      if (!nextSession) {
        if (roleTimer) clearTimeout(roleTimer);
        setLoading(false);
        return;
      }

      scheduleRoleResolution(nextSession, generation);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      // Do not await or start another Supabase call in this callback. Supabase can deadlock otherwise.
      applySession(nextSession);
    });

    const initialGeneration = sessionGenerationRef.current;
    void supabase.auth.getSession()
      .then(({ data: { session: restoredSession }, error }) => {
        if (!active || initialGeneration !== sessionGenerationRef.current) return;
        if (error) {
          invalidateRoleRequest();
          sessionRef.current = null;
          setSession(null);
          setRole(null);
          setSessionIssue(authError('session', error).message);
          setLoading(false);
          return;
        }
        applySession(restoredSession);
      })
      .catch((error) => {
        if (!active || initialGeneration !== sessionGenerationRef.current) return;
        invalidateRoleRequest();
        sessionRef.current = null;
        setSession(null);
        setRole(null);
        setSessionIssue(authError('session', error).message);
        setLoading(false);
      });

    return () => {
      active = false;
      mountedRef.current = false;
      if (roleTimer) clearTimeout(roleTimer);
      subscription.unsubscribe();
    };
  }, [refreshRole]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error(SUPABASE_CONFIGURATION_ERROR), userId: null };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: authError('sign-in', error), userId: null };
      if (!data.session || !data.user) {
        return { error: new Error('Sign-in did not create an active session. Please try again.'), userId: null };
      }
      return { error: null, userId: data.user.id };
    } catch (error) {
      return { error: authError('sign-in', error), userId: null };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return { error: new Error(SUPABASE_CONFIGURATION_ERROR) };
    try {
      const { error } = await supabase.auth.signOut();
      return { error: error ? authError('sign-out', error) : null };
    } catch (error) {
      return { error: authError('sign-out', error) };
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    role,
    loading,
    sessionIssue,
    signIn,
    signOut,
    refreshRole,
  }), [session, role, loading, sessionIssue, signIn, signOut, refreshRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
