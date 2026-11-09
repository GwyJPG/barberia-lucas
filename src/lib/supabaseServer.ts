import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Configuración crítica ausente: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY deben estar definidos en el entorno del servidor.'
  );
}

/**
 * Cliente administrativo de Supabase con privilegios elevados (Bypass RLS).
 * EXCLUSIVO para operaciones del lado del servidor (SSR, Astro API Endpoints, Middlewares).
 * NUNCA exponer al cliente / navegador.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
