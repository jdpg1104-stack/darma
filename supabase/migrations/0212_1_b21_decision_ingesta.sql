-- ============================================================================
-- B21 · Dos motivos de rechazo que faltaban en `ingest_log.decision`
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE:
-- `0108_1_ingesta.sql` cerró `decision` con un CHECK de seis valores. B21 añade
-- dos guardas nuevas al pipeline de ingesta —idioma de audio y allowlist de
-- canal— y NINGUNO de los seis describe su rechazo.
--
-- La tentación es reutilizar `rejected_quality` o `rejected_embed` y seguir. No
-- se hace, y el motivo no es purismo: este campo es exactamente lo que se
-- consulta cuando alguien pregunta «¿por qué no entra nada de esta fuente?».
-- Registrar un rechazo por idioma como `rejected_quality` no es una imprecisión
-- menor — es contestar mal a la única pregunta que se le va a hacer a la tabla,
-- y encima de forma plausible, que es la peor manera de estar equivocado.
--
-- Dos sesiones en paralelo (B21 §2 y §4) chocaron con este hueco por caminos
-- distintos y sin hablarse. Esa coincidencia es lo que lo convirtió de «detalle»
-- en «migración».
--
-- NO SE TOCA NINGUNA FILA. El CHECK se amplía, no se restringe: todo lo que era
-- válido lo sigue siendo, así que no hay datos que migrar ni que validar. Por
-- eso es seguro aplicarla con la tabla en uso.
-- ============================================================================

alter table public.ingest_log
  drop constraint if exists ingest_log_decision_check;

alter table public.ingest_log
  add constraint ingest_log_decision_check
  check (decision in (
    'inserted',
    'duplicate',
    'rejected_safety',
    'rejected_embed',
    'rejected_quality',
    -- B21 · el audio declarado del vídeo no es español (lib/ingest/idiomaAudio.ts).
    -- Distinto de `rejected_quality`: el vídeo puede ser excelente y aun así no
    -- servir para una app que nace en español.
    'rejected_language',
    -- B21 · el vídeo no pertenece a un canal del registro
    -- (lib/ingest/canalesPermitidos.ts). Distinto de `rejected_embed`: el embed
    -- puede funcionar perfectamente; lo que falla es la identidad de quien lo
    -- publica, que es un control de procedencia, no de reproducibilidad.
    'rejected_channel',
    'error'
  ));

comment on constraint ingest_log_decision_check on public.ingest_log is
  'Motivos cerrados de decisión de ingesta. Ampliado por B21 con rejected_language y rejected_channel: ver la cabecera de 0212_1_b21_decision_ingesta.sql para por qué no se reutilizaron los existentes.';
