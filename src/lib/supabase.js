import { createClient } from '@supabase/supabase-js';
import { migrateOperatorSession } from './authSession';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const operatorStorageKey = 'mantos_operator_auth_v1';
if (isSupabaseConfigured && typeof window !== 'undefined') {
  try {
    const previousKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
    migrateOperatorSession(window.localStorage, previousKey, operatorStorageKey);
  } catch {
    // Supabase handles unavailable browser storage using its memory fallback.
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

// Separate storage prevents background synchronization from replacing admin tokens.
export const operatorSupabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: operatorStorageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
