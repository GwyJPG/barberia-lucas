import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[SupabaseClient] Warning: SUPABASE_URL or SUPABASE_ANON_KEY is missing in environment variables.');
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');
