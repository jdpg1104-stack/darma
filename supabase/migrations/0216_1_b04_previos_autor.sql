-- ============================================================================
-- B04 · El índice que sostiene la detección de plantillas
--
-- ── QUÉ CONSULTA NUEVA HAY ─────────────────────────────────────────────────
-- `POST /api/comments` ahora trae los comentarios recientes de quien escribe
-- para poder detectar el copia y pega (`self_repetition` de `lib/moderation.ts`,
-- que llevaba desde el primer día implementado y sin datos que comparar). La
-- consulta, literal, es:
--
--     select body
--       from public.comments
--      where author_id = :autor
--        and is_validated
--        and created_at > now() - interval '30 days'
--      order by created_at desc
--      limit 20;
--
-- Corre en el camino caliente de comentar, es decir: en el acto central de la
-- app y para todo el mundo. Sin índice sería un recorrido por el historial
-- entero de la persona cada vez que alguien escucha a alguien.
--
-- ── POR QUÉ ESTA MIGRACIÓN NO CREA UN ÍNDICE NUEVO ─────────────────────────
-- Porque ya existe y es exacto. `0213_1_b21_credito_por_persona.sql` creó
-- `idx_comments_credito_repetido (author_id, created_at desc) where
-- is_validated` para que el trigger pudiera preguntar «¿ya escuché a esta
-- persona hace poco?». Esa consulta y esta tienen la misma forma —igualdad por
-- autor, rango y orden por fecha descendente, parcial por `is_validated`—, así
-- que el índice las cubre a las dos y añadir un segundo sería pagar dos veces
-- la escritura de cada comentario para leer lo mismo.
--
-- Que la consulta se limite a los comentarios VALIDADOS no es un ajuste para
-- que encaje en el índice: es lo correcto. Lo que no llegó a validarse no cobró
-- nada, y no tiene por qué condenar al comentario siguiente.
--
-- ── ENTONCES, ¿PARA QUÉ EXISTE ESTE ARCHIVO? ───────────────────────────────
-- Para dejar escrito que ese índice tiene ahora DOS consumidores, uno en
-- Postgres y otro en TypeScript. Un índice que parece servir solo a un trigger
-- es un índice que alguien borra el día que reescribe el trigger, y el síntoma
-- del borrado no sería un error: sería que comentar se vuelve lento, poco a
-- poco, a medida que la gente acumula historial. Los fallos que no dan la cara
-- son los que hay que documentar en el sitio donde se van a leer.
--
-- El `create index if not exists` es la otra mitad de lo mismo: si el índice
-- está, no hace nada; si algún día desaparece, un `supabase db reset` lo
-- devuelve en vez de arrancar sin él.
--
-- NO SE TOCA NINGUNA FILA NI NINGUNA POLÍTICA.
-- ============================================================================

create index if not exists idx_comments_credito_repetido
  on public.comments (author_id, created_at desc)
  where is_validated;

comment on index public.idx_comments_credito_repetido is
  'DOS consumidores, no uno: (1) el trigger comments_on_validated() pregunta si ya se escuchó a la misma persona dentro de ventana_credito_repetido() — ver 0213; (2) POST /api/comments trae los últimos 20 comentarios validados del autor en 30 días para detectar la plantilla copiada (app/api/comments/historial.ts). Las dos consultas son (author_id =, created_at desc, where is_validated): si cambias el índice, cambias las dos.';
