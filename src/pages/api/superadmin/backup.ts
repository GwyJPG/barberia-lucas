import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  const rol = locals.rol;

  // Acceso exclusivo para superadmin
  if (!user || rol !== 'superadmin') {
    return new Response(
      JSON.stringify({ exito: false, error: 'Acceso no autorizado al respaldo de datos.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const [citasRes, staffRes, serviciosRes, bloqueosRes, clientesRes, cierresRes, configRes] =
      await Promise.all([
        supabaseAdmin.from('citas').select('*').order('created_at', { ascending: false }),
        supabaseAdmin.from('perfiles_staff').select('*').order('created_at', { ascending: false }),
        supabaseAdmin.from('servicios').select('*').order('id', { ascending: true }),
        supabaseAdmin.from('bloqueos_agenda').select('*').order('fecha', { ascending: false }),
        supabaseAdmin.from('historial_clientes_barbero').select('*'),
        supabaseAdmin.from('cierres_mensuales').select('*').order('created_at', { ascending: false }),
        supabaseAdmin.from('configuracion_barberia').select('*'),
      ]);

    const backupData = {
      meta: {
        aplicativo: 'Barbería Lucas',
        tipo: 'Copia de Seguridad Integral de Base de Datos',
        generado_por: locals.nombre_visible || user.email,
        fecha_exportacion: new Date().toISOString(),
        total_registros: {
          citas: citasRes.data?.length || 0,
          personal: staffRes.data?.length || 0,
          servicios: serviciosRes.data?.length || 0,
          bloqueos: bloqueosRes.data?.length || 0,
          clientes: clientesRes.data?.length || 0,
          cierres_mensuales: cierresRes.data?.length || 0,
        },
      },
      tablas: {
        configuracion: configRes.data || [],
        servicios: serviciosRes.data || [],
        perfiles_staff: staffRes.data || [],
        citas: citasRes.data || [],
        bloqueos_agenda: bloqueosRes.data || [],
        historial_clientes_barbero: clientesRes.data || [],
        cierres_mensuales: cierresRes.data || [],
      },
    };

    const dateSlug = new Date().toISOString().slice(0, 10);
    const fileName = `backup-barberia-lucas-${dateSlug}.json`;

    return new Response(JSON.stringify(backupData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ exito: false, error: 'Error al generar la copia de seguridad.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
