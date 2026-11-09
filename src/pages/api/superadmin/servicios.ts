import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const rol = locals.rol;

  if (!user || rol !== 'superadmin') {
    return new Response(
      JSON.stringify({ exito: false, error: 'Acceso no autorizado al catálogo de servicios.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { id, nombre, descripcion, precio, imagen_url, activo } = body;

    if (!id || !nombre || precio === undefined) {
      return new Response(
        JSON.stringify({ exito: false, error: 'id, nombre y precio son requeridos.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const precioNum = Number(precio);
    if (isNaN(precioNum) || precioNum < 0) {
      return new Response(
        JSON.stringify({ exito: false, error: 'El precio debe ser un número positivo.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updatePayload: Record<string, any> = {
      nombre: String(nombre).trim(),
      descripcion: String(descripcion || '').trim(),
      precio: precioNum,
      activo: typeof activo === 'boolean' ? activo : true,
    };
    if (imagen_url !== undefined) {
      updatePayload.imagen_url = String(imagen_url).trim();
    }

    const { error: updateErr } = await supabaseAdmin
      .from('servicios')
      .update(updatePayload)
      .eq('id', parseInt(String(id), 10));

    if (updateErr) {
      return new Response(
        JSON.stringify({ exito: false, error: updateErr.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ exito: true, mensaje: 'Servicio actualizado correctamente.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error en api/superadmin/servicios:', err);
    return new Response(
      JSON.stringify({ exito: false, error: 'Error del servidor al actualizar servicio.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
