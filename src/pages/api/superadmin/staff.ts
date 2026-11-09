import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const rol = locals.rol;

  // Acceso exclusivo para superadmin
  if (!user || rol !== 'superadmin') {
    return new Response(
      JSON.stringify({ exito: false, error: 'Acceso no autorizado a consola de soporte.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const {
      accion,
      user_id,
      email,
      password,
      nombre_visible,
      nombre,
      nuevo_nombre,
      nuevo_rol,
      activo,
      atiende_cortes,
      nueva_password,
    } = body;

    // 1. CREAR NUEVO USUARIO DE STAFF (BARBERO O GERENCIA)
    if (accion === 'crear') {
      const nombreFinal = String(nombre || nombre_visible || '').trim();
      if (!email || !password || !nombreFinal || !nuevo_rol) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Todos los campos son requeridos para dar de alta staff.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!['barber', 'owner'].includes(nuevo_rol)) {
        return new Response(
          JSON.stringify({ exito: false, error: 'El rol debe ser "barber" u "owner".' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const cleanEmail = String(email).trim().toLowerCase();

      const { data: newUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: String(password),
        email_confirm: true,
        user_metadata: {
          nombre: nombreFinal,
          rol: nuevo_rol,
        },
      });

      if (authErr || !newUser?.user) {
        return new Response(
          JSON.stringify({ exito: false, error: authErr?.message || 'Error al crear credenciales de acceso.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: profileErr } = await supabaseAdmin.from('perfiles_staff').upsert({
        id: newUser.user.id,
        nombre_visible: nombreFinal,
        rol: nuevo_rol,
        activo: true,
        atiende_cortes: atiende_cortes !== undefined ? Boolean(atiende_cortes) : true,
      });

      if (profileErr) {
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
        return new Response(
          JSON.stringify({ exito: false, error: profileErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: `Trabajador ${nombreFinal} creado exitosamente.`,
          user_id: newUser.user.id,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. CAMBIAR NOMBRE DE TRABAJADOR O GERENTE
    if (accion === 'editar_nombre') {
      const cleanName = String(nuevo_nombre || '').trim();
      if (!user_id || cleanName.length < 2) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Nombre válido requerido.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: updErr } = await supabaseAdmin
        .from('perfiles_staff')
        .update({ nombre_visible: cleanName })
        .eq('id', user_id);

      if (updErr) {
        return new Response(
          JSON.stringify({ exito: false, error: updErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      await supabaseAdmin.auth.admin.updateUserById(user_id, {
        user_metadata: { nombre_visible: cleanName, nombre: cleanName },
      });

      return new Response(
        JSON.stringify({ exito: true, mensaje: 'Nombre actualizado correctamente.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. ELIMINAR DEFINITIVAMENTE A UN TRABAJADOR
    if (accion === 'eliminar') {
      if (!user_id) {
        return new Response(
          JSON.stringify({ exito: false, error: 'user_id es obligatorio para eliminar.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (user_id === user.id) {
        return new Response(
          JSON.stringify({ exito: false, error: 'No puedes eliminar tu propia cuenta de Soporte.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Eliminar dependencias de agenda/citas antes de borrar perfil y cuenta Auth
      await supabaseAdmin.from('citas').delete().eq('barbero_id', user_id);
      await supabaseAdmin.from('bloqueos_agenda').delete().eq('barbero_id', user_id);
      await supabaseAdmin.from('historial_clientes_barbero').delete().eq('barbero_id', user_id);
      await supabaseAdmin.from('perfiles_staff').delete().eq('id', user_id);
      const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(user_id);

      if (delAuthErr) {
        return new Response(
          JSON.stringify({ exito: false, error: delAuthErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ exito: true, mensaje: 'Trabajador eliminado definitivamente.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. ALTA / BAJA LÓGICA DE STAFF CON BANEO EN AUTH
    if (accion === 'toggle_activo') {
      if (!user_id || typeof activo !== 'boolean') {
        return new Response(
          JSON.stringify({ exito: false, error: 'user_id y activo (boolean) son obligatorios.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: profileErr } = await supabaseAdmin
        .from('perfiles_staff')
        .update({ activo })
        .eq('id', user_id);

      if (profileErr) {
        return new Response(
          JSON.stringify({ exito: false, error: profileErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const banDuration = activo ? 'none' : '876000h';
      await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: banDuration,
      });

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: activo ? 'Usuario reactivado correctamente.' : 'Baja lógica ejecutada.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. ACTIVAR / DESACTIVAR SERVICIO DE BARBERÍA (ATIENDE CORTES)
    if (accion === 'toggle_atiende_cortes') {
      if (!user_id || typeof atiende_cortes !== 'boolean') {
        return new Response(
          JSON.stringify({ exito: false, error: 'user_id y atiende_cortes (boolean) son obligatorios.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: updateErr } = await supabaseAdmin
        .from('perfiles_staff')
        .update({ atiende_cortes })
        .eq('id', user_id);

      if (updateErr) {
        return new Response(
          JSON.stringify({ exito: false, error: updateErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: atiende_cortes
            ? 'Ahora aparece como Barbero disponible para reservas.'
            : 'Ya no aparece en la selección pública de barberos.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. RESETEO DE CONTRASEÑA
    if (accion === 'reset_password') {
      if (!user_id || !nueva_password || String(nueva_password).length < 6) {
        return new Response(
          JSON.stringify({ exito: false, error: 'user_id y nueva_password (mínimo 6 caracteres) son requeridos.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: passErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        password: String(nueva_password),
      });

      if (passErr) {
        return new Response(
          JSON.stringify({ exito: false, error: passErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ exito: true, mensaje: 'Contraseña actualizada correctamente.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ exito: false, error: `Acción '${accion}' no reconocida.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error en api/superadmin/staff:', err);
    return new Response(
      JSON.stringify({ exito: false, error: 'Error del servidor en gestión de staff.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
