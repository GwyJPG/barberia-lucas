/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user?: import('@supabase/supabase-js').User | null;
    rol?: string;
    nombre_visible?: string;
    staff?: {
      id: string;
      nombre_visible: string;
      rol: 'barber' | 'owner' | 'superadmin' | string;
      activo: boolean;
      avatar_url?: string;
    } | null;
    slugs?: {
      barber: string;
      owner: string;
      superadmin: string;
    };
  }
}
