-- ============================================================================
-- 1. EXTENSIONES Y NORMALIZACIÓN
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION normalizar_texto(texto TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN regexp_replace(lower(unaccent(trim(texto))), '\s+', ' ', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 2. TABLAS DEL SISTEMA
-- ============================================================================

-- 2.1 Personal de la Barbería y Soporte (Trabajadores, Jefe y Superadmin)
CREATE TABLE IF NOT EXISTS perfiles_staff (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_visible TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('barber', 'owner', 'superadmin')),
  activo BOOLEAN DEFAULT TRUE, -- Baja lógica: si Soporte quita a un barbero pasa a FALSE
  avatar_url TEXT DEFAULT '/assets/staff/barbero-default.webp',
  intentos_fallidos INT DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.2 Catálogo de Servicios (Precios y descripciones editables por Soporte)
CREATE TABLE IF NOT EXISTS servicios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  precio NUMERIC(10, 2) NOT NULL CHECK (precio >= 0),
  imagen_url TEXT NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO servicios (nombre, descripcion, precio, imagen_url) VALUES
('Corte Clásico & Ejecutivo', 'Acabado tradicional con tijera y máquina, lavado capilar y peinado con producto.', 35.00, '/assets/servicios/servicio-corte-clasico.webp'),
('Fade de Precisión + Diseño', 'Degradado a navaja (Skin/Mid/Low Fade) con perfilado de contornos en alta definición.', 40.00, '/assets/servicios/servicio-fade.webp'),
('Ritual de Barba & Toalla Caliente', 'Esculpido de barba, vaporización con ozono, aceites esenciales y afeitado a navaja.', 30.00, '/assets/servicios/servicio-barba.webp'),
('Servicio Completo VIP (Corte + Barba)', 'Experiencia integral de 90 minutos: corte a medida, ritual de barba y limpieza facial express.', 60.00, '/assets/servicios/servicio-vip.webp')
ON CONFLICT DO NOTHING;

-- 2.3 Citas de Clientes
CREATE TABLE IF NOT EXISTS citas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barbero_id UUID NOT NULL REFERENCES perfiles_staff(id) ON DELETE RESTRICT,
  dni VARCHAR(8) NOT NULL CHECK (dni ~ '^\d{8}$'),
  nombre_completo TEXT NOT NULL,
  nombre_normalizado TEXT GENERATED ALWAYS AS (normalizar_texto(nombre_completo)) STORED,
  telefono VARCHAR(15) NOT NULL,
  servicio_id INT NOT NULL REFERENCES servicios(id) ON DELETE RESTRICT,
  precio_pactado NUMERIC(10, 2) NOT NULL, -- Congela el precio al agendar
  fecha DATE NOT NULL,
  bloque_horario TEXT NOT NULL CHECK (bloque_horario IN ('16:00', '17:30', '19:00')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'completada', 'cancelada', 'no_asistio')),
  exento_cooldown BOOLEAN DEFAULT FALSE,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Un mismo barbero no puede tener 2 citas activas en la misma fecha y bloque
CREATE UNIQUE INDEX IF NOT EXISTS idx_cita_unica_por_barbero 
ON citas (barbero_id, fecha, bloque_horario) 
WHERE estado IN ('pendiente', 'aceptada', 'completada');

CREATE INDEX IF NOT EXISTS idx_citas_dni_cooldown ON citas (dni, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citas_nombre_cooldown ON citas (nombre_normalizado, created_at DESC);

-- 2.4 Bloqueos de Horario por Barbero
CREATE TABLE IF NOT EXISTS bloqueos_agenda (
  id SERIAL PRIMARY KEY,
  barbero_id UUID NOT NULL REFERENCES perfiles_staff(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  bloque_horario TEXT CHECK (bloque_horario IN ('16:00', '17:30', '19:00', 'TODOS')),
  motivo TEXT DEFAULT 'No disponible',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_bloqueo_barbero_fecha_bloque UNIQUE (barbero_id, fecha, bloque_horario)
);

-- 2.5 Cierres Mensuales (Resguardo contable automático antes de purgar la BD)
CREATE TABLE IF NOT EXISTS cierres_mensuales (
  id SERIAL PRIMARY KEY,
  mes_anio VARCHAR(7) NOT NULL UNIQUE, -- 'YYYY-MM'
  ingresos_totales NUMERIC(10, 2) NOT NULL,
  promedio_semanal NUMERIC(10, 2) NOT NULL,
  total_agendadas INT NOT NULL,
  citas_completadas INT NOT NULL,
  citas_canceladas INT NOT NULL,
  citas_no_asistio INT NOT NULL,
  tasa_fiabilidad NUMERIC(5, 2) NOT NULL,
  detalle_servicios_json JSONB NOT NULL,
  detalle_barberos_json JSONB NOT NULL,
  ejecutado_por TEXT DEFAULT 'cron_automatico',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.6 Configuración General de la Barbería y WhatsApp Editable
CREATE TABLE IF NOT EXISTS configuracion_barberia (
  id INT PRIMARY KEY DEFAULT 1,
  nombre_barberia TEXT NOT NULL DEFAULT 'Barbería Lucas',
  whatsapp_soporte TEXT NOT NULL DEFAULT '51999999999',
  whatsapp_clientes TEXT NOT NULL DEFAULT '51999999999',
  dias_cooldown INT NOT NULL DEFAULT 14 CHECK (dias_cooldown >= 1),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_single_row CHECK (id = 1)
);

INSERT INTO configuracion_barberia (id, nombre_barberia, whatsapp_soporte, whatsapp_clientes, dias_cooldown)
VALUES (1, 'Barbería Lucas', '51999999999', '51999999999', 14)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) SIN RECURSIÓN
-- ============================================================================
ALTER TABLE perfiles_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE citas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueos_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierres_mensuales ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_barberia ENABLE ROW LEVEL SECURITY;

-- Función auxiliar SECURITY DEFINER para evitar recursión infinita en RLS
CREATE OR REPLACE FUNCTION obtener_rol_usuario()
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol FROM perfiles_staff WHERE id = auth.uid() AND activo = true;
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS "Publico lee servicios activos" ON servicios;
CREATE POLICY "Publico lee servicios activos" ON servicios FOR SELECT USING (activo = true);

DROP POLICY IF EXISTS "Publico lee barberos activos" ON perfiles_staff;
CREATE POLICY "Publico lee barberos activos" ON perfiles_staff FOR SELECT USING (rol = 'barber' AND activo = true);

DROP POLICY IF EXISTS "Usuario lee su propio perfil" ON perfiles_staff;
CREATE POLICY "Usuario lee su propio perfil" ON perfiles_staff FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "Publico lee configuracion" ON configuracion_barberia;
CREATE POLICY "Publico lee configuracion" ON configuracion_barberia FOR SELECT USING (true);

-- El Barbero SOLO ve sus propias citas y bloqueos
DROP POLICY IF EXISTS "Barbero ve solo sus citas" ON citas;
CREATE POLICY "Barbero ve solo sus citas" ON citas FOR ALL USING (barbero_id = auth.uid());

DROP POLICY IF EXISTS "Barbero ve solo sus bloqueos" ON bloqueos_agenda;
CREATE POLICY "Barbero ve solo sus bloqueos" ON bloqueos_agenda FOR ALL USING (barbero_id = auth.uid());

-- Jefe y Soporte ven todas las citas y los cierres mensuales
DROP POLICY IF EXISTS "Jefe y Soporte ven todas las citas" ON citas;
CREATE POLICY "Jefe y Soporte ven todas las citas" ON citas FOR ALL 
  USING (obtener_rol_usuario() IN ('owner', 'superadmin'));

DROP POLICY IF EXISTS "Jefe y Soporte ven cierres" ON cierres_mensuales;
CREATE POLICY "Jefe y Soporte ven cierres" ON cierres_mensuales FOR SELECT 
  USING (obtener_rol_usuario() IN ('owner', 'superadmin'));

-- Solo Soporte controla staff, servicios y configuración
DROP POLICY IF EXISTS "Soporte controla staff" ON perfiles_staff;
CREATE POLICY "Soporte controla staff" ON perfiles_staff FOR ALL 
  USING (obtener_rol_usuario() = 'superadmin');

DROP POLICY IF EXISTS "Soporte controla servicios" ON servicios;
CREATE POLICY "Soporte controla servicios" ON servicios FOR ALL 
  USING (obtener_rol_usuario() = 'superadmin');

DROP POLICY IF EXISTS "Soporte edita configuracion" ON configuracion_barberia;
CREATE POLICY "Soporte edita configuracion" ON configuracion_barberia FOR ALL 
  USING (obtener_rol_usuario() = 'superadmin');

-- ============================================================================
-- 4. FUNCIONES RPC PÚBLICAS (DISPONIBILIDAD Y RESERVA CON COOLDOWN 14 DÍAS)
-- ============================================================================
CREATE OR REPLACE FUNCTION obtener_bloques_ocupados(p_fecha DATE, p_barbero_id UUID)
RETURNS TABLE (bloque TEXT) 
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM bloqueos_agenda WHERE barbero_id = p_barbero_id AND fecha = p_fecha AND bloque_horario = 'TODOS') THEN
    RETURN QUERY SELECT unnest(ARRAY['16:00', '17:30', '19:00']);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.bloque_horario FROM citas c
  WHERE c.barbero_id = p_barbero_id AND c.fecha = p_fecha AND c.estado IN ('pendiente', 'aceptada', 'completada')
  UNION
  SELECT b.bloque_horario FROM bloqueos_agenda b
  WHERE b.barbero_id = p_barbero_id AND b.fecha = p_fecha AND b.bloque_horario != 'TODOS';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION crear_cita_segura(
  p_barbero_id UUID,
  p_dni VARCHAR(8),
  p_nombre TEXT,
  p_telefono VARCHAR(15),
  p_servicio_id INT,
  p_fecha DATE,
  p_bloque TEXT,
  p_ip_hash TEXT
) RETURNS JSONB
SECURITY DEFINER
AS $$
DECLARE
  v_nombre_norm TEXT := normalizar_texto(p_nombre);
  v_ultima_cita TIMESTAMPTZ;
  v_dias_espera INT := 14;
  v_fecha_habilitada DATE;
  v_precio NUMERIC(10, 2);
  v_cita_id UUID;
BEGIN
  SELECT COALESCE(dias_cooldown, 14) INTO v_dias_espera FROM configuracion_barberia WHERE id = 1;
  IF v_dias_espera IS NULL THEN v_dias_espera := 14; END IF;

  IF NOT EXISTS (SELECT 1 FROM perfiles_staff WHERE id = p_barbero_id AND rol = 'barber' AND activo = TRUE) THEN
    RETURN jsonb_build_object('exito', false, 'error', 'El barbero seleccionado no está disponible.');
  END IF;

  IF p_dni !~ '^\d{8}$' THEN
    RETURN jsonb_build_object('exito', false, 'error', 'El DNI debe tener exactamente 8 dígitos numéricos.');
  END IF;

  IF char_length(v_nombre_norm) < 5 OR position(' ' in v_nombre_norm) = 0 THEN
    RETURN jsonb_build_object('exito', false, 'error', 'Ingresa tu nombre y apellido válidos.');
  END IF;

  IF p_fecha < CURRENT_DATE OR p_fecha > (CURRENT_DATE + INTERVAL '30 days') THEN
    RETURN jsonb_build_object('exito', false, 'error', 'Fecha fuera del rango permitido.');
  END IF;

  -- Validación Anti-Spam de 14 días por DNI o Nombre
  SELECT MAX(created_at) INTO v_ultima_cita
  FROM citas
  WHERE (dni = p_dni OR nombre_normalizado = v_nombre_norm)
    AND exento_cooldown = FALSE
    AND estado IN ('pendiente', 'aceptada', 'completada')
    AND created_at >= (NOW() - (v_dias_espera || ' days')::INTERVAL);

  IF v_ultima_cita IS NOT NULL THEN
    v_fecha_habilitada := (v_ultima_cita + (v_dias_espera || ' days')::INTERVAL)::DATE;
    RETURN jsonb_build_object(
      'exito', false, 
      'error', format('Las reservas están permitidas cada %s días. Podrás volver a separar turno a partir del %s.', v_dias_espera, to_char(v_fecha_habilitada, 'DD/MM/YYYY'))
    );
  END IF;

  IF EXISTS (SELECT 1 FROM bloqueos_agenda WHERE barbero_id = p_barbero_id AND fecha = p_fecha AND bloque_horario IN (p_bloque, 'TODOS')) THEN
    RETURN jsonb_build_object('exito', false, 'error', 'Este horario fue deshabilitado por el barbero.');
  END IF;

  SELECT precio INTO v_precio FROM servicios WHERE id = p_servicio_id AND activo = TRUE;
  IF v_precio IS NULL THEN
    RETURN jsonb_build_object('exito', false, 'error', 'El servicio elegido no está disponible.');
  END IF;

  INSERT INTO citas (barbero_id, dni, nombre_completo, telefono, servicio_id, precio_pactado, fecha, bloque_horario, ip_hash)
  VALUES (p_barbero_id, p_dni, trim(p_nombre), trim(p_telefono), p_servicio_id, v_precio, p_fecha, p_bloque, p_ip_hash)
  RETURNING id INTO v_cita_id;

  RETURN jsonb_build_object('exito', true, 'cita_id', v_cita_id);

EXCEPTION 
  WHEN unique_violation THEN
    RETURN jsonb_build_object('exito', false, 'error', 'Otro cliente acaba de ocupar este turno hace unos segundos.');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. MOTOR DE CIERRE CONTABLE MENSUAL Y PURGA AUTOMÁTICA
-- ============================================================================
CREATE OR REPLACE FUNCTION ejecutar_cierre_y_purga_mensual(p_origen TEXT DEFAULT 'cron_automatico')
RETURNS JSONB
SECURITY DEFINER
AS $$
DECLARE
  v_inicio_mes_ant DATE := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::DATE;
  v_fin_mes_ant DATE := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day')::DATE;
  v_mes_anio VARCHAR(7) := to_char(v_inicio_mes_ant, 'YYYY-MM');
  v_ingresos NUMERIC(10, 2);
  v_total INT;
  v_completadas INT;
  v_canceladas INT;
  v_no_asistio INT;
  v_fiabilidad NUMERIC(5, 2);
  v_json_servicios JSONB;
  v_json_barberos JSONB;
  v_borradas INT;
BEGIN
  UPDATE citas SET estado = 'no_asistio'
  WHERE fecha <= v_fin_mes_ant AND estado IN ('pendiente', 'aceptada');

  SELECT 
    COALESCE(SUM(CASE WHEN estado = 'completada' THEN precio_pactado ELSE 0 END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE estado = 'completada'),
    COUNT(*) FILTER (WHERE estado = 'cancelada'),
    COUNT(*) FILTER (WHERE estado = 'no_asistio')
  INTO v_ingresos, v_total, v_completadas, v_canceladas, v_no_asistio
  FROM citas WHERE fecha BETWEEN v_inicio_mes_ant AND v_fin_mes_ant;

  v_fiabilidad := CASE WHEN v_total > 0 THEN ROUND((v_completadas::NUMERIC / v_total::NUMERIC) * 100, 2) ELSE 100.00 END;

  SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_json_servicios FROM (
    SELECT s.nombre AS servicio, COUNT(c.id) FILTER (WHERE c.estado = 'completada') AS cortes,
           COALESCE(SUM(c.precio_pactado) FILTER (WHERE c.estado = 'completada'), 0) AS recaudado
    FROM servicios s LEFT JOIN citas c ON c.servicio_id = s.id AND c.fecha BETWEEN v_inicio_mes_ant AND v_fin_mes_ant
    GROUP BY s.id, s.nombre
  ) r;

  SELECT COALESCE(jsonb_agg(b), '[]'::jsonb) INTO v_json_barberos FROM (
    SELECT p.nombre_visible AS barbero,
           COUNT(c.id) FILTER (WHERE c.estado = 'completada') AS completadas,
           COUNT(c.id) FILTER (WHERE c.estado IN ('cancelada', 'no_asistio')) AS fallidas,
           COALESCE(SUM(c.precio_pactado) FILTER (WHERE c.estado = 'completada'), 0) AS generado
    FROM perfiles_staff p LEFT JOIN citas c ON c.barbero_id = p.id AND c.fecha BETWEEN v_inicio_mes_ant AND v_fin_mes_ant
    WHERE p.rol = 'barber'
    GROUP BY p.id, p.nombre_visible
  ) b;

  INSERT INTO cierres_mensuales (
    mes_anio, ingresos_totales, promedio_semanal, total_agendadas,
    citas_completadas, citas_canceladas, citas_no_asistio, tasa_fiabilidad,
    detalle_servicios_json, detalle_barberos_json, ejecutado_por
  ) VALUES (
    v_mes_anio, v_ingresos, ROUND(v_ingresos / 4.33, 2), v_total,
    v_completadas, v_canceladas, v_no_asistio, v_fiabilidad,
    v_json_servicios, v_json_barberos, p_origen
  )
  ON CONFLICT (mes_anio) DO UPDATE SET
    ingresos_totales = EXCLUDED.ingresos_totales,
    promedio_semanal = EXCLUDED.promedio_semanal,
    total_agendadas = EXCLUDED.total_agendadas,
    citas_completadas = EXCLUDED.citas_completadas,
    tasa_fiabilidad = EXCLUDED.tasa_fiabilidad,
    detalle_servicios_json = EXCLUDED.detalle_servicios_json,
    detalle_barberos_json = EXCLUDED.detalle_barberos_json;

  DELETE FROM citas WHERE fecha <= v_fin_mes_ant;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  DELETE FROM bloqueos_agenda WHERE fecha <= v_fin_mes_ant;

  RETURN jsonb_build_object('exito', true, 'mes_cerrado', v_mes_anio, 'citas_purgadas', v_borradas);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cierre-mensual-barberia');
    PERFORM cron.schedule(
      'cierre-mensual-barberia',
      '5 0 1 * *',
      'SELECT ejecutar_cierre_y_purga_mensual(''cron_automatico'');'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
