-- ============================================================================
-- Darma · 0008 · Nadie se mete solo en un refugio
--
-- Aplicada en `darma-dev` el 2026-08-03. (Se escribió durante el rato en que la
-- base estuvo en modo solo lectura por tamaño; queda anotado porque explica por
-- qué el número no sigue al de la migración anterior en el tiempo.)
--
-- EL FALLO. La política `refuge_members_join` de 0002 permite el INSERT cuando
-- `user_id = auth.uid()`. Leído deprisa parece la comprobación de siempre —«solo
-- puedes actuar sobre ti misma»—, pero aquí significa lo contrario de lo que
-- parece: **cualquiera puede añadirSE a cualquier refugio** con solo conocer su
-- uuid. El comentario de 0002 dice «con invitación validada por el servidor»;
-- esa validación no existe en el repositorio.
--
-- Por qué es el peor de los encontrados hasta ahora: un refugio es un chat
-- privado y cifrado entre dos personas que se están acompañando en un mal
-- momento. Un tercero dentro no es una fuga de datos abstracta — es alguien
-- leyendo, y pudiendo escribir, en la conversación más vulnerable de la app. Y
-- el cifrado extremo a extremo no protege de esto: al nuevo miembro se le
-- entrega su sobre con la clave, porque el sistema cree que tiene derecho a
-- estar ahí.
--
-- «El uuid es imposible de adivinar» no sirve como defensa: se filtra en una
-- captura de pantalla, en un enlace compartido, en el historial de quien salió
-- de la sala, o en cualquier registro. Un identificador secreto no es un
-- permiso.
--
-- EL ARREGLO. Solo quien hospeda puede añadir a alguien. Se elimina la rama del
-- auto-alta y, con ella, la posibilidad de reentrar en una sala de la que te
-- sacaron. La incorporación por invitación tendrá que pasar por una función del
-- servidor que verifique el token — que es lo que 0002 ya prometía.
-- ============================================================================

drop policy if exists refuge_members_join on public.refuge_members;

create policy refuge_members_join on public.refuge_members
  for insert to authenticated
  with check (
    -- Solo un anfitrión de ESE refugio incorpora a alguien. `is_host` se
    -- comprueba sobre una fila que ya existe, así que el primer miembro (quien
    -- crea la sala) entra por la rama de `created_by`.
    (
      exists (
        select 1 from public.refuges r
         where r.id = refuge_members.refuge_id
           and r.created_by = (select auth.uid())
      )
      or exists (
        select 1 from public.refuge_members m
         where m.refuge_id = refuge_members.refuge_id
           and m.user_id = (select auth.uid())
           and m.is_host
           and m.left_at is null
      )
    )
    -- El bloqueo sigue mandando por encima de todo: ni quien hospeda puede
    -- meter a alguien en una sala donde hay un bloqueo de por medio.
    and not public.refuge_has_block(refuge_id, user_id)
  );

comment on policy refuge_members_join on public.refuge_members is
  'Solo quien hospeda incorpora. NO añadir una rama `user_id = auth.uid()`: eso permite que cualquiera que conozca el uuid de la sala se meta dentro, y en un chat cifrado 1:1 eso es un tercero leyendo la conversación. La entrada por invitación va por función del servidor que valide el token.';

-- ── Verificación al aplicar ────────────────────────────────────────────────
-- Con tres sesiones reales (anfitriona, invitado, intrusa):
--   1. La intrusa hace `insert into refuge_members (refuge_id, user_id)` con su
--      propio user_id sobre un refugio ajeno cuyo uuid conoce → debe dar 42501.
--   2. La anfitriona añade al invitado → debe funcionar.
--   3. Quien salió de la sala (`left_at` no nulo) intenta reentrar por su
--      cuenta → debe dar 42501.
