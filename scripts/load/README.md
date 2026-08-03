# Pruebas de carga · k6

> **Estado: escrito y ejecutable, PENDIENTE de ejecutar.** En este entorno no
> hay base de datos levantada, así que ninguno de los escenarios de abajo se ha
> corrido todavía y no hay ni un número medido. Los comandos son literales:
> funcionan tal cual contra una base local sembrada.

## Instalar k6

k6 es un **binario externo**, no un paquete de npm. No se añade a
`package.json` a propósito: `package.json` es compartido por los seis bloques
que trabajan en paralelo sobre este árbol, y una dependencia nueva ahí afecta a
todos (ver `HANDOFF/README.md`).

```bash
# macOS
brew install k6

# Windows
winget install k6 --source winget      # o: choco install k6

# Debian / Ubuntu
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
     --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Sin instalar nada (contenedor)
docker run --rm -i --network host -v "$PWD:/src" grafana/k6 run /src/scripts/load/feed.js

k6 version
```

## Antes de correr nada

```bash
supabase start
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# 1 M de posts + 100 k perfiles. Termina con ANALYZE y reactiva los triggers.
SEED_ALLOW=1 node --experimental-strip-types scripts/seed/sembrar.ts

# Comprobación estructural (esto NO lo sustituye k6):
psql "$DATABASE_URL" -f scripts/load/explain.sql > /tmp/darma-explain.txt
```

**Sin siembra, k6 no mide nada.** Contra una base vacía, todo responde en 5 ms y
el resultado sería un informe con excelentes números sobre una aplicación que no
existe.

## Ejecutar

```bash
export BASE_URL=http://localhost:3000

# Feed: 200 → 2 000 VUs, 10 min
k6 run scripts/load/feed.js

# Composer: 50 → 500 VUs. ⚠️ ESCRIBE en la base.
k6 run scripts/load/composer.js

# Hilo: 100 → 1 000 VUs. Necesita hilos GRANDES, no uno cualquiera:
export POST_IDS=$(psql "$DATABASE_URL" -tAc \
  "select string_agg(id::text, ',') from (select id from public.posts where state='active' order by reply_count desc limit 5) s")
k6 run scripts/load/hilo.js

# Los tres seguidos
k6 run scripts/load/feed.js && k6 run scripts/load/composer.js && k6 run scripts/load/hilo.js
```

## Variables de entorno

| Variable | Para qué |
|---|---|
| `BASE_URL` | destino. Por defecto `http://localhost:3000`. |
| `SESSION_TOKEN` | cookie de sesión de Supabase. Sin ella, el proxy responde 401 a todo lo que no sea público. |
| `POST_IDS` | uuids de hilos grandes (obligatorio en `hilo.js`). |
| `CURSOR_SCORE` / `CURSOR_ID` | cursor de «página 50» para `feed.js`. |
| `LOAD_TEST_TOKEN` | atajo de rate limit. **Lee la advertencia de abajo.** |

### ⚠️ `LOAD_TEST_TOKEN` no existe en producción, y no puede existir

`check_rate_limit()` está diseñada para frenar a quien golpea la API. Bajo k6,
eso significa que a partir del primer minuto se estaría midiendo **cuánto tarda
nuestro propio 429**, que no es una medida de nada.

La solución es una cabecera `x-darma-load-test` que el backend reconoce **solo
si la variable `LOAD_TEST_TOKEN` está presente en su propio entorno**, y que
falla **cerrado**: sin variable, ningún atajo, sin excepciones ni valores por
defecto.

Que esa variable llegue a producción sería una vía abierta para saltarse todos
los límites de la aplicación —publicar sin freno, votar sin freno, sondear sin
freno— con solo conocer el nombre de una cabecera. No es una comodidad de
pruebas: es una puerta trasera, y la única razón por la que es aceptable en
desarrollo es que en producción la variable **no está definida en ningún sitio**.

> Pendiente en `HANDOFF/PEDIDOS.md`: que F3 implemente ese atajo en
> `lib/rateLimit.ts`. Mientras no exista, ejecuta k6 con rampas más suaves o
> acepta que parte de las respuestas sean 429 (que `esFalloReal` ya no cuenta
> como fallo).

## Qué rompe el CI

Los umbrales viven en `scripts/load/umbrales.js` y se importan desde los tres
escenarios. k6 sale con **código ≠ 0** cuando incumple un `threshold`, y eso es
lo que hace fallar el workflow.

| Escenario | Umbral |
|---|---|
| `feed.js` | `http_req_duration p(95) < 300` · `http_req_failed < 0.001` · `darma_pagina_50_ms p(95) < 300` |
| `composer.js` | `p(95) < 800` · los 403 de reciprocidad **no** cuentan como fallo |
| `hilo.js` | `p(95) < 400` |

> Pendiente en `HANDOFF/PEDIDOS.md`: que B15 añada el paso de k6 al workflow.

## Prueba nº 14 · «los umbrales fallan cuando deben»

La ficha B14 exige verificar a mano que un `k6 run` contra un servidor
artificialmente lento sale con código ≠ 0. **Sin esta comprobación, un umbral
mal escrito produce un CI verde permanente**, que es peor que no tener umbral:
da una garantía que nadie ha comprobado.

```bash
# 1 · degradar a propósito. Por ejemplo, un proxy que añade 900 ms:
npx -y http-proxy-cli --port 3001 --target http://localhost:3000 --delay 900
#    (o, más directo: añadir un `await new Promise(r => setTimeout(r, 900))`
#     al principio del handler de /api/feed, SIN commitearlo)

# 2 · apuntar k6 al servidor lento
BASE_URL=http://localhost:3001 k6 run scripts/load/feed.js

# 3 · comprobar el código de salida
echo $?      # DEBE ser distinto de 0 (k6 usa 99 al incumplir un threshold)
```

| Resultado esperado | Estado |
|---|---|
| `k6 run` contra servidor normal → código 0 | PENDIENTE |
| `k6 run` contra servidor +900 ms → código 99 | PENDIENTE |
| El motivo impreso menciona `http_req_duration p(95)` | PENDIENTE |

## Por qué el cursor de `feed.js` es el real

El escenario de scroll profundo usa el **cursor opaco** de la aplicación
(base64url de `hot_score|id`, espejo de `encodeCursor` en `lib/feedRanking.ts`),
no un `?pagina=50` simulado. Dos razones:

1. Es lo que hace la app. Medir con precisión algo que la app no hace es medir
   con precisión algo que no le importa a nadie.
2. Un offset simulado **ocultaría el fallo que buscamos**. Si alguien introduce
   un `OFFSET` escondido en la implementación del feed, el cursor real lo delata
   (la página 50 se dispara frente a la 1) y el simulado no.

El precio es una duplicación: `codificarCursor` en `umbrales.js` replica a mano
la función de TypeScript, porque k6 no importa `.ts`. Está marcada con un aviso
en el propio archivo — si el formato del cursor cambia, esta prueba empezará a
medir la primera página una y otra vez, es decir, a mentir a favor.
