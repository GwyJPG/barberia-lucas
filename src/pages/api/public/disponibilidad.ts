import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getLimaDateTime } from '../../../lib/rateLimit';

export const prerender = false;

const DEFAULT_LV = ['16:30', '17:40', '18:50', '20:00', '21:10'];
const DEFAULT_SD = ['15:00', '16:10', '17:20', '19:00'];

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const barbero_id = url.searchParams.get('barbero_id');
  const fecha = url.searchParams.get('fecha');

  if (!barbero_id || !fecha) {
    return new Response(
      JSON.stringify({ error: 'Faltan parámetros requeridos: barbero_id y fecha' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return new Response(
      JSON.stringify({ error: 'Formato de fecha inválido. Utilice YYYY-MM-DD.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { todayLima, timeLima } = getLimaDateTime();

  // Validar rango de máximo 8 días (hoy + 7 días)
  const dateObj = new Date(`${fecha}T12:00:00`);
  const todayObj = new Date(`${todayLima}T12:00:00`);
  const diffDays = Math.round((dateObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0 || diffDays > 7) {
    return new Response(
      JSON.stringify({ bloques: [], detalle: [], fuera_de_rango: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const [ocupadosRes, configRes] = await Promise.all([
      supabaseAdmin.rpc('obtener_bloques_ocupados', {
        p_fecha: fecha,
        p_barbero_id: barbero_id,
      }),
      supabaseAdmin
        .from('configuracion_barberia')
        .select('bloques_lv, bloques_sd')
        .eq('id', 1)
        .single(),
    ]);

    if (ocupadosRes.error) {
      return new Response(
        JSON.stringify({ error: ocupadosRes.error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const dayOfWeek = dateObj.getDay(); // 0 = Domingo, 6 = Sábado
    const esFinDeSemana = dayOfWeek === 0 || dayOfWeek === 6;

    const bloquesDelDia: string[] = esFinDeSemana
      ? (configRes.data?.bloques_sd?.length ? configRes.data.bloques_sd : DEFAULT_SD)
      : (configRes.data?.bloques_lv?.length ? configRes.data.bloques_lv : DEFAULT_LV);

    const bloquesOcupados: string[] = (ocupadosRes.data || []).map((row: { bloque: string }) => row.bloque);
    const diaCompletoBloqueado = bloquesOcupados.includes('TODOS');

    if (diaCompletoBloqueado) {
      return new Response(
        JSON.stringify({
          bloques: [],
          dia_bloqueado: true,
          detalle: bloquesDelDia.map((b) => ({ hora: b, disponible: false, motivo: 'Descanso' })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const detalle = bloquesDelDia.map((bloque) => {
      const yaPasoHoy = fecha === todayLima && bloque <= timeLima;
      const estaOcupado = bloquesOcupados.includes(bloque);
      return {
        hora: bloque,
        disponible: !yaPasoHoy && !estaOcupado,
        motivo: yaPasoHoy ? 'Pasado' : estaOcupado ? 'Ocupado' : 'Libre',
      };
    });

    const bloquesDisponibles = detalle.filter((d) => d.disponible).map((d) => d.hora);

    return new Response(
      JSON.stringify({
        bloques: bloquesDisponibles,
        detalle,
        es_fin_de_semana: esFinDeSemana,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error inesperado en disponibilidad:', err);
    return new Response(
      JSON.stringify({ error: 'Error interno al consultar disponibilidad' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
