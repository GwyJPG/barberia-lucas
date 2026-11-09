import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

// GET: Obtener configuración actual
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user || locals.rol !== 'superadmin') {
    return new Response(
      JSON.stringify({ exito: false, error: 'No autorizado' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('configuracion_barberia')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ exito: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ exito: true, config: data }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

// POST: Actualizar números de WhatsApp, horarios (L-V / S-D), intervalo y parámetros generales
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user || locals.rol !== 'superadmin') {
    return new Response(
      JSON.stringify({ exito: false, error: 'No autorizado para modificar parámetros de soporte.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const {
      whatsapp_clientes,
      whatsapp_soporte,
      nombre_comercial,
      nombre_barberia,
      dias_cooldown,
      bloques_lv,
      bloques_sd,
      intervalo_minutos,
      max_dias_reserva,
    } = body;

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (whatsapp_clientes) {
      const cleanWa = String(whatsapp_clientes).replace(/\D/g, '');
      if (cleanWa.length < 8) {
        return new Response(
          JSON.stringify({ exito: false, error: 'El WhatsApp de clientes debe contener dígitos válidos.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updates.whatsapp_clientes = cleanWa;
    }

    if (whatsapp_soporte) {
      const cleanSop = String(whatsapp_soporte).replace(/\D/g, '');
      if (cleanSop.length < 8) {
        return new Response(
          JSON.stringify({ exito: false, error: 'El WhatsApp de soporte debe contener dígitos válidos.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updates.whatsapp_soporte = cleanSop;
    }

    if (nombre_comercial || nombre_barberia) {
      updates.nombre_barberia = String(nombre_comercial || nombre_barberia).trim();
    }

    if (dias_cooldown !== undefined) {
      const cd = Number(dias_cooldown);
      if (isNaN(cd) || cd < 1 || cd > 90) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Los días de cooldown deben estar entre 1 y 90 días.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updates.dias_cooldown = cd;
    }

    if (intervalo_minutos !== undefined) {
      const im = Number(intervalo_minutos);
      if (!isNaN(im) && im >= 15 && im <= 240) {
        updates.intervalo_minutos = im;
      }
    }

    if (max_dias_reserva !== undefined) {
      const md = Number(max_dias_reserva);
      if (!isNaN(md) && md >= 1 && md <= 30) {
        updates.max_dias_reserva = md;
      }
    }

    // Parsear bloques Lunes a Viernes
    if (bloques_lv !== undefined) {
      const arrLv = Array.isArray(bloques_lv)
        ? bloques_lv
        : String(bloques_lv)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      const validLv = arrLv.every((h) => /^\d{2}:\d{2}$/.test(h));
      if (!validLv || arrLv.length === 0) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Los horarios de Lunes a Viernes deben tener formato HH:MM separados por coma (ej: 16:30, 17:40).' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updates.bloques_lv = arrLv;
    }

    // Parsear bloques Sábado y Domingo
    if (bloques_sd !== undefined) {
      const arrSd = Array.isArray(bloques_sd)
        ? bloques_sd
        : String(bloques_sd)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      const validSd = arrSd.every((h) => /^\d{2}:\d{2}$/.test(h));
      if (!validSd || arrSd.length === 0) {
        return new Response(
          JSON.stringify({ exito: false, error: 'Los horarios de Sábado y Domingo deben tener formato HH:MM separados por coma (ej: 15:00, 16:10).' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updates.bloques_sd = arrSd;
    }

    const { data, error } = await supabaseAdmin
      .from('configuracion_barberia')
      .upsert({ id: 1, ...updates })
      .select()
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ exito: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        exito: true,
        mensaje: 'Configuración y horarios actualizados exitosamente.',
        config: data,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ exito: false, error: err.message || 'Error en el servidor.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
