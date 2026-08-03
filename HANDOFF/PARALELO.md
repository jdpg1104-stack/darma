# Correr los bloques en paralelo · runbook

La propiedad exclusiva de archivos (ver `README.md`) resuelve el conflicto
obvio: dos sesiones nunca editan el mismo `.ts`. Pero hay **cuatro recursos
compartidos** que no son archivos de código y que sí colisionan. Este documento
los resuelve uno a uno.

---

## 1. El árbol de trabajo · usa worktrees de git

Seis sesiones en el mismo directorio funcionan para *editar*, pero se pisan al
*verificar*: `next dev` y `next build` escriben los dos en `.next/`, y dos
`git commit` simultáneos chocan en el `index.lock`.

**Un worktree por bloque.** Como los archivos son disjuntos, el merge de vuelta
es trivial —git no tiene nada que resolver—.

```bash
# una sola vez, desde C:\Users\jdpg1\Desktop\Darma
git worktree add ../darma-b01 -b b01-auth
git worktree add ../darma-b16 -b b16-diseno
git worktree add ../darma-b08 -b b08-ingesta
git worktree add ../darma-b14 -b b14-carga
git worktree add ../darma-b15 -b b15-seguridad
git worktree add ../darma-b17 -b b17-i18n
```

Cada worktree necesita su propio `npm install` (`node_modules` no se comparte).
Y cada sesión arranca así, desde su worktree:

```bash
claude "Lee HANDOFF/README.md, HANDOFF/CONTRATOS.md y HANDOFF/B01.md, y ejecuta el bloque B01 completo."
```

Al cerrar un bloque, desde el repo principal:

```bash
git merge b01-auth --no-ff
git worktree remove ../darma-b01
```

> Si prefieres un único árbol y menos ceremonia: es viable **si ninguna sesión
> de bloque ejecuta `next dev`, `next build` ni `git commit`**. `tsc --noEmit`,
> `eslint` y `node --test` son de solo lectura y conviven bien. Con esa
> disciplina el ahorro de tiempo es real, pero basta un `npm run dev` despistado
> para corromper el `.next` de las otras cinco.

---

## 2. El puerto del servidor de desarrollo

`next dev` toma el 3000 y las demás sesiones se lo pelean. Asigna uno fijo por
bloque y ponlo en el `.env.local` del worktree:

| Bloque | Puerto | | Bloque | Puerto |
|---|---|---|---|---|
| B01 | 3001 | | B11 | 3011 |
| B02 | 3002 | | B12 | 3012 |
| B03 | 3003 | | B13 | 3013 |
| B04 | 3004 | | B14 | 3014 |
| B05 | 3005 | | B15 | 3015 |
| B06 | 3006 | | B16 | 3016 |
| B07 | 3007 | | B17 | 3017 |
| B08 | 3008 | | B18 | 3018 |
| B09 | 3009 | | B19 | 3019 |
| B10 | 3010 | | B20 | 3020 |

```bash
npm run dev -- --port 3001
```

---

## 3. La base de datos · rangos de migración reservados

Es el conflicto más caro: dos bloques crean `0003_algo.sql` a la vez y el orden
de aplicación deja de ser determinista. Cada bloque tiene un **rango propio** y
solo escribe dentro de él:

| Bloque | Rango | | Bloque | Rango |
|---|---|---|---|---|
| Cimientos | `0001`–`0099` | | B11 | `0111`–`0119` |
| B01 | `0101`–`0109` | | B12 | `0121`–`0129` |
| B02 | `0102`… ver nota | | B13 | `0131`–`0139` |
| B03 | `0103x` | | B14 | `0141`–`0149` |
| B04 | `0104x` | | B15 | `0151`–`0159` |
| B05 | `0105x` | | B16 | `0161`–`0169` |
| B06 | `0106x` | | B17 | `0171`–`0179` |
| B07 | `0107x` | | B18 | `0181`–`0189` |
| B08 | `0108x` | | B19 | `0191`–`0199` |
| B09 | `0109x` | | B20 | `0201`–`0209` |
| B10 | `0110x` | | | |

Nota de nomenclatura: usa `0BXX_N_<tema>.sql` — p. ej. `0102_1_feed_indices.sql`
para el primero de B02. Lo que importa es que el prefijo lleve tu número de
bloque, así el orden es estable y se ve de quién es cada migración.

**Reglas duras:**
- Nunca modifiques una migración que ya existe. Solo añades.
- Nunca `supabase db reset` sobre una base compartida: te llevas por delante el
  trabajo de las otras cinco sesiones. Si necesitas resetear, hazlo contra tu
  propia instancia local.
- Los cambios de esquema son **aditivos**. Si necesitas cambiar una columna que
  otro bloque usa, eso es un `PEDIDOS.md`, no un `ALTER` unilateral.

**Cómo repartir la base:**
- *Opción A (recomendada para la ola 1):* una instancia local por worktree con
  `supabase start`, cada una con sus puertos en `supabase/config.toml`. Máximo
  aislamiento, cero interferencia.
- *Opción B:* un proyecto Supabase de desarrollo compartido. Más rápido de
  montar, pero una siembra de 1 M de filas de B14 le cambia los tiempos a todos.
  Si eliges esta, B14 va en instancia propia sí o sí.

---

## 4. Los tres archivos compartidos de coordinación

`ESTADO.md`, `PEDIDOS.md` y `CONTRATOS.md` los tocan todos. Para que no sea un
problema:

- **`ESTADO.md`**: cada sesión edita **solo su fila**. Un merge de dos filas
  distintas lo resuelve git sin ayuda.
- **`PEDIDOS.md`**: solo se **añaden líneas al final**. Nunca reescribas las de
  otros.
- **`CONTRATOS.md`**: nadie lo edita salvo la sesión de integración (B00). Si
  necesitas un contrato nuevo, va a `PEDIDOS.md` y trabajas con un tipo local
  mientras tanto.

---

## 5. Orden de arranque

1. Que cierren los cimientos (F2, F3, F4) y que `npx tsc --noEmit` pase.
2. **Un commit de base.** Sin él no hay worktrees posibles, y sin él tampoco hay
   punto al que volver si una rama se tuerce.
3. Ola 1: seis sesiones a la vez.
4. Al cerrar cada bloque: merge, y no abras la ola siguiente hasta que la
   anterior esté fusionada y en verde. Las olas son de **dependencia**: si B02
   empieza antes de que B16 exista, importará componentes que aún no tienen
   forma definitiva y habrá que rehacerlo.

---

## 6. Cuántas a la vez, de verdad

Seis sesiones de la ola 1 caben bien: son bloques poco acoplados y con poca
superficie común. En la ola 2 el acoplamiento sube (feed, composer e hilo
comparten modelo mental), así que si notas que `PEDIDOS.md` se llena de
peticiones cruzadas, es señal de que ese grupo iba mejor de tres en tres.

La restricción real no es técnica: es cuánto puedes tú revisar. Seis bloques
terminando a la vez son seis revisiones de código a la vez. Vale más cerrar tres
bien que abrir seis y fusionar a ciegas.
