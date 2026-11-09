import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { checkRateLimit, getClientIp, getLimaDateTime } from '../../../lib/rateLimit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(clientIp, 5, 10 * 60 * 1000);

  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        exito: false,
        error: `Has superado el límite de intentos. Por favor espera ${Math.ceil(
          rateLimit.retryAfterSeconds / 60
        )} minuto(s) antes de intentar nuevamente.`,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  try {
    const body = await request.json();
    const {
      dni,
      nombre,
      telefono,
      barbero_id,
      servicio_id,
      fecha,
      bloque_hora,
      metodo_pago,
      honeypot,
    } = body;

    if (honeypot && String(honeypot).trim() !== '') {
      return new Response(
        JSON.stringify({ exito: false, error: 'Solicitud no permitida.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (
      !dni ||
      !nombre ||
      !telefono ||
      !barbero_id ||
      servicio_id === undefined ||
      !fecha ||
      !bloque_hora
    ) {
      return new Response(
        JSON.stringify({ exito: false, error: 'Todos los campos son obligatorios.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const dniLimpio = String(dni).trim();
    if (!/^\d{8}$/.test(dniLimpio)) {
      return new Response(
        JSON.stringify({
          exito: false,
          error: 'El DNI debe contener exactamente 8 dígitos numéricos.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!/^\d{2}:\d{2}$/.test(String(bloque_hora))) {
      return new Response(
        JSON.stringify({
          exito: false,
          error: 'Selecciona un turno horario válido.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) {
      return new Response(
        JSON.stringify({ exito: false, error: 'Formato de fecha inválido (YYYY-MM-DD).' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { todayLima, timeLima } = getLimaDateTime();
    const dateObj = new Date(`${fecha}T12:00:00`);
    const todayObj = new Date(`${todayLima}T12:00:00`);
    const diffDays = Math.round((dateObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));

    if (isNaN(diffDays) || diffDays < 0 || diffDays > 7) {
      return new Response(
        JSON.stringify({
          exito: false,
          error: 'Solo puedes agendar dentro de los próximos 8 días (desde hoy hasta 7 días adelante).',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (fecha === todayLima && bloque_hora <= timeLima) {
      return new Response(
        JSON.stringify({
          exito: false,
          error: `El turno de las ${bloque_hora} ya ha pasado el día de hoy.`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const metodosValidos = ['efectivo', 'yape_plin'];
    const pagoElegido = metodosValidos.includes(metodo_pago) ? metodo_pago : 'efectivo';

    const ipHash = createHash('sha256').update(clientIp).digest('hex').substring(0, 32);

    const { data, error } = await supabaseAdmin.rpc('crear_cita_segura', {
      p_barbero_id: barbero_id,
      p_dni: dniLimpio,
      p_nombre: String(nombre).trim(),
      p_telefono: String(telefono).trim(),
      p_servicio_id: parseInt(String(servicio_id), 10),
      p_fecha: fecha,
      p_bloque: bloque_hora,
      p_ip_hash: ipHash,
      p_metodo_pago: pagoElegido,
    });

    if (error) {
      console.error('Error RPC crear_cita_segura:', error);
      return new Response(
        JSON.stringify({ exito: false, error: error.message }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!data?.exito) {
      return new Response(
        JSON.stringify({ exito: false, error: data?.error || 'No fue posible registrar la cita.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        exito: true,
        success: true,
        cita_id: data.cita_id,
        mensaje: '¡Tu cita ha sido agendada con éxito! Te esperamos en Barbería Lucas.',
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error al agendar cita:', err);
    return new Response(
      JSON.stringify({
        exito: false,
        error: 'Error interno del servidor al procesar la cita.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
