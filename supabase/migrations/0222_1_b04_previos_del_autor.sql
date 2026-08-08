-- ============================================================================
-- B04 · Retirar tu propio comentario borraba su rastro para el antiplantilla
--
-- ── EL AGUJERO, EN CUATRO PASOS ────────────────────────────────────────────
-- La señal `self_repetition` compara lo que escribes ahora con tus comentarios
-- recientes. Esa lista la traía `app/api/comments/historial.ts` con el cliente
-- RLS, y la política `comments_read` (0001) es
-- `for select using (state = 'active')`. De ahí sale el ciclo:
--
--   1. Pegas la plantilla en un post. Se valida y cobra karma.
--   2. Retiras TU comentario (`state = 'removed'`). 0104 concede
--      `update (body, state)` al autor, así que es un botón de la app.
--   3. Ese texto desaparece de `comments_read`, luego desaparece del historial,
--      luego deja de existir para la comparación.
--   4. Pegas la MISMA plantilla en otro post. No hay con qué compararla.
--
-- Repetible sin límite, y el karma no vuelve: 0217 decidió a propósito no
-- revertirlo, porque la escucha ocurrió. Aquí esa decisión se vuelve en contra
-- —cobras y borras la prueba— y por eso el arreglo va en el otro extremo, el
-- de la detección, y no quitando karma a posteriori.
--
-- El `unique(post_id, author_id) where is_validated` no lo tapaba: impide
-- cobrar dos veces por el MISMO post, y aquí el farmeo va de post en post.
--
-- ── POR QUÉ UNA FUNCIÓN Y NO EL CLIENTE ADMIN ──────────────────────────────
-- Con el cliente admin se saltaría RLS entero para leer una tabla completa, y
-- habría que confiar en que el `author_id` que se le pasa es el de la sesión.
-- Aquí el id NO se pasa: sale de `auth.uid()` DENTRO de la función. Nadie puede
-- pedir el historial de otra persona, ni por error ni a propósito, porque no
-- hay parámetro con el que pedirlo. Es una superficie más estrecha que la que
-- había antes, no más ancha, aunque la función sea `security definer`.
--
-- Tampoco se relaja `comments_read`. La tentación era copiar lo que hace
-- `posts_read` —«el autor ve siempre lo suyo»— pero eso tiene un efecto
-- visible: quien retira un comentario volvería a verlo en el hilo, y con razón
-- pensaría que el botón no funciona. Un arreglo antifarmeo no puede pagarse con
-- una pantalla que miente.
--
-- ── QUÉ CUENTA AHORA: TODO LO QUE COBRÓ ────────────────────────────────────
-- No se filtra por `state`. La regla no es «lo que se ve», es **lo que ya
-- cobró**, que es la misma que ya justificaba el filtro `is_validated`: un
-- comentario no validado no pagó nada y no condena al siguiente. Uno validado
-- sí pagó, lo hayas retirado tú después o lo haya ocultado moderación.
--
-- Contrapartida asumida: un texto que retiraste sigue condicionándote 30 días.
-- Si escribes algo muy parecido dentro de ese mes, la señal salta. Se acepta
-- porque el umbral es 0,6 de Jaccard sobre bigramas —prácticamente una copia,
-- reconocible al leerla— y porque la alternativa es dejar abierto un farmeo con
-- un botón. Lo que NO se hace es cobrárselo dos veces: la señal solo alimenta
-- la validación del comentario nuevo.
-- ============================================================================

create or replace function public.previos_del_autor(
  p_desde  timestamptz,
  p_limite integer default 20
) returns setof text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select c.body
    from public.comments c
   where c.author_id = (select auth.uid())
     and c.is_validated
     and c.created_at > p_desde
   -- El mismo par que ordena `idx_comments_credito_repetido` (0213):
   -- `(author_id, created_at desc) where is_validated`. Sin esa coincidencia
   -- esto pasa a ser un recorrido por el historial entero de la persona en el
   -- camino caliente de comentar.
   order by c.created_at desc
   -- El tope lo pone la función y no quien llama. Pedir 10.000 solo se haría
   -- daño a sí mismo —son sus propias filas— pero el coste lo pagaría el
   -- servidor, y un limite sin techo en una ruta caliente es un pie de bala.
   limit least(greatest(coalesce(p_limite, 20), 1), 100)
$$;

comment on function public.previos_del_autor(timestamptz, integer) is
  'Cuerpos de los comentarios VALIDADOS de auth.uid() dentro de la ventana, sin filtrar por state. Alimenta la senal self_repetition. security definer para ver los retirados y ocultos: sin eso, retirar el propio comentario borraba su rastro y la misma plantilla pasaba otra vez. El autor sale de auth.uid(), nunca de un parametro.';

-- `revoke ... from public` incluye a `anon` y a `service_role`, que heredan de
-- PUBLIC. Se concede solo a `authenticated`, que es el único rol con
-- `auth.uid()`: para cualquier otro la función devolvería cero filas de todas
-- formas, así que conceder de más sería ruido con forma de permiso.
--
-- (La regresión R1 de `supabase/tests/rls_regresiones.sql` documenta el reverso
-- de esto: un revoke a PUBLIC que se llevó por delante un EXECUTE que hacía
-- falta. Aquí no hace falta y por eso no se devuelve.)
revoke all on function public.previos_del_autor(timestamptz, integer) from public;
grant execute on function public.previos_del_autor(timestamptz, integer) to authenticated;
