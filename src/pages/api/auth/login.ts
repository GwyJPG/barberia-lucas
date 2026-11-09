import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { checkRateLimit, getClientIp } from '../../../lib/rateLimit';

export const prerender = false;

const supabaseUrl =
  import.meta.env.PUBLIC_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://rigdkefyymdhjaakotrs.supabase.co';

const supabaseAnonKey =
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY ||
  import.meta.env.SUPABASE_ANON_KEY ||
  process.env.PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

export const POST: APIRoute = async ({ request, cookies }) => {
  const clientIp = getClientIp(request);
  const rl = checkRateLimit(`login:${clientIp}`, { maxRequests: 15, windowMs: 60 * 1000 });
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ exito: false, error: 'Demasiados intentos de inicio de sesión. Espera un minuto.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { email, password, rol_esperado } = body;

    if (!email || !password) {
      return new Response(
        JSON.stringify({ exito: false, error: 'Correo electrónico y contraseña requeridos.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const emailTrimmed = String(email).trim().toLowerCase();

    // 1. Obtener usuario de Supabase Auth para verificar intentos previos
    let targetUser: any = null;
    try {
      const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
      targetUser = usersList?.users?.find((u) => u.email?.toLowerCase() === emailTrimmed);
    } catch (e) {
      console.warn('No se pudo listar usuarios admin para chequeo previo:', e);
    }

    let staffProfile: any = null;
    if (targetUser) {
      const { data: profile } = await supabaseAdmin
        .from('perfiles_staff')
        .select('*')
        .eq('id', targetUser.id)
        .single();
      staffProfile = profile;
    }

    // 2. Verificar si la cuenta está bloqueada por intentos fallidos
    if (staffProfile?.bloqueado_hasta) {
      const bloqueoExpira = new Date(staffProfile.bloqueado_hasta).getTime();
      const ahora = Date.now();
      if (bloqueoExpira > ahora) {
        const minutosRestantes = Math.ceil((bloqueoExpira - ahora) / (60 * 1000));
        return new Response(
          JSON.stringify({
            exito: false,
            error: `Acceso bloqueado por seguridad tras 5 intentos fallidos. Intenta nuevamente en ${minutosRestantes} minuto(s).`,
          }),
          { status: 423, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 3. Autenticación con Supabase Auth usando un cliente efímero (sin contaminar supabaseAdmin)
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: emailTrimmed,
      password: String(password),
    });

    // 4. Manejo de contraseña incorrecta / credenciales fallidas
    if (authError || !authData.session) {
      if (staffProfile) {
        const nuevosIntentos = (staffProfile.intentos_fallidos || 0) + 1;
        let updatePayload: any = { intentos_fallidos: nuevosIntentos };

        if (nuevosIntentos >= 5) {
          // Bloqueo de 30 minutos
          updatePayload.bloqueado_hasta = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        }

        await supabaseAdmin
          .from('perfiles_staff')
          .update(updatePayload)
          .eq('id', staffProfile.id);

        if (nuevosIntentos >= 5) {
          return new Response(
            JSON.stringify({
              exito: false,
              error: 'Has alcanzado el límite de 5 intentos fallidos. Tu acceso ha sido bloqueado por 30 minutos.',
            }),
            { status: 423, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            exito: false,
            error: `Credenciales inválidas. Intento ${nuevosIntentos} de 5 antes del bloqueo temporal.`,
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ exito: false, error: 'Credenciales inválidas o usuario no registrado.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Autenticación exitosa: Validar perfil activo y rol
    const userId = authData.user.id;
    const { data: verifiedProfile, error: profileError } = await supabaseAdmin
      .from('perfiles_staff')
      .select('id, nombre_visible, rol, activo, avatar_url')
      .eq('id', userId)
      .single();

    if (profileError || !verifiedProfile) {
      return new Response(
        JSON.stringify({ exito: false, error: 'El usuario no tiene un perfil de staff asignado.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!verifiedProfile.activo) {
      return new Response(
        JSON.stringify({ exito: false, error: 'Tu cuenta ha sido dada de baja por administración.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validar rol esperado si se especificó
    const puedeAcceder =
      !rol_esperado ||
      verifiedProfile.rol === rol_esperado ||
      verifiedProfile.rol === 'superadmin' ||
      (rol_esperado === 'barber' && verifiedProfile.rol === 'owner');

    if (!puedeAcceder) {
      return new Response(
        JSON.stringify({ exito: false, error: 'No tienes los permisos asignados para acceder a este portal.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Resetear contador de intentos fallidos
    await supabaseAdmin
      .from('perfiles_staff')
      .update({ intentos_fallidos: 0, bloqueado_hasta: null })
      .eq('id', userId);

    // 7. Establecer cookies HttpOnly seguras (solo secure en conexiones HTTPS reales)
    const isHttps =
      request.url.startsWith('https://') ||
      request.headers.get('x-forwarded-proto') === 'https';
    cookies.set('sb-access-token', authData.session.access_token, {
      path: '/',
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: authData.session.expires_in,
    });

    cookies.set('sb-refresh-token', authData.session.refresh_token, {
      path: '/',
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 días
    });

    return new Response(
      JSON.stringify({
        exito: true,
        rol: verifiedProfile.rol,
        nombre: verifiedProfile.nombre_visible,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error en login:', err);
    return new Response(
      JSON.stringify({ exito: false, error: 'Error interno del servidor durante la autenticación.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
