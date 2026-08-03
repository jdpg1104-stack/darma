-- ============================================================================
-- Darma · 0210_1 · B00 · Crear encuestas
--
-- PEDIDO DE B09 → B00: el banco se repone solo y `encuesta_siguiente()` sirve
-- las encuestas al feed, pero NADIE puede publicar una. `0109_1` dejó a
-- `authenticated` con `grant insert (post_id, author_id, question, closes_at)`
-- sobre `polls` — es decir, sin `origin`, sin `language`, sin `min_reveal` y
-- sin `state`. Una encuesta insertada por el cliente RLS nace en el idioma por
-- defecto y con el umbral por defecto, y no hay forma de declarar ninguno de
-- los tres desde fuera. Eso NO es un descuido de 0109: es la defensa entera
-- (§0a de esa migración) y esta migración no la deshace.
--
-- Por eso la escritura entra por UNA función `security definer` concedida SOLO
-- a `service_role`, exactamente como `reponer_encuestas()`. La alternativa
-- —devolverle a `authenticated` el privilegio de columna sobre `min_reveal`,
-- `origin` o `language`— sería reabrir el agujero que 0109 documenta durante
-- cuarenta líneas para ahorrarse una función.
--
-- ── LO QUE ESTA MIGRACIÓN AÑADE ────────────────────────────────────────────
--   1. `public.crear_encuesta(...)` — la única vía de creación.
--   2. Un valor más en el CHECK de `crisis_events.ref_type`: `'poll'`.
--
-- ── SOBRE (2), QUE ES LO ÚNICO QUE TOCA ALGO EXISTENTE ─────────────────────
-- `crisis_events.ref_type` solo aceptaba 'post', 'comment' y 'refuge_message'.
-- CONTRATOS §9 obliga a registrar el evento de crisis de CUALQUIER texto
-- escrito por una persona, y la pregunta de una encuesta lo es (es la cabecera
-- entera de `lib/polls/riesgo.ts`). Sin este valor, el evento habría que
-- escribirlo con `ref_type = null`, y entonces la fila dice que hubo una crisis
-- pero no a qué apuntaba: la pregunta «¿qué hizo el sistema cuando esta persona
-- escribió esto?» se queda sin respuesta justo donde más importa.
--
-- Es una AMPLIACIÓN del dominio permitido, no un cambio: ninguna fila existente
-- puede volverse inválida al añadir un valor a un `in (...)`, y ningún código
-- que escriba los tres valores anteriores cambia de comportamiento.
-- ============================================================================

-- ============================================================================
-- 1 · `crisis_events.ref_type` acepta 'poll'
-- ============================================================================

do $$
begin
  alter table public.crisis_events drop constraint if exists crisis_events_ref_type_check;
  alter table public.crisis_events
    add constraint crisis_events_ref_type_check
    check (ref_type in ('post', 'comment', 'refuge_message', 'poll'));
end;
$$;

-- ============================================================================
-- 2 · LA ÚNICA VÍA DE CREACIÓN
--
-- ── POR QUÉ COMPRUEBA EL ROL AQUÍ DENTRO SI YA LO COMPRUEBA EL GUARD ───────
-- Porque quien llama a esta función tiene el cliente `service_role` en la mano
-- (es el único que puede ejecutarla), y una regla que solo viva en un `if` de
-- TypeScript se salta escribiendo otro `if` (ARCHITECTURE §0). El guard de B19
-- decide y AUDITA; la base decide otra vez y es la que no se puede rodear. Las
-- dos comprobaciones usan la misma función `tiene_rol_admin()`, así que no hay
-- dos definiciones de «quién es admin» que puedan divergir.
--
-- ── POR QUÉ `p_autor` ES UN PARÁMETRO Y NO `auth.uid()` ───────────────────
-- Bajo `service_role` —la única identidad que puede ejecutar esto— `auth.uid()`
-- es NULL. Mismo caso que `completar_contenido()` de 0107. El `p_autor` sale
-- SIEMPRE de la sesión del guard, NUNCA del cuerpo de la petición
-- (CONTRATOS §6), y la ruta es la responsable de eso.
--
-- ── POR QUÉ ADMITE `p_estado` ──────────────────────────────────────────────
-- Para poder crear una encuesta con señales de crisis SIN publicarla en el
-- feed. CONTRATOS §9.2 prohíbe borrarla u ocultarla en silencio y §9.3 prohíbe
-- amplificar contenido autodestructivo: una encuesta se sirve a TODA la red, así
-- que publicarla es amplificarla. Se crea en `hidden`, se registra el evento y
-- se le dicen las dos cosas a quien la escribió en la misma respuesta. No se
-- pierde nada y no se difunde nada.
--
-- `removed` no es un estado aceptable de creación: crear algo ya borrado es
-- escribir en la base para nada.
-- ============================================================================

create or replace function public.crear_encuesta(
  p_autor      uuid,
  p_pregunta   text,
  p_opciones   text[],
  p_idioma     text default 'es',
  p_min_reveal smallint default 5,
  p_cierra_en  timestamptz default null,
  p_estado     public.entry_state default 'active'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_poll     uuid;
  v_n        integer := coalesce(array_length(p_opciones, 1), 0);
  v_i        integer := 0;
  v_etiqueta text;
begin
  -- ── Autorización, dentro del motor ────────────────────────────────────────
  -- 42501 (insufficient_privilege) y no un texto: es el mismo código que
  -- devuelve RLS, así que `codigoDesdePostgres()` ya lo traduce a
  -- `sin_permiso` sin tocar nada.
  if p_autor is null or not public.tiene_rol_admin(p_autor, 'moderador'::public.admin_role) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  if p_estado not in ('active', 'hidden') then
    raise exception 'estado_invalido' using errcode = '22023';
  end if;

  -- ── Forma de las opciones ────────────────────────────────────────────────
  -- El rango es el mismo que el CHECK de `poll_bank.options` y el mismo que
  -- `OPCIONES_MIN`/`OPCIONES_MAX` de `lib/polls/limites.ts`. Tres sitios, un
  -- solo número, y este es el que manda (ARCHITECTURE §0).
  if v_n < 2 or v_n > 5 then
    raise exception 'opciones_fuera_de_rango' using errcode = '22023';
  end if;

  -- Dos opciones que dicen lo mismo parten el voto de quien piensa lo mismo y
  -- hunden las dos por debajo del umbral de revelación. Se comparan
  -- normalizadas (sin espacios de sobra, sin mayúsculas) porque «Sí» y «sí  »
  -- son la misma opción para quien la lee, que es lo único que importa.
  if (
    select count(distinct lower(btrim(regexp_replace(o, '\s+', ' ', 'g'))))
      from unnest(p_opciones) as o
  ) <> v_n then
    raise exception 'opciones_duplicadas' using errcode = '22023';
  end if;

  -- ── La encuesta ──────────────────────────────────────────────────────────
  -- `origin = 'usuario'` SIEMPRE. Una encuesta escrita por una persona no es
  -- del banco curado aunque esa persona sea administradora: 'banco' implica
  -- autoría del perfil de sistema Darma y entrada en la rotación por
  -- `bank_key`. Marcarla como 'banco' sería firmarla con el nombre de Darma.
  insert into public.polls (author_id, question, origin, language, min_reveal, closes_at, state)
  values (p_autor, btrim(p_pregunta), 'usuario', p_idioma, p_min_reveal, p_cierra_en, p_estado)
  returning id into v_poll;

  while v_i < v_n loop
    v_etiqueta := btrim(p_opciones[v_i + 1]);
    insert into public.poll_options (poll_id, ordinal, label)
    values (v_poll, v_i, v_etiqueta);
    v_i := v_i + 1;
  end loop;

  -- Se devuelven los ids de las opciones porque quien acaba de crear la
  -- encuesta necesita poder enlazarlas, y volver a consultarlas costaría una
  -- lectura más sobre una tabla cuyo SELECT está recortado por columna (§5 de
  -- 0109). `vote_count` NO sale: es 0 y publicarlo aquí normalizaría leerlo.
  return jsonb_build_object(
    'id',       v_poll,
    'state',    p_estado,
    'origin',   'usuario',
    'language', p_idioma,
    'options',  (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'ordinal', o.ordinal, 'label', o.label
             ) order by o.ordinal), '[]'::jsonb)
        from public.poll_options o
       where o.poll_id = v_poll
    )
  );
end;
$$;

comment on function public.crear_encuesta(uuid, text, text[], text, smallint, timestamptz, public.entry_state) is
  'Única vía de creación de encuestas. Exige rol admin >= moderador (42501 si no). service_role y nadie más.';

revoke all on function public.crear_encuesta(uuid, text, text[], text, smallint, timestamptz, public.entry_state)
  from public, anon, authenticated;
grant execute on function public.crear_encuesta(uuid, text, text[], text, smallint, timestamptz, public.entry_state)
  to service_role;
