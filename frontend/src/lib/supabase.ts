import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://zbndpmvihnsdknklmabn.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseAnonKey || supabaseAnonKey === 'replace_with_publishable_or_anon_key') {
  console.warn(
    'SETU: VITE_SUPABASE_PUBLISHABLE_KEY is not set in .env.local! Supabase queries may fail.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
