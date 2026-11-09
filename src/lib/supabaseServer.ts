import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.SUPABASE_URL ||
  import.meta.env.PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  'https://rigdkefyymdhjaakotrs.supabase.co';

const supabaseServiceRoleKey =
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey || 'dummy-service-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
