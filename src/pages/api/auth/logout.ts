import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete('sb-access-token', { path: '/' });
  cookies.delete('sb-refresh-token', { path: '/' });

  return new Response(JSON.stringify({ exito: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
