# Línea base de `EXPLAIN ANALYZE` · Darma

> ## ⛔ ESTADO: PENDIENTE DE MEDICIÓN
>
> **Ningún plan de este documento ha sido ejecutado todavía.** En el momento de
> escribirlo no hay ninguna base de datos levantada en este entorno — ni Docker,
> ni un proyecto de Supabase local— así que no se ha podido sembrar el millón de
> filas ni capturar un solo plan real.
>
> Las tablas de abajo están **vacías a propósito**, con la palabra `PENDIENTE`
> en cada celda. No hay un solo número estimado, extrapolado ni "de referencia".
>
> **Por qué esto importa más que rellenarlo:** un `EXPLAIN` inventado es peor
> que ninguno. Se cita en un PR, se copia a una nota de arquitectura, y seis
> meses después alguien toma una decisión de escala apoyándose en un número que
> nadie midió jamás. Un hueco marcado como pendiente se ve; un número falso, no.
>
> **Cómo rellenarlo** — los tres comandos están abajo, en «Cómo se reproduce».
> Quien los ejecute sustituye `PENDIENTE` por el dato real y borra este aviso.

---

## Qué se mide y por qué

CONTRATOS.md §11 fija el presupuesto: **la consulta del feed debe estar por
debajo de 50 ms con 1 000 000 de filas sembradas, y la página 50 debe costar lo
mismo que la página 1**. Este documento es la prueba de esa afirmación, o su
refutación.

Hay dos preguntas distintas y las dos hacen falta:

| Pregunta | Herramienta | Presupuesto |
|---|---|---|
| ¿El plan es el correcto? | `EXPLAIN ANALYZE` (este documento) | feed SQL < 50 ms |
| ¿Sigue siéndolo con 2 000 personas a la vez? | k6 (`scripts/load/*.js`) | feed p95 < 300 ms |

Un plan correcto que se derrumba bajo concurrencia y una carga que aguanta con
un plan malo son dos formas distintas de la misma sorpresa desagradable.

## Cómo se reproduce

```bash
# 1 · base local levantada
supabase start
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# 2 · siembra (100 000 perfiles + 1 000 000 de posts, ~15–25 min)
#     Termina SIEMPRE con ANALYZE y reactivando trg_posts_reciprocity.
SEED_ALLOW=1 node --experimental-strip-types scripts/seed/sembrar.ts

# 3 · captura de los planes
psql "$DATABASE_URL" -f scripts/load/explain.sql > /tmp/darma-explain.txt
```

Y para comprobar, en cualquier momento, que la siembra no dejó el gate de
reciprocidad apagado:

```bash
node --experimental-strip-types scripts/seed/sembrar.ts --verificar-triggers
```

## Contexto de la medición

| Dato | Valor |
|---|---|
| Fecha de captura | PENDIENTE |
| Versión de Postgres | PENDIENTE |
| Hardware / entorno | PENDIENTE |
| `shared_buffers` / `work_mem` | PENDIENTE |
| Filas en `posts` | PENDIENTE (objetivo 1 000 000) |
| Filas en `comments` | PENDIENTE (objetivo 800 000) |
| Filas en `profiles` | PENDIENTE (objetivo 100 000) |
| Semilla del PRNG | 20260803 (por defecto) |
| `ANALYZE` ejecutado | PENDIENTE |

> El entorno forma parte del resultado. Un plan medido en un portátil con la
> tabla entera en caché y otro medido en un contenedor con 512 MB no son
> comparables, y presentarlos juntos sin decirlo es la forma educada de mentir.

---

## Resumen · los 10 planes

| # | Consulta | Índice esperado | Tiempo real | ¿Usa el índice? | ¿`Seq Scan`? | ¿Cumple? |
|---|---|---|---|---|---|---|
| 1 | Feed «Para ti» · página 1 | `idx_posts_hot` | PENDIENTE | PENDIENTE | PENDIENTE | < 50 ms |
| 2 | Feed «Para ti» · página 50 (keyset) | `idx_posts_hot` | PENDIENTE | PENDIENTE | PENDIENTE | = nº 1 |
| 3 | **Contraste:** el mismo con `OFFSET 10000` | `idx_posts_hot` | PENDIENTE | PENDIENTE | PENDIENTE | — (es el contraejemplo) |
| 4 | Feed «Nuevos» | `idx_posts_new` | PENDIENTE | PENDIENTE | PENDIENTE | < 50 ms |
| 5 | Hilo · comentarios activos | `idx_comments_post` | PENDIENTE | PENDIENTE | PENDIENTE | < 50 ms |
| 6 | Perfil · posts de un autor | `idx_posts_author` | PENDIENTE | PENDIENTE | PENDIENTE | < 50 ms |
| 7 | Cola de moderación | `idx_moderation_queue` | PENDIENTE | PENDIENTE | PENDIENTE | < 50 ms |
| 8 | Cola de crisis | `idx_crisis_pending` | PENDIENTE | PENDIENTE | PENDIENTE | < 10 ms |
| 9 | Bandeja de refugios | `idx_refuges_activity` | PENDIENTE | PENDIENTE | PENDIENTE | < 50 ms |
| 10 | Hilo de mensajes de refugio | `idx_refuge_messages_keyset` | PENDIENTE | PENDIENTE | PENDIENTE | < 50 ms |

**Regla de lectura:** si en cualquier plan aparece `Seq Scan` sobre `posts`,
`comments` o `refuge_messages`, eso **no es un dato: es un hallazgo**. Significa
que falta un índice o que el predicado de la consulta dejó de coincidir con el
del índice parcial (por ejemplo, alguien escribió `state <> 'removed'` donde el
índice dice `state = 'active'`, y el índice parcial deja de ser aplicable).

---

## 1 · Feed «Para ti» — página 1

```sql
select id, author_id, kind, body, topic, upvote_count, reply_count, hot_score, created_at
  from public.posts
 where state = 'active'
   and (hot_score, id) < (:cursor_score, :cursor_id)
 order by hot_score desc, id desc
 limit 20;
```

Es la consulta canónica de CONTRATOS.md §5 y la que documenta
`comment on index public.idx_posts_hot`.

```
PENDIENTE — pegar aquí la salida de EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
```

- **Execution Time:** PENDIENTE
- **Índice usado:** PENDIENTE
- **`Buffers: shared hit` / `read`:** PENDIENTE
- **`rows` estimadas vs. reales:** PENDIENTE

---

## 2 · Feed «Para ti» — página 50 por keyset

**Esta es la comparación que da sentido al documento entero.** El plan debe ser
idéntico al del nº 1 y el tiempo, indistinguible. El keyset arranca el
`Index Scan` exactamente donde terminó la página anterior: el coste no depende
de la profundidad del scroll.

```
PENDIENTE
```

- **Execution Time:** PENDIENTE
- **Diferencia frente a la página 1:** PENDIENTE (objetivo: ≈ 0 %)

---

## 3 · Contraste — la misma consulta con `OFFSET 10000`

```sql
select …
  from public.posts
 where state = 'active'
 order by hot_score desc, id desc
 offset 10000 limit 20;
```

**Este número es el argumento**, no una curiosidad. Con `OFFSET 10000` Postgres
recorre el índice desde el principio y **descarta diez mil filas** antes de
devolver veinte. El coste crece linealmente con la profundidad del scroll: la
página 500 cuesta cincuenta veces la página 10. Y hay un segundo problema que no
sale en el plan: mientras alguien lee, otras personas publican, el orden se
desplaza y con `OFFSET` el usuario ve entradas repetidas o se salta otras.

```
PENDIENTE
```

- **Execution Time:** PENDIENTE
- **Filas descartadas antes del `LIMIT`:** PENDIENTE
- **Veces más lento que el nº 2:** PENDIENTE ← **el número que se cita**

---

## 4 · Feed «Nuevos»

```sql
where state = 'active' and (created_at, id) < (:cursor_ts, :cursor_id)
order by created_at desc, id desc limit 20;
```

La siembra concentra los posts en las horas nocturnas y hacia el presente, así
que la punta de `idx_posts_new` es densa: es lo que hace que esta medición no
sea trivialmente favorable.

```
PENDIENTE
```

---

## 5 · Hilo — comentarios activos de un post

```sql
where c.post_id = :post and c.state = 'active' order by c.created_at limit 20;
```

Medido sobre el hilo **más grande** de la base sembrada (cola larga de
`reply_count`). El hilo medio tiene tres comentarios y cualquier plan lo
resuelve bien; el caso que importa es el post que se hizo viral.

```
PENDIENTE
```

---

## 6 · Perfil — posts de un autor

Medido sobre un autor del **1 % más prolífico** (la siembra le asigna ~30 % del
volumen entre el 1 % de autores). Es el caso en el que `idx_posts_author` tiene
que recorrer un rango grande.

```
PENDIENTE
```

---

## 7 · Cola de moderación

```sql
where state = 'pending' order by severity desc, created_at limit 50;
```

`idx_moderation_queue` es **parcial** sobre `state = 'pending'`. Lo que hay que
comprobar en el plan es que su tamaño se corresponde con el backlog (~4 % de las
señales sembradas) y no con el histórico: esa es toda la razón de que el índice
sea parcial.

```
PENDIENTE
```

- **Tamaño de `idx_moderation_queue`:** PENDIENTE
- **Tamaño de la tabla `moderation_flags`:** PENDIENTE

---

## 8 · Cola de crisis

```sql
where attended_at is null and risk in ('high','critical') order by created_at limit 50;
```

**La consulta que más importa de toda la aplicación.** Es la que ejecuta una
persona cada pocos segundos para ver a quién hay que atender, y tiene que
responder en microsegundos aunque la tabla acumule años de histórico. El índice
parcial hace que su tamaño sea el de la cola viva, no el del archivo.

Presupuesto propio, más estricto que el resto: **< 10 ms**. Una cola de crisis
lenta no degrada la experiencia; retrasa que alguien lea lo que otra persona
escribió en su peor noche.

```
PENDIENTE
```

- **Tamaño de `idx_crisis_pending`:** PENDIENTE
- **Eventos pendientes en la base sembrada:** PENDIENTE

---

## 9 · Bandeja de refugios

```sql
where r.archived_at is null
order by r.last_message_at desc nulls last, r.id desc limit 20;
```

```
PENDIENTE
```

---

## 10 · Hilo de mensajes de un refugio

```sql
where refuge_id = :r and state = 'active' order by id desc limit 50;
```

El índice más caliente de la aplicación. Medido sobre la sala con más mensajes
de la base sembrada.

```
PENDIENTE
```

---

## Comprobación de que la siembra NO es uniforme

Antes de dar por bueno cualquier plan de arriba hay que verificar que los datos
sembrados tienen la forma que se pretendía. Una siembra uniforme hace que **todo
parezca rápido**: las estadísticas del planificador son perfectas, los
`hot_score` están agrupados y cualquier índice acierta. Es la trampa más fácil
de caer y la más difícil de detectar después.

`explain.sql` termina imprimiendo estas comprobaciones:

| Comprobación | Objetivo | Medido |
|---|---|---|
| % de posts escritos por el 1 % de autores | ≈ 30 % | PENDIENTE |
| % de posts escritos por el 10 % de autores | ≈ 60 % | PENDIENTE |
| Posts del autor más prolífico | ≫ media | PENDIENTE |
| `state <> 'active'` | ≈ 5 % | PENDIENTE |
| `risk in ('high','critical')` | ≈ 2 % | PENDIENTE |
| Perfiles con `shadow_banned` | ≈ 1 % | PENDIENTE |

---

## Hallazgos

_(Se rellena al ejecutar. Cada `Seq Scan` inesperado, cada desviación de más de
un orden de magnitud entre filas estimadas y reales, y cada consulta por encima
de su presupuesto va aquí con su fecha y su explicación.)_

- PENDIENTE

## Historial

| Fecha | Quién | Cambio | Feed p. 1 | Feed p. 50 | `OFFSET 10000` |
|---|---|---|---|---|---|
| PENDIENTE | | primera captura | | | |
