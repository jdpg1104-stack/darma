-- ============================================================================
-- Darma · 0103_1 · B03 · Publicar, editar y retirar un post
--
-- ── POR QUÉ EXISTE ESTE ARCHIVO (la decisión que hay que revisar) ───────────
--
-- La migración 0004 cerró el INSERT de `posts` por columnas:
--
--     grant insert (author_id, kind, body, topic) on public.posts to authenticated;
--
-- `risk` quedó fuera A PROPÓSITO: si el autor pudiera declararse `risk = 'none'`
-- tendría un interruptor para salirse de la cola de revisión de crisis. Eso deja
-- a la ruta de publicar con un problema real: tiene que insertar el post como el
-- usuario (para que el gate 3:1 y RLS hagan su trabajo) y además escribir un
-- `risk` que ese usuario no puede escribir.
--
-- Las dos salidas que contempla la ficha B03 son (A) insertar con el cliente RLS
-- y después asignar el `risk` con el cliente admin, o (B) hacer todo el flujo en
-- una RPC `security definer`. Aquí se elige **B**, por tres razones y una cuarta
-- que se descubrió midiendo:
--
--  1. ATOMICIDAD, QUE EN CRISIS NO ES UN LUJO. Con (A) hay una ventana entre el
--     INSERT y el UPDATE del riesgo en la que un post crítico existe con
--     `risk = 'none'`: no está en `idx_posts_risk` y no tiene fila en
--     `crisis_events`. Si el segundo viaje falla (red, despliegue, timeout de la
--     lambda), esa ventana no se cierra nunca y el post crítico se queda fuera
--     de la cola humana para siempre. README §4 y CONTRATOS §9 dicen que la
--     crisis gana siempre y que un falso negativo es irreversible. Con (B) el
--     post, su `risk` y su fila de `crisis_events` entran en la MISMA
--     transacción: o están los tres, o no está ninguno.
--
--  2. NO SE REABRE EL INTERRUPTOR QUE CERRÓ 0004. Una RPC `security definer` con
--     parámetro `p_risk` concedida a `authenticated` sería exactamente el agujero
--     que 0004 tapó, solo que con otro nombre: cualquiera podría llamar a
--     /rest/v1/rpc/b03_publicar_post con `p_risk => 'none'`. Por eso el EXECUTE
--     se concede SOLO a `service_role`. El cliente no puede invocarla ni
--     enumerándola: la llama el servidor de Next con el cliente admin, y el
--     `p_author` sale de `requireSesion()`, nunca del cuerpo de la petición.
--
--  3. EL GATE SIGUE SIENDO EL DE POSTGRES. `trg_posts_reciprocity` es un trigger
--     BEFORE INSERT: se dispara para CUALQUIER rol, `service_role` incluido.
--     Verificado contra esta misma base antes de escribir este archivo — un
--     INSERT como `service_role` sobre un perfil con `listen_credits = 0` y
--     `posts_published = 1` devuelve 23514 «reciprocidad: …» igual que el de un
--     usuario. Saltarse RLS NO es saltarse el gate, y esa es la propiedad que
--     hace viable esta decisión. Si algún día alguien mueve el gate de un
--     trigger a una política RLS, esta RPC deja de ser segura: que quede escrito.
--
--  4. LO QUE OBLIGÓ A DECIDIR YA. Hoy, en esta base, el cliente RLS **no puede
--     leer `posts` en absoluto**: la política `posts_read` de 0001 consulta
--     `profiles.shadow_banned`, y 0001 revocó el SELECT de `profiles` y lo
--     reconcedió sin esa columna (a propósito: si el troll puede consultarla,
--     sabe que está silenciado). Las expresiones de una política se evalúan con
--     los privilegios de quien consulta, así que cualquier `select` sobre
--     `posts` —y por tanto cualquier `insert ... returning` y cualquier
--     `update ... where`— devuelve 42501 «permission denied for table profiles».
--     Es un fallo de 0001 que afecta al feed entero (B02, B04, B05), no solo a
--     B03; está anotado en HANDOFF/PEDIDOS.md y NO se parchea aquí, porque
--     rehacer la política de lectura de `posts` es un cambio de esquema que usan
--     otros bloques. Estas RPC son `security definer`, así que leen y devuelven
--     la fila recién creada sin depender de esa política.
--
-- Lo que se PIERDE con (B) y cómo se compensa: la política `posts_insert_own`
-- (`author_id = auth.uid()`) deja de aplicarse. Su trabajo lo hace el servidor,
-- que solo pasa el `author_id` de la sesión verificada, y la función comprueba
-- además que ese perfil existe. Es menos defensa en profundidad que RLS y es el
-- precio consciente de esta decisión.
--
-- Solo se AÑADE. No se modifica ninguna migración anterior.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- b03_publicar_post — publica y, si hace falta, abre el evento de crisis.
--
-- Una sola transacción para: el INSERT (que dispara trg_posts_reciprocity y
-- trg_posts_hot), la asignación del `risk` evaluado en el servidor y la fila de
-- `crisis_events`. `crisis_events` tiene RLS activa y CERO políticas —mismo
-- patrón que identity_vault—, así que solo se puede escribir desde aquí o con
-- service_role; es justo lo que se quiere.
--
-- Devuelve EXACTAMENTE los campos del contrato PostCreado de la ficha B03. No
-- devuelve `risk`, ni `state`, ni `author_id`, ni `hot_score`: la persona ve
-- recursos de ayuda, nunca una etiqueta de riesgo puesta sobre ella.
-- ----------------------------------------------------------------------------
create or replace function public.b03_publicar_post(
  p_author   uuid,
  p_kind     public.post_kind,
  p_body     text,
  p_topic    text,
  p_risk     public.risk_level,
  p_recursos text[] default '{}',
  p_pais     text default null
)
returns table (
  id         uuid,
  kind       public.post_kind,
  body       text,
  topic      text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_created timestamptz;
begin
  if p_author is null then
    raise exception 'b03: falta el autor' using errcode = 'invalid_parameter_value';
  end if;

  -- Las columnas se cualifican con `posts.` porque `id`, `body`, `kind`, `topic`
  -- y `created_at` son también parámetros OUT de esta función: sin cualificar,
  -- plpgsql no sabría a cuál se refiere el RETURNING.
  insert into public.posts (author_id, kind, body, topic, risk)
  values (p_author, p_kind, p_body, p_topic, p_risk)
  returning posts.id, posts.created_at into v_id, v_created;

  -- El evento de crisis va DENTRO de la misma transacción que el post. Ese es el
  -- motivo entero de que esta función exista (ver punto 1 de la cabecera).
  if p_risk in ('high', 'critical') then
    insert into public.crisis_events (user_id, ref_type, ref_id, risk, resources_shown, country_code)
    values (p_author, 'post', v_id, p_risk, coalesce(p_recursos, '{}'::text[]), p_pais);
  end if;

  return query select v_id, p_kind, p_body, p_topic, v_created;
end;
$$;

-- ----------------------------------------------------------------------------
-- b03_editar_post — edita cuerpo y tema, y REEVALÚA el riesgo.
--
-- El riesgo solo puede SUBIR: `greatest(risk, p_risk)` sobre el enum
-- `risk_level`, que está declarado de menor a mayor gravedad. Es el espejo en
-- SQL de `escalate()` en lib/crisis.ts, y existe por el mismo motivo: editar es
-- la vía obvia para publicar algo inocuo y meter después el texto de crisis, y
-- bajar un riesgo es una decisión humana registrada en moderación, nunca un
-- cálculo automático.
--
-- Cero filas afectadas = el post no existe, no es tuyo o ya está retirado. La
-- función no distingue entre esos tres casos y la ruta responde `no_encontrado`
-- para los tres: decir «existe pero no es tuyo» es confirmarle a un desconocido
-- que un id concreto corresponde a un post real.
-- ----------------------------------------------------------------------------
create or replace function public.b03_editar_post(
  p_author   uuid,
  p_id       uuid,
  p_body     text,
  p_topic    text,
  p_risk     public.risk_level,
  p_recursos text[] default '{}',
  p_pais     text default null
)
returns table (
  id         uuid,
  kind       public.post_kind,
  body       text,
  topic      text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_kind    public.post_kind;
  v_body    text;
  v_topic   text;
  v_created timestamptz;
begin
  update public.posts
     set body  = p_body,
         topic = p_topic,
         risk  = greatest(posts.risk, p_risk)
   where posts.id = p_id
     and posts.author_id = p_author
     and posts.state = 'active'
  returning posts.id, posts.kind, posts.body, posts.topic, posts.created_at
       into v_id, v_kind, v_body, v_topic, v_created;

  if v_id is null then
    return;                      -- cero filas → la ruta responde no_encontrado
  end if;

  if p_risk in ('high', 'critical') then
    insert into public.crisis_events (user_id, ref_type, ref_id, risk, resources_shown, country_code)
    values (p_author, 'post', v_id, p_risk, coalesce(p_recursos, '{}'::text[]), p_pais);
  end if;

  return query select v_id, v_kind, v_body, v_topic, v_created;
end;
$$;

-- ----------------------------------------------------------------------------
-- b03_retirar_post — retirada LÓGICA (`state = 'removed'`).
--
-- Nunca un DELETE: quien comentó ese post ganó su crédito de escucha y su karma
-- ahí, y `comments.post_id` tiene `on delete cascade`. Un borrado físico se
-- llevaría por delante el hilo y el historial de terceros.
-- ----------------------------------------------------------------------------
create or replace function public.b03_retirar_post(
  p_author uuid,
  p_id     uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ok boolean;
begin
  update public.posts
     set state = 'removed'
   where posts.id = p_id
     and posts.author_id = p_author
     and posts.state <> 'removed'
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- `revoke ... from public` es lo que de verdad cierra la puerta: un
-- `grant execute to service_role` a secas no quita el EXECUTE que PUBLIC tiene
-- por defecto, y la función quedaría publicada en /rest/v1/rpc/ para cualquiera
-- con la anon key. Es el mismo fallo que 0003 tuvo que corregir en
-- mi_perfil_privado(); aquí sería mucho peor, porque `p_risk` es un parámetro.
revoke all on function public.b03_publicar_post(uuid, public.post_kind, text, text, public.risk_level, text[], text) from public, anon, authenticated;
revoke all on function public.b03_editar_post(uuid, uuid, text, text, public.risk_level, text[], text)               from public, anon, authenticated;
revoke all on function public.b03_retirar_post(uuid, uuid)                                                           from public, anon, authenticated;

grant execute on function public.b03_publicar_post(uuid, public.post_kind, text, text, public.risk_level, text[], text) to service_role;
grant execute on function public.b03_editar_post(uuid, uuid, text, text, public.risk_level, text[], text)               to service_role;
grant execute on function public.b03_retirar_post(uuid, uuid)                                                           to service_role;
