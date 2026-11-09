import { defineMiddleware } from 'astro:middleware';
import { supabaseAdmin } from './lib/supabaseServer';

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, cookies, redirect } = context;
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  const slugBarber = import.meta.env.SECRET_BARBER_SLUG;
  const slugOwner = import.meta.env.SECRET_OWNER_SLUG;
  const slugSuper = import.meta.env.SECRET_SUPERADMIN_SLUG;

  const esRutaBarber = slugBarber && (pathname === `/${slugBarber}` || pathname.startsWith(`/${slugBarber}/`));
  const esRutaOwner = slugOwner && (pathname === `/${slugOwner}` || pathname.startsWith(`/${slugOwner}/`));
  const esRutaSuper = slugSuper && (pathname === `/${slugSuper}` || pathname.startsWith(`/${slugSuper}/`));
  const esApiPrivada =
    pathname.startsWith('/api/barber') ||
    pathname.startsWith('/api/owner') ||
    pathname.startsWith('/api/superadmin');

  if (!esRutaBarber && !esRutaOwner && !esRutaSuper && !esApiPrivada) {
    return next();
  }

  const slugActual = esRutaSuper ? slugSuper : esRutaOwner ? slugOwner : slugBarber;
  const esLoginPage = pathname === `/${slugActual}/login`;
  const token = cookies.get('sb-access-token')?.value;

  if (!token) {
    if (esApiPrivada) {
      return new Response(JSON.stringify({ exito: false, error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!esLoginPage) return redirect(`/${slugActual}/login`);
    const res = await next();
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
  }

  const { data: authData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !authData?.user) {
    cookies.delete('sb-access-token', { path: '/' });
    cookies.delete('sb-refresh-token', { path: '/' });
    return esApiPrivada
      ? new Response(JSON.stringify({ exito: false, error: 'Sesión inválida' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      : esLoginPage
      ? next()
      : redirect(`/${slugActual}/login`);
  }

  const { data: staff } = await supabaseAdmin
    .from('perfiles_staff')
    .select('rol, activo, nombre_visible, bloqueado_hasta')
    .eq('id', authData.user.id)
    .single();

  if (!staff || !staff.activo || (staff.bloqueado_hasta && new Date(staff.bloqueado_hasta) > new Date())) {
    cookies.delete('sb-access-token', { path: '/' });
    cookies.delete('sb-refresh-token', { path: '/' });
    if (esApiPrivada) {
      return new Response(JSON.stringify({ exito: false, error: 'Cuenta inactiva o bloqueada.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return esLoginPage ? next() : redirect(`/${slugActual}/login`);
  }

  // Verificar permisos para APIs privadas
  if (pathname.startsWith('/api/superadmin') && staff.rol !== 'superadmin') {
    return new Response(JSON.stringify({ exito: false, error: 'No autorizado' }), { status: 403 });
  }
  if (pathname.startsWith('/api/owner') && !['owner', 'superadmin'].includes(staff.rol)) {
    return new Response(JSON.stringify({ exito: false, error: 'No autorizado' }), { status: 403 });
  }
  if (pathname.startsWith('/api/barber') && !['barber', 'owner', 'superadmin'].includes(staff.rol)) {
    return new Response(JSON.stringify({ exito: false, error: 'No autorizado' }), { status: 403 });
  }

  // Si está en una ruta de portal (Superadmin, Owner o Barber) pero su cookie actual es de otro rol menor:
  // Permitir ver la pantalla de /login para que pueda cambiar de cuenta sin bloqueo 404
  const tienePermisoPortal =
    (esRutaSuper && staff.rol === 'superadmin') ||
    (esRutaOwner && ['owner', 'superadmin'].includes(staff.rol)) ||
    (esRutaBarber && ['barber', 'owner', 'superadmin'].includes(staff.rol));

  if (!tienePermisoPortal && !esApiPrivada) {
    if (!esLoginPage) {
      return redirect(`/${slugActual}/login`);
    }
    // En la página de login, no inyectamos el rol anterior para que muestre el formulario de login limpio
    const res = await next();
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
  }

  context.locals.user = authData.user;
  context.locals.rol = staff.rol;
  context.locals.nombre_visible = staff.nombre_visible;

  const response = await next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
});
