import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const rol = locals.rol;

  if (!user || rol !== 'superadmin') {
    return new Response(
      JSON.stringify({ exito: false, error: 'Acceso no autorizado a herramientas de soporte.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { accion, dni, cita_id, exento, origen, bloqueo_id, barbero_id, fecha, bloque_horario, motivo } = body;

    // 1. BUSCADOR DE CITAS POR DNI
    if (accion === 'buscar_dni') {
      if (!dni) {
        return new Response(
          JSON.stringify({ exito: false, error: 'DNI requerido para la búsqueda.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const dniClean = String(dni).trim();

      const [{ data: citasDni, error: searchErr }, { data: exentoRow }] = await Promise.all([
        supabaseAdmin
          .from('citas')
          .select('id, dni, nombre_completo, telefono, fecha, bloque_horario, estado, exento_cooldown, metodo_pago, created_at, servicios (nombre)')
          .eq('dni', dniClean)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('clientes_exentos_cooldown')
          .select('dni')
          .eq('dni', dniClean)
          .maybeSingle(),
      ]);

      if (searchErr) {
        return new Response(
          JSON.stringify({ exito: false, error: searchErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const hayExencionActiva = Boolean(exentoRow) || (citasDni || []).some((c: any) => c.exento_cooldown === true);

      return new Response(
        JSON.stringify({
          exito: true,
          citas: citasDni || [],
          exento_cooldown: hayExencionActiva,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. TOGGLE EXENTO_COOLDOWN POR DNI (LIBERACIÓN ANTI-SPAM 14 DÍAS)
    if (accion === 'toggle_exento_cooldown') {
      if (!dni || typeof exento !== 'boolean') {
        return new Response(
          JSON.stringify({ exito: false, error: 'dni y exento (boolean) son obligatorios.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const dniClean = String(dni).trim();

      const { error: updateErr } = await supabaseAdmin
        .from('citas')
        .update({ exento_cooldown: exento })
        .eq('dni', dniClean);

      if (updateErr) {
        return new Response(
          JSON.stringify({ exito: false, error: updateErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (exento) {
        await supabaseAdmin
          .from('clientes_exentos_cooldown')
          .upsert({ dni: dniClean, liberado_por: user.id }, { onConflict: 'dni' });
      } else {
        await supabaseAdmin
          .from('clientes_exentos_cooldown')
          .delete()
          .eq('dni', dniClean);
      }

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: exento
            ? `DNI ${dniClean} liberado con éxito. El cliente puede volver a agendar de inmediato sin esperar 14 días.`
            : `DNI ${dniClean} restablecido a la regla regular de cooldown.`,
          exento,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. DESBLOQUEAR DÍA O TURNO DE AGENDA (EXCLUSIVO DE SOPORTE)
    if (accion === 'desbloquear_horario') {
      if (!bloqueo_id) {
        return new Response(
          JSON.stringify({ exito: false, error: 'ID del bloqueo es obligatorio para desbloquear.' }),
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
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: 'Horario o día desbloqueado exitosamente por Soporte.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. BLOQUEAR DÍA O TURNO DESDE SOPORTE
    if (accion === 'bloquear_horario') {
      if (!barbero_id || !fecha || !bloque_horario) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Barbero, fecha y horario son obligatorios.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: insErr } = await supabaseAdmin
        .from('bloqueos_agenda')
        .upsert(
          {
            barbero_id,
            fecha,
            bloque_horario,
            motivo: motivo || 'Bloqueado por Soporte',
          },
          { onConflict: 'barbero_id,fecha,bloque_horario' }
        );

      if (insErr) {
        return new Response(
          JSON.stringify({ exito: false, error: insErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: 'Bloqueo registrado correctamente.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. ELIMINAR CLIENTE DE PRUEBA (BORRA SUS CITAS + SU HISTORIAL GENERAL Y POR BARBERO)
    if (accion === 'eliminar_cliente_prueba') {
      if (!dni) {
        return new Response(
          JSON.stringify({ exito: false, error: 'El DNI del cliente de prueba es obligatorio.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const dniClean = String(dni).trim();

      await Promise.all([
        supabaseAdmin.from('citas').delete().eq('dni', dniClean),
        supabaseAdmin.from('historial_clientes_barbero').delete().eq('dni', dniClean),
        supabaseAdmin.from('historial_clientes').delete().eq('dni', dniClean),
        supabaseAdmin.from('clientes_exentos_cooldown').delete().eq('dni', dniClean),
      ]);

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: `Se eliminó el historial y todas las citas de prueba del DNI ${dniClean}.`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. ELIMINAR UNA CITA ESPECÍFICA DE PRUEBA Y RECALCULAR EL HISTORIAL DEL CLIENTE
    if (accion === 'eliminar_cita_prueba') {
      if (!cita_id) {
        return new Response(
          JSON.stringify({ exito: false, error: 'El ID de la cita de prueba es obligatorio.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { data: citaRow } = await supabaseAdmin
        .from('citas')
        .select('id, dni, barbero_id')
        .eq('id', cita_id)
        .maybeSingle();

      await supabaseAdmin.from('citas').delete().eq('id', cita_id);

      if (citaRow?.dni) {
        const dniTarget = citaRow.dni;
        const { data: remainingCitas } = await supabaseAdmin
          .from('citas')
          .select('dni, nombre_completo, telefono, barbero_id, estado, fecha')
          .eq('dni', dniTarget);

        if (!remainingCitas || remainingCitas.length === 0) {
          await Promise.all([
            supabaseAdmin.from('historial_clientes_barbero').delete().eq('dni', dniTarget),
            supabaseAdmin.from('historial_clientes').delete().eq('dni', dniTarget),
          ]);
        } else {
          // Recalcular historial general para ese DNI
          const ag = remainingCitas.length;
          const asis = remainingCitas.filter((c) => c.estado === 'completada').length;
          const canc = remainingCitas.filter((c) => c.estado === 'cancelada' || c.estado === 'no_asistio').length;
          const ult = remainingCitas.reduce((max, c) => (c.fecha > max ? c.fecha : max), remainingCitas[0].fecha);

          await supabaseAdmin.from('historial_clientes').upsert({
            dni: dniTarget,
            nombre_completo: remainingCitas[0].nombre_completo,
            telefono: remainingCitas[0].telefono,
            total_agendadas: ag,
            total_asistidas: asis,
            total_canceladas: canc,
            ultima_fecha: ult,
            updated_at: new Date().toISOString(),
          });

          // Recalcular por barbero
          await supabaseAdmin.from('historial_clientes_barbero').delete().eq('dni', dniTarget);
          const byBarber = new Map<string, any[]>();
          for (const rc of remainingCitas) {
            const list = byBarber.get(rc.barbero_id) || [];
            list.push(rc);
            byBarber.set(rc.barbero_id, list);
          }
          for (const [bId, bCitas] of byBarber.entries()) {
            await supabaseAdmin.from('historial_clientes_barbero').upsert({
              barbero_id: bId,
              dni: dniTarget,
              nombre_completo: bCitas[0].nombre_completo,
              telefono: bCitas[0].telefono,
              total_agendadas: bCitas.length,
              total_asistidas: bCitas.filter((c) => c.estado === 'completada').length,
              total_canceladas: bCitas.filter((c) => c.estado === 'cancelada' || c.estado === 'no_asistio').length,
              ultima_fecha: bCitas.reduce((max, c) => (c.fecha > max ? c.fecha : max), bCitas[0].fecha),
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: 'Cita de prueba eliminada y contadores de cliente actualizados.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 7. LIMPIAR TODAS LAS PRUEBAS (CITAS + HISTORIAL DE CLIENTES DE PRUEBA)
    if (accion === 'limpiar_todo_pruebas') {
      await Promise.all([
        supabaseAdmin.from('citas').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabaseAdmin.from('historial_clientes_barbero').delete().neq('dni', ''),
        supabaseAdmin.from('historial_clientes').delete().neq('dni', ''),
        supabaseAdmin.from('clientes_exentos_cooldown').delete().neq('dni', ''),
      ]);

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: 'Todas las citas de prueba y el historial de clientes de prueba han sido borrados.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 8. DISPARADOR MANUAL DE CIERRE CONTABLE Y PURGA DE BASE DE DATOS
    if (accion === 'ejecutar_cierre_y_purga') {
      const { data, error: rpcErr } = await supabaseAdmin.rpc('ejecutar_cierre_y_purga_mensual', {
        p_origen: origen || 'manual_superadmin',
      });

      if (rpcErr) {
        return new Response(
          JSON.stringify({ exito: false, error: rpcErr.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          exito: true,
          mensaje: 'Cierre mensual ejecutado y base de datos purgada bajo demanda.',
          resultado: data,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ exito: false, error: `Acción '${accion}' desconocida.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error en api/superadmin/soporte:', err);
    return new Response(
      JSON.stringify({ exito: false, error: 'Error del servidor en módulo de soporte.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
