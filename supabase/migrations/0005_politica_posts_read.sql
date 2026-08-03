-- ============================================================================
-- Darma · 0005 · Arreglar posts_read, que dejó de funcionar al cerrar la fuga
--                de saldos
--
-- SÍNTOMA: `authenticated` no podía leer NI UN POST. Cualquier `select`,
-- `insert ... returning` o `update ... where` sobre `posts` devolvía
-- `42501 permission denied for table profiles`. El feed, el hilo y el perfil
-- caían a la vez.
--
-- CAUSA, que no es evidente: **las expresiones de una política RLS se evalúan
-- con los privilegios de quien consulta**, no con los del dueño de la tabla. La
-- política `posts_read` de 0001 lleva dentro
--
--     not exists (select 1 from public.profiles p
--                  where p.id = posts.author_id and p.shadow_banned)
--
-- y en 0001 revoqué el `select` sobre `profiles` para cerrar la fuga de
-- `karma_spendable` y `crystals`, concediendo solo las columnas públicas. Como
-- `shadow_banned` NO está entre ellas —deliberadamente: si el troll puede
-- consultar si está silenciado, se crea otra cuenta— la política dejó de poder
-- evaluarse. Un arreglo de seguridad correcto rompió una lectura legítima, en
-- un sitio donde nada lo anunciaba.
--
-- ARREGLO: sacar la comprobación a una función `security definer`, que se
-- ejecuta con los privilegios de su dueño y por tanto sí ve la columna. El dato
-- sigue sin ser legible: la función devuelve un booleano sobre el autor que ya
-- estás viendo, no expone la columna ni permite barrer la tabla.
--
-- Lo que este episodio deja como regla: **una política RLS que consulte otra
-- tabla es un acoplamiento invisible con los privilegios de columna de esa
-- tabla.** Si mañana se revoca una columna, la política se rompe en silencio y
-- el error apunta a un sitio que no es. Toda política que necesite mirar otra
-- tabla debería hacerlo a través de una función, no con una subconsulta.
-- ============================================================================

create or replace function public.esta_silenciado(p_autor uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_autor and p.shadow_banned
  );
$$;

-- Concedida a `authenticated` porque la evalúa su propia política de lectura.
-- No filtra: responde sobre un autor concreto que quien pregunta ya tiene
-- delante, y no hay forma de enumerar con ella.
revoke all on function public.esta_silenciado(uuid) from public, anon;
grant execute on function public.esta_silenciado(uuid) to authenticated, service_role;

drop policy if exists posts_read on public.posts;

-- Misma semántica que en 0001: se ven los posts activos de quien no está
-- silenciado, y los propios SIEMPRE — quien está en shadow-ban debe seguir
-- viendo su contenido con normalidad, o notará que lo está y se creará otra
-- cuenta.
--
-- Nota de rendimiento: la función se evalúa por fila. El feed pagina de 20 en
-- 20 por keyset, así que son 20 llamadas a un `exists` por índice y no aparece
-- en el plan. Si algún día una consulta necesitara recorrer muchas más filas,
-- lo correcto no es relajar esto sino materializar el estado en `posts` con un
-- trigger sobre `profiles.shadow_banned`.
create policy posts_read on public.posts
  for select to authenticated using (
    state = 'active'
    and (
      author_id = (select auth.uid())
      or not public.esta_silenciado(author_id)
    )
  );
