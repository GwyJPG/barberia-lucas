# Barbería Lucas — Sistema Web de Reservas y Gestión

Plataforma web integral para **Barbería Lucas**, diseñada con arquitectura moderna SSR (Server-Side Rendering) y persistencia en base de datos PostgreSQL en tiempo real.

## Características Principales

* **Portal Público de Reservas:**
  * Reserva rápida táctil optimizada para dispositivos móviles (Android / iOS).
  * Validación de intervalo de 14 días por DNI para garantizar equidad en la disponibilidad.
  * Confirmación directa y contacto con el barbero vía WhatsApp.
  * Sin cobros por transferencia previa.

* **Panel del Barbero:**
  * Calendario de turnos por día y lista de citas en tiempo real.
  * Alertas dinámicas y recordatorio en ~30 minutos vía WhatsApp con mensaje amigable y humanizado.
  * Aprobación, reprogramación, completado y registro de asistencia.
  * Historial de clientes con fiabilidad de asistencia.
  * Bloqueo de turnos o días de descanso.

* **Panel de Gerencia:**
  * Vista gerencial y control integral de turnos por cada trabajador.
  * Capacidad de corte como barbero activo.
  * Métricas de rendimiento, fiabilidad y recaudación mensual.
  * Aprobación táctil y gestión de descansos.

* **Consola de Soporte (Superadmin):**
  * Control total de staff (alta, baja lógica, renombramiento, reseteo de claves y eliminación).
  * Catálogo de servicios y precios editables.
  * Configuración de horarios por bloque (Lunes a Viernes y Sábados/Domingos).
  * Cierre contable mensual con generación y descarga de reportes oficiales en PDF.
  * Copia de seguridad completa e instantánea de la base de datos en formato JSON.
  * Desbloqueo y gestión de cooldown por DNI.
  * Mi Perfil: cambio directo de contraseña y nombre visible.

## Tecnologías

* **Frontend:** [Astro](https://astro.build/) (SSR) + [Tailwind CSS v4](https://tailwindcss.com/)
* **Backend:** Astro Endpoints (Node / Serverless)
* **Base de Datos & Autenticación:** [Supabase](https://supabase.com/) (PostgreSQL con Row Level Security)
* **Despliegue:** [Vercel](https://vercel.com/) / Node.js

## Instalación y Desarrollo Local

1. Clonar el repositorio:
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd barber-app
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Configurar variables de entorno:
   Copiar `.env.example` a `.env` y completar las credenciales de Supabase:
   ```bash
   cp .env.example .env
   ```

4. Iniciar servidor de desarrollo:
   ```bash
   npm run dev
   ```

5. Compilar para producción:
   ```bash
   npm run build
   ```
