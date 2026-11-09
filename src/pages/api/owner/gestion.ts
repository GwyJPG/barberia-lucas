import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getLimaDateTime } from '../../../lib/rateLimit';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const rol = locals.rol;

  // Validación de seguridad para rol Owner o Superadmin
  if (!user || !rol || !['owner', 'superadmin'].includes(rol)) {
    return new Response(
      JSON.stringify({ exito: false, error: 'Acceso no autorizado al panel gerencial.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const {
      accion,
      cita_id,
      nuevo_barbero_id,
      nueva_fecha,
      nuevo_bloque,
      nuevo_estado,
      barbero_id,
      fecha,
      bloque_horario,
      motivo,
      dni,
      nombre_completo,
      telefono,
      servicio_id,
      metodo_pago,
    } = body;

    // 0. AGENDAR CITA MANUALMENTE DESDE GERENCIA
    if (accion === 'agendar_manual') {
      const targetBarber = barbero_id || user.id;
      const dniClean = String(dni || '').trim();
      const nombreClean = String(nombre_completo || '').trim();
      const telClean = String(telefono || '').trim();

      if (!/^\d{8}$/.test(dniClean) || !nombreClean || !telClean || !fecha || !bloque_horario || !servicio_id) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Completa todos los campos (DNI de 8 dígitos, nombre, celular, servicio, barbero, día y hora).' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { data: ocupada } = await supabaseAdmin
        .from('citas')
        .select('id')
        .eq('barbero_id', targetBarber)
        .eq('fecha', fecha)
        .eq('bloque_horario', bloque_horario)
        .in('estado', ['pendiente', 'aceptada'])
        .maybeSingle();

      if (ocupada) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Ese barbero ya tiene una cita en ese horario.' }),
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
        barbero_id: targetBarber,
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
        JSON.stringify({ exito: true, mensaje: 'Cita agendada correctamente.' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. REASIGNAR Y/O REAGENDAR CITA A CUALQUIER BARBERO ACTIVO
    if (accion === 'reasignar_o_reagendar') {
      if (!cita_id) {
        return new Response(
          JSON.stringify({ exito: false, error: 'cita_id es requerido.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { data: citaActual, error: fetchErr } = await supabaseAdmin
        .from('citas')
        .select('*')
        .eq('id', cita_id)
        .single();

      if (fetchErr || !citaActual) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Cita no encontrada.' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const targetBarberoId = nuevo_barbero_id || citaActual.barbero_id;
      const targetFecha = nueva_fecha || citaActual.fecha;
      const targetBloque = nuevo_bloque || citaActual.bloque_horario;

      // Validar rango de 8 días
      const { todayLima } = getLimaDateTime();
      const maxDateObj = new Date(`${todayLima}T00:00:00Z`);
      maxDateObj.setUTCDate(maxDateObj.getUTCDate() + 7);
      const maxDateLima = maxDateObj.toISOString().split('T')[0];

      if (targetFecha < todayLima || targetFecha > maxDateLima) {
        return new Response(
          JSON.stringify({
            exito: false,
            error: `Solo se puede reprogramar dentro del rango de 8 días (${todayLima} al ${maxDateLima}).`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Validar que el barbero de destino exista y esté activo
      const { data: barberoDestino, error: barbErr } = await supabaseAdmin
        .from('perfiles_staff')
        .select('id, nombre_visible, rol, activo, atiende_cortes')
        .eq('id', targetBarberoId)
        .single();

      if (barbErr || !barberoDestino || !barberoDestino.activo) {
        return new Response(
          JSON.stringify({ exito: false, error: 'El barbero de destino no está activo o no existe.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Validar formato HH:MM
      if (!/^\d{2}:\d{2}$/.test(targetBloque)) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Formato de horario inválido (debe ser HH:MM).' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Validar que no haya colisión en la agenda del barbero de destino
      const { data: colision } = await supabaseAdmin
        .from('citas')
        .select('id')
        .eq('barbero_id', targetBarberoId)
        .eq('fecha', targetFecha)
        .eq('bloque_horario', targetBloque)
        .neq('id', cita_id)
        .in('estado', ['pendiente', 'aceptada'])
        .maybeSingle();

      if (colision) {
        return new Response(
          JSON.stringify({
            exito: false,
            error: `${barberoDestino.nombre_visible} ya tiene una cita programada el ${targetFecha} a las ${targetBloque}.`,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: updateErr } = await supabaseAdmin
        .from('citas')
        .update({
          barbero_id: targetBarberoId,
          fecha: targetFecha,
          bloque_horario: targetBloque,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cita_id);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: 'Cita reprogramada correctamente.',
          barbero_nombre: barberoDestino.nombre_visible,
          fecha: targetFecha,
          bloque: targetBloque,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. CAMBIO DIRECTO DE ESTADO POR EL GERENTE
    if (accion === 'cambiar_estado') {
      if (!cita_id || !nuevo_estado) {
        return new Response(
          JSON.stringify({ exito: false, error: 'cita_id y nuevo_estado son requeridos.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const estadosPermitidos = ['pendiente', 'aceptada', 'completada', 'cancelada', 'no_asistio'];
      if (!estadosPermitidos.includes(nuevo_estado)) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Estado no válido.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: statusErr } = await supabaseAdmin
        .from('citas')
        .update({
          estado: nuevo_estado,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cita_id);

      if (statusErr) throw statusErr;

      return new Response(
        JSON.stringify({ exito: true, nuevo_estado }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. BLOQUEAR DÍA COMPLETO O TURNO DE DESCANSO (GERENCIA PUEDE BLOQUEAR, SOLO SOPORTE DESBLOQUEA)
    if (accion === 'bloquear_horario') {
      if (!barbero_id || !fecha || !bloque_horario) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Barbero, fecha y horario son obligatorios para bloquear.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { todayLima } = getLimaDateTime();
      if (fecha < todayLima) {
        return new Response(
          JSON.stringify({ exito: false, error: 'No se pueden bloquear fechas pasadas.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Si barbero_id === 'TODOS_BARBEROS', bloquea para todo el personal activo (barberos y gerencia)
      let targetBarberos: string[] = [];
      if (barbero_id === 'TODOS_BARBEROS') {
        const { data: staffList, error: staffErr } = await supabaseAdmin
          .from('perfiles_staff')
          .select('id')
          .in('rol', ['barber', 'owner'])
          .eq('activo', true);

        if (staffErr) {
          return new Response(
            JSON.stringify({ exito: false, error: staffErr.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
        targetBarberos = (staffList || []).map((s) => s.id);
      } else {
        targetBarberos = [barbero_id];
      }

      if (targetBarberos.length === 0) {
        return new Response(
          JSON.stringify({ exito: false, error: 'No se encontraron barberos activos para bloquear.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      for (const bId of targetBarberos) {
        const { error: blockErr } = await supabaseAdmin.from('bloqueos_agenda').upsert(
          {
            barbero_id: bId,
            fecha,
            bloque_horario,
            motivo: motivo || 'Bloqueado por Gerencia',
          },
          { onConflict: 'barbero_id,fecha,bloque_horario' }
        );

        if (blockErr) {
          console.error('Error insertando bloqueo en bloqueos_agenda:', blockErr);
          return new Response(
            JSON.stringify({ exito: false, error: blockErr.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: 'Día/horario bloqueado correctamente. Recuerda que para desbloquearlo debes solicitarlo a Soporte.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (accion === 'desbloquear_horario') {
      if (rol !== 'superadmin') {
        return new Response(
          JSON.stringify({
            exito: false,
            error: 'Por política de seguridad, el desbloqueo de horarios y días se realiza únicamente desde el panel de Soporte.',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ exito: false, error: `Acción '${accion}' no soportada.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error en api/owner/gestion:', err);
    return new Response(
      JSON.stringify({ exito: false, error: 'Error del servidor al procesar la gestión.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
