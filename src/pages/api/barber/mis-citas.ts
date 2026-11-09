import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getLimaDateTime } from '../../../lib/rateLimit';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const rol = locals.rol;

  if (!user || !rol || !['barber', 'owner', 'superadmin'].includes(rol)) {
    return new Response(
      JSON.stringify({ exito: false, error: 'Acceso no autorizado' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const barberoId = user.id;

  try {
    const body = await request.json();
    const {
      accion,
      cita_id,
      fecha,
      bloque_horario,
      motivo,
      nueva_fecha,
      nuevo_bloque,
      dni,
      nombre_completo,
      telefono,
      servicio_id,
      metodo_pago,
    } = body;

    // ==========================================
    // 0. AGENDAR CITA MANUALMENTE DESDE EL PANEL DEL BARBERO
    // ==========================================
    if (accion === 'agendar_manual') {
      const dniClean = String(dni || '').trim();
      const nombreClean = String(nombre_completo || '').trim();
      const telClean = String(telefono || '').trim();

      if (!/^\d{8}$/.test(dniClean) || !nombreClean || !telClean || !fecha || !bloque_horario || !servicio_id) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Completa todos los datos del cliente (DNI de 8 dígitos, nombre, celular, servicio, día y hora).' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Verificar que el horario no esté ocupado
      const { data: ocupada } = await supabaseAdmin
        .from('citas')
        .select('id')
        .eq('barbero_id', barberoId)
        .eq('fecha', fecha)
        .eq('bloque_horario', bloque_horario)
        .in('estado', ['pendiente', 'aceptada'])
        .maybeSingle();

      if (ocupada) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Ya tienes otra cita en ese día y horario.' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { data: srv } = await supabaseAdmin
        .from('servicios')
        .select('precio')
        .eq('id', Number(servicio_id))
        .single();

      const precioPactado = srv?.precio ?? 10.0;
      const pagoValido = metodo_pago === 'yape_plin' ? 'yape_plin' : 'efectivo';

      const { error: insErr } = await supabaseAdmin.from('citas').insert({
        barbero_id: barberoId,
        dni: dniClean,
        nombre_completo: nombreClean,
        telefono: telClean,
        servicio_id: Number(servicio_id),
        precio_pactado: precioPactado,
        fecha,
        bloque_horario,
        estado: 'aceptada',
        exento_cooldown: true,
        metodo_pago: pagoValido,
      });

      if (insErr) {
        return new Response(
          JSON.stringify({ exito: false, error: insErr.message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ exito: true, mensaje: 'Cita agendada directamente con éxito.' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================
    // 1. GESTIÓN DE BLOQUEOS DE AGENDA (DESCANSOS)
    // ==========================================
    if (accion === 'bloquear') {
      if (!fecha || !bloque_horario) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Fecha y bloque son requeridos para bloquear.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { todayLima } = getLimaDateTime();
      if (fecha < todayLima) {
        return new Response(
          JSON.stringify({ exito: false, error: 'No puedes bloquear fechas pasadas.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Verificar que no haya ya una cita activa agendada en ese horario
      if (bloque_horario !== 'TODOS') {
        const { data: citaExistente } = await supabaseAdmin
          .from('citas')
          .select('id')
          .eq('barbero_id', barberoId)
          .eq('fecha', fecha)
          .eq('bloque_horario', bloque_horario)
          .in('estado', ['pendiente', 'aceptada'])
          .maybeSingle();

        if (citaExistente) {
          return new Response(
            JSON.stringify({
              exito: false,
              error: 'No puedes bloquear este bloque porque ya tienes una cita programada.',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      const { error: blockErr } = await supabaseAdmin
        .from('bloqueos_agenda')
        .upsert(
          {
            barbero_id: barberoId,
            fecha,
            bloque_horario,
            motivo: motivo || 'Descanso programado',
          },
          { onConflict: 'barbero_id,fecha,bloque_horario' }
        );

      if (blockErr) {
        return new Response(
          JSON.stringify({ exito: false, error: blockErr.message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ exito: true, mensaje: 'Horario bloqueado correctamente.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (accion === 'desbloquear') {
      if (rol !== 'superadmin') {
        return new Response(
          JSON.stringify({
            exito: false,
            error: 'El desbloqueo de días u horarios solo puede ser realizado por Soporte Técnico.',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { bloqueo_id } = body;
      if (!bloqueo_id) {
        return new Response(
          JSON.stringify({ exito: false, error: 'ID de bloqueo requerido.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: delErr } = await supabaseAdmin
        .from('bloqueos_agenda')
        .delete()
        .eq('id', bloqueo_id);

      if (delErr) {
        return new Response(
          JSON.stringify({ exito: false, error: delErr.message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ exito: true, mensaje: 'Bloqueo eliminado por Soporte correctamente.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================
    // 2. GESTIÓN DE CITAS DEL BARBERO
    // ==========================================
    if (!cita_id) {
      return new Response(
        JSON.stringify({ exito: false, error: 'cita_id es obligatorio.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // VALIDACIÓN ESTRICTA DE SEGURIDAD EN BACKEND:
    // La cita DEBE pertenecer al barbero autenticado
    const { data: cita, error: citaErr } = await supabaseAdmin
      .from('citas')
      .select('id, barbero_id, fecha, bloque_horario, estado')
      .eq('id', cita_id)
      .single();

    if (citaErr || !cita) {
      return new Response(
        JSON.stringify({ exito: false, error: 'Cita no encontrada.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (cita.barbero_id !== barberoId) {
      return new Response(
        JSON.stringify({ exito: false, error: 'Violación de seguridad: No puedes gestionar citas de otros barberos.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ACEPTAR CITA
    if (accion === 'aceptar') {
      const { error: updateErr } = await supabaseAdmin
        .from('citas')
        .update({ estado: 'aceptada', updated_at: new Date().toISOString() })
        .eq('id', cita_id)
        .eq('barbero_id', barberoId);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({ exito: true, nuevo_estado: 'aceptada' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // COMPLETAR CITA
    if (accion === 'completar') {
      const { error: updateErr } = await supabaseAdmin
        .from('citas')
        .update({ estado: 'completada', updated_at: new Date().toISOString() })
        .eq('id', cita_id)
        .eq('barbero_id', barberoId);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({ exito: true, nuevo_estado: 'completada' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // CANCELAR CITA
    if (accion === 'cancelar') {
      const { error: updateErr } = await supabaseAdmin
        .from('citas')
        .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
        .eq('id', cita_id)
        .eq('barbero_id', barberoId);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({ exito: true, nuevo_estado: 'cancelada' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // NO ASISTIÓ
    if (accion === 'no_asistio') {
      const { error: updateErr } = await supabaseAdmin
        .from('citas')
        .update({ estado: 'no_asistio', updated_at: new Date().toISOString() })
        .eq('id', cita_id)
        .eq('barbero_id', barberoId);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({ exito: true, nuevo_estado: 'no_asistio' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // REAGENDAR (Solo dentro de su propia agenda)
    if (accion === 'reagendar') {
      if (!nueva_fecha || !nuevo_bloque) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Nueva fecha y bloque requeridos para reagendar.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!/^\d{2}:\d{2}$/.test(nuevo_bloque)) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Formato de horario inválido (debe ser HH:MM).' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { todayLima } = getLimaDateTime();
      const maxDateObj = new Date(`${todayLima}T00:00:00Z`);
      maxDateObj.setUTCDate(maxDateObj.getUTCDate() + 7);
      const maxDateLima = maxDateObj.toISOString().split('T')[0];

      if (nueva_fecha < todayLima || nueva_fecha > maxDateLima) {
        return new Response(
          JSON.stringify({ exito: false, error: `Solo se puede reprogramar dentro del rango de 8 días (${todayLima} al ${maxDateLima}).` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Validar que el turno de destino esté libre para este barbero
      const { data: colision } = await supabaseAdmin
        .from('citas')
        .select('id')
        .eq('barbero_id', barberoId)
        .eq('fecha', nueva_fecha)
        .eq('bloque_horario', nuevo_bloque)
        .neq('id', cita_id)
        .in('estado', ['pendiente', 'aceptada'])
        .maybeSingle();

      if (colision) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Ya tienes otra cita agendada en ese horario.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: updateErr } = await supabaseAdmin
        .from('citas')
        .update({
          fecha: nueva_fecha,
          bloque_horario: nuevo_bloque,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cita_id)
        .eq('barbero_id', barberoId);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: 'Cita reagendada con éxito.',
          nueva_fecha,
          nuevo_bloque,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ exito: false, error: `Acción '${accion}' desconocida.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error en mis-citas:', err);
    return new Response(
      JSON.stringify({ exito: false, error: 'Error al procesar la solicitud del barbero.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
