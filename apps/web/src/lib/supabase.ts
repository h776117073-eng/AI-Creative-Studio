import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const authConfigurationError = {
  name: 'SupabaseConfigurationError',
  message: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable authentication.',
};

const demoSupabaseClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({
      data: {
        subscription: {
          unsubscribe: () => {},
        },
      },
    }),
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: authConfigurationError }),
    signUp: async () => ({ data: { user: null, session: null }, error: authConfigurationError }),
    signOut: async () => ({ error: null }),
  },
} as unknown as SupabaseClient;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : demoSupabaseClient;
