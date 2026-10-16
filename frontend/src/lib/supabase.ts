import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://zbndpmvihnsdknklmabn.supabase.co';
const configuredSupabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

// Keep the login screen usable in an isolated local checkout without copying a
// workspace's .env.local. AuthContext returns a clear configuration error before
// any sign-in attempt in this state; production continues to use its configured key.
export const SUPABASE_CONFIGURATION_ERROR =
  'SETU authentication is not configured for this local workspace. Add VITE_SUPABASE_PUBLISHABLE_KEY to .env.local.';

export const isSupabaseConfigured = Boolean(
  configuredSupabaseAnonKey && configuredSupabaseAnonKey !== 'replace_with_publishable_or_anon_key'
);
const supabaseAnonKey = configuredSupabaseAnonKey || 'local-development-missing-publishable-key';

if (!isSupabaseConfigured) {
  console.warn(
    'SETU: VITE_SUPABASE_PUBLISHABLE_KEY is not set in .env.local. Authentication is disabled for this workspace.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
