-- ============================================================================
-- Darma · 0007 · Índice parcial de silenciados
--
-- `esta_silenciado()` (introducida en 0005) se evalúa una vez por fila del
-- feed. Con `profiles` sana son 20 búsquedas por clave primaria y ni aparece en
-- el plan: 2,3 ms la página entera.
--
-- Pero midiendo con la tabla inflada —90 000 tuplas muertas sobre 21 vivas— el
-- planificador metió un **seq scan dentro de la función** y la misma consulta
-- pasó a 34 ms y 17 694 buffers. Y `profiles` se infla sola: el trigger de
-- reciprocidad la actualiza en CADA publicación, así que en producción va a
-- estar permanentemente llena de versiones muertas entre pasadas de autovacuum.
--
-- Este índice hace que la pregunta «¿está silenciado?» no dependa nunca del
-- estado de la tabla: es parcial sobre `shadow_banned`, así que contiene solo a
-- los silenciados —unas pocas filas frente a cientos de miles de perfiles— y
-- cabe entero en memoria.
--
-- El detalle que lo hace valioso: en el caso normal (no silenciado) el índice
-- está VACÍO de esa clave, y responder «no» cuesta una lectura de índice sin
-- tocar el heap. El camino frecuente es el barato.
-- ============================================================================

create index if not exists idx_profiles_silenciados
  on public.profiles (id) where shadow_banned;

comment on index public.idx_profiles_silenciados is
  'Sirve a esta_silenciado() (0005), llamada por fila desde la política posts_read. Parcial a propósito: solo indexa a los silenciados, que son pocos, para que el coste no dependa del tamaño ni del bloat de profiles.';

-- Autovacuum más agresivo en `profiles`: es la tabla que más se actualiza de la
-- app (cada publicación, cada escucha validada y cada karma tocan su fila) y la
-- que peor tolera el bloat, porque casi todas las políticas RLS acaban
-- consultándola. Los valores por defecto (20 %) dejan pasar demasiado.
alter table public.profiles set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);
