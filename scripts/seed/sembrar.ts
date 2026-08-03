// ============================================================================
// Darma · siembra masiva  ·  100 000 perfiles + 1 000 000 de posts
//
//   node --experimental-strip-types scripts/seed/sembrar.ts
//   node --experimental-strip-types scripts/seed/sembrar.ts --limpiar
//
// Este script existe para que la frase "Darma aguanta cientos de miles de
// usuarios" deje de ser una opinión. Sin un millón de filas con distribución
// realista, un `EXPLAIN ANALYZE` mide una tabla de juguete y siempre sale bien.
//
// ── CINCO DECISIONES QUE HAY QUE ENTENDER ANTES DE TOCAR ESTE ARCHIVO ───────
//
// 1. COPY, NO INSERT. Un millón de `INSERT` fila a fila son un millón de
//    round-trips y un millón de transacciones implícitas: horas. Un `COPY`
//    desde un stream son minutos. Aquí se hace con `psql \copy … from stdin`,
//    alimentado por un generador de JavaScript.
//
//    ¿Por qué psql y no `pg` + `pg-copy-streams`, como sugiere la ficha? Porque
//    añadir dos dependencias a `package.json` afecta a los otros cinco bloques
//    que trabajan en paralelo sobre este mismo árbol (ver HANDOFF/README.md), y
//    `\copy FROM STDIN` ejecuta exactamente el mismo COPY del protocolo con
//    exactamente el mismo rendimiento. Si algún día se instalan esas
//    dependencias, sustituir `copiar()` es un cambio de veinte líneas: el resto
//    del script no sabe cómo llegan los datos a Postgres.
//
// 2. EL TRIGGER DE RECIPROCIDAD SE DESACTIVA — Y SE VUELVE A ACTIVAR SIEMPRE.
//    `trg_posts_reciprocity` es BEFORE INSERT sobre `posts` y solo perdona el
//    primer post de cada autor; con él activo, la siembra muere en la fila
//    100 001. Desactivarlo es necesario. Dejarlo desactivado es catastrófico:
//    el gate 3:1 es LA regla central de Darma, y una base con el gate apagado
//    convierte la regla en decorativa sin que nada falle visiblemente. Por eso
//    la reactivación va en un `finally`, y además en los manejadores de SIGINT,
//    SIGTERM y `uncaughtException`. Y por eso existe `--verificar-triggers`,
//    que se puede ejecutar solo, en cualquier momento, para comprobarlo.
//
// 3. SI SE DESACTIVA `trg_posts_hot`, HAY QUE CALCULAR `hot_score` A MANO.
//    Un millón de posts con `hot_score = 0` deja `idx_posts_hot` degenerado en
//    una constante: el planificador ya no puede usarlo para ordenar y la
//    medición del feed pasa a ser ficción. La fórmula está replicada en
//    `perfilesFalsos.ts` y es el espejo exacto de `compute_hot_score()`.
//
// 4. `ANALYZE` AL FINAL, SIN EXCEPCIÓN. Recién sembrada, `pg_class.reltuples`
//    sigue diciendo que `posts` está casi vacía; el planificador elige planes
//    de una tabla vacía y el `EXPLAIN` sale falsamente bien. Es la causa número
//    uno de mediciones optimistas. También después de `--limpiar`.
//
// 5. NUNCA CONTRA PRODUCCIÓN. Aborta si falta `SEED_ALLOW=1` o si la conexión
//    no apunta a un host local. Este script usa credenciales de superusuario y
//    desactiva triggers de integridad: en producción no sería una siembra, sería
//    un incidente.
//
// ── REQUISITOS ──────────────────────────────────────────────────────────────
//   · Base local levantada:  supabase start   (o docker compose up)
//   · `psql` accesible en el PATH. Con Supabase CLI:
//       supabase start && export DATABASE_URL="$(supabase status -o env | grep DB_URL | cut -d= -f2-)"
//     Sin psql nativo, se puede usar el del contenedor:
//       export PSQL_BIN="docker exec -i supabase_db_darma psql"
//
// ── OPCIONES ────────────────────────────────────────────────────────────────
//   --limpiar              borra SOLO lo sembrado (alias con prefijo `seed_`)
//   --verificar-triggers   comprueba que los triggers están activos y sale
//   --perfiles=N           por defecto 100000
//   --posts=N              por defecto 1000000
//   --comentarios=N        por defecto 800000
//   --refugios=N           por defecto 40000
//   --mensajes=N           por defecto 600000
//   --flags=N              por defecto 120000   (moderation_flags)
//   --crisis=N             por defecto 40000    (crisis_events)
//   --lote=N               filas por bloque de COPY (por defecto 20000)
//   --semilla=N            semilla del PRNG (por defecto 20260803)
//   --solo=a,b             ejecuta solo estas fases
//                          (perfiles|posts|comentarios|refugios|moderacion)
// ============================================================================

import { spawn } from 'node:child_process'
import process from 'node:process'

import {
  aliasSembrado,
  autorDePost,
  avatarSeedSembrado,
  colaLarga,
  creadoEn,
  crearAzar,
  cuerpoSintetico,
  estadoDePost,
  hotScore,
  idDeterminista,
  PREFIJO_SEED,
  riesgoDePost,
  temaDePost,
  tipoDePost,
} from './perfilesFalsos.ts'

// ── Configuración ───────────────────────────────────────────────────────────

interface Opciones {
  limpiar: boolean
  verificarTriggers: boolean
  perfiles: number
  posts: number
  comentarios: number
  refugios: number
  mensajes: number
  flags: number
  crisis: number
  lote: number
  semilla: number
  fases: Set<string>
}

const FASES = ['perfiles', 'posts', 'comentarios', 'refugios', 'moderacion'] as const

function leerOpciones(argv: readonly string[]): Opciones {
  const num = (nombre: string, pordefecto: number): number => {
    const arg = argv.find((a) => a.startsWith(`--${nombre}=`))
    if (!arg) return pordefecto
    const v = Number(arg.split('=')[1])
    if (!Number.isFinite(v) || v < 0) throw new Error(`--${nombre} inválido`)
    return Math.floor(v)
  }

  const solo = argv.find((a) => a.startsWith('--solo='))?.split('=')[1]
  const fases = new Set(solo ? solo.split(',').map((s) => s.trim()) : FASES)
  for (const f of fases) {
    if (!FASES.includes(f as (typeof FASES)[number])) throw new Error(`fase desconocida: ${f}`)
  }

  return {
    limpiar: argv.includes('--limpiar'),
    verificarTriggers: argv.includes('--verificar-triggers'),
    perfiles: num('perfiles', 100_000),
    posts: num('posts', 1_000_000),
    comentarios: num('comentarios', 800_000),
    refugios: num('refugios', 40_000),
    mensajes: num('mensajes', 600_000),
    flags: num('flags', 120_000),
    crisis: num('crisis', 40_000),
    lote: num('lote', 20_000),
    semilla: num('semilla', 20260803),
    fases,
  }
}

// ── Guardas de seguridad ────────────────────────────────────────────────────

const HOSTS_LOCALES = ['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal', 'db']

/**
 * Cadena de conexión. Por defecto, la de `supabase start` (puerto 54322).
 *
 * Se usa una conexión DIRECTA de superusuario y no la service_role key de
 * PostgREST porque hay dos cosas que PostgREST no puede hacer y este script
 * necesita: `COPY … FROM STDIN` y `ALTER TABLE … DISABLE TRIGGER`.
 */
function cadenaConexion(): string {
  return process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Tres cerrojos, y los tres tienen que estar abiertos.
 *
 * El primero (`SEED_ALLOW`) es contra el descuido: nadie ejecuta este script
 * "por error" si además hay que exportar una variable. Los otros dos son contra
 * el error de configuración: un `.env.local` apuntando al proyecto de
 * producción es lo más fácil del mundo de tener abierto en otra pestaña.
 */
function comprobarEntorno(): void {
  if (process.env.SEED_ALLOW !== '1') {
    throw new Error(
      'Falta SEED_ALLOW=1. Este script desactiva triggers de integridad y escribe ' +
        'millones de filas: exige una confirmación explícita.\n' +
        '  SEED_ALLOW=1 node --experimental-strip-types scripts/seed/sembrar.ts',
    )
  }

  const host = hostDe(cadenaConexion())
  if (!HOSTS_LOCALES.includes(host)) {
    throw new Error(
      `DATABASE_URL apunta a "${host}", que no es local. La siembra solo puede ejecutarse ` +
        'contra una base de desarrollo.',
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (supabaseUrl) {
    const h = hostDe(supabaseUrl)
    if (!HOSTS_LOCALES.includes(h)) {
      throw new Error(
        `NEXT_PUBLIC_SUPABASE_URL apunta a "${h}". Aunque DATABASE_URL sea local, esto ` +
          'indica un entorno mezclado: revísalo antes de sembrar.',
      )
    }
  }
}

// ── Puente con psql ─────────────────────────────────────────────────────────

/**
 * Comando de psql. `PSQL_BIN` permite usar el del contenedor:
 *   PSQL_BIN="docker exec -i supabase_db_darma psql"
 */
function comandoPsql(): { bin: string; args: string[] } {
  const crudo = process.env.PSQL_BIN ?? 'psql'
  const partes = crudo.split(' ').filter(Boolean)
  return { bin: partes[0], args: partes.slice(1) }
}

function ejecutarPsql(argumentos: string[], alimentar?: (stdin: NodeJS.WritableStream) => Promise<void>): Promise<void> {
  const { bin, args } = comandoPsql()
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(
      bin,
      // ON_ERROR_STOP=1 es obligatorio: sin él, psql sigue tras un error y el
      // script termina "con éxito" habiendo sembrado la mitad.
      [...args, '-v', 'ON_ERROR_STOP=1', '--quiet', '--no-psqlrc', cadenaConexion(), ...argumentos],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    )

    hijo.on('error', rechazar)
    hijo.on('close', (codigo) => {
      if (codigo === 0) resolver()
      else rechazar(new Error(`psql salió con código ${codigo}`))
    })

    if (alimentar) {
      alimentar(hijo.stdin)
        .then(() => hijo.stdin.end())
        .catch((e) => {
          hijo.stdin.destroy()
          rechazar(e)
        })
    } else {
      hijo.stdin.end()
    }
  })
}

async function sql(sentencia: string): Promise<void> {
  await ejecutarPsql(['-c', sentencia])
}

/** Igual, pero imprimiendo el resultado (para `--verificar-triggers`). */
async function sqlMostrando(sentencia: string): Promise<void> {
  await ejecutarPsql(['-c', sentencia, '--pset=pager=off'])
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Serializa un valor a un campo CSV para `COPY … (FORMAT csv)`.
 *
 * `null` → campo VACÍO SIN COMILLAS, que es como COPY representa NULL en modo
 * CSV. Un `""` (vacío entrecomillado) sería la cadena vacía, no NULL, y en
 * columnas con CHECK de longitud eso es la diferencia entre una fila válida y
 * un fallo a la mitad del millón.
 */
function campo(valor: string | number | boolean | null | Date): string {
  if (valor === null) return ''
  if (valor instanceof Date) return valor.toISOString()
  if (typeof valor === 'boolean') return valor ? 't' : 'f'
  if (typeof valor === 'number') return String(valor)
  if (/[",\n\r]/.test(valor)) return `"${valor.replace(/"/g, '""')}"`
  return valor
}

function fila(valores: Array<string | number | boolean | null | Date>): string {
  return `${valores.map(campo).join(',')}\n`
}

/**
 * Ejecuta un `\copy … FROM STDIN` alimentado por un generador.
 *
 * Respeta la contrapresión: si el buffer del socket se llena, se espera al
 * evento `drain` antes de seguir generando. Sin eso, generar un millón de filas
 * más rápido de lo que psql las consume acaba con el proceso en varios GB de
 * RAM — el fallo clásico de "mi script de siembra se comió el portátil".
 */
async function copiar(
  tabla: string,
  columnas: readonly string[],
  generador: () => Generator<string>,
  etiqueta: string,
  total: number,
): Promise<void> {
  const t0 = Date.now()
  let escritas = 0

  await ejecutarPsql(
    ['-c', `\\copy ${tabla} (${columnas.join(',')}) from stdin with (format csv)`],
    async (stdin) => {
      let bloque = ''
      for (const linea of generador()) {
        bloque += linea
        escritas += 1

        if (bloque.length >= 1 << 20) {
          if (!stdin.write(bloque)) {
            await new Promise<void>((r) => stdin.once('drain', () => r()))
          }
          bloque = ''
          if (escritas % 100_000 === 0) informar(`   … ${etiqueta}: ${escritas}/${total}`)
        }
      }
      if (bloque.length > 0) stdin.write(bloque)
    },
  )

  informar(`   ✓ ${etiqueta}: ${escritas} filas en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

function informar(mensaje: string): void {
  // Salida de una herramienta de línea de comandos, no logging de la app: va a
  // stdout directamente y no pasa por lib/observability/logger.ts (que existe
  // para peticiones HTTP y aplica muestreo).
  process.stdout.write(`${mensaje}\n`)
}

// ── Triggers ────────────────────────────────────────────────────────────────

/**
 * Triggers que hay que desactivar y por qué.
 *
 * Cada entrada dice qué se pierde al desactivarlo, porque desactivar un trigger
 * sin saber qué mantenía es cómo se acaba con una base incoherente que parece
 * sana. Todo lo que estos triggers calculaban, lo calcula el generador.
 */
const TRIGGERS = [
  {
    tabla: 'public.posts',
    nombre: 'trg_posts_reciprocity',
    motivo: 'gate 3:1 — rechazaría todo post a partir del segundo de cada autor',
  },
  {
    tabla: 'public.posts',
    nombre: 'trg_posts_hot',
    motivo: 'hot_score — se calcula en el generador con la misma fórmula',
  },
  {
    tabla: 'public.refuge_messages',
    nombre: 'trg_refuge_messages_sync',
    motivo: 'message_count / last_message_at — se calculan en el generador',
  },
  {
    tabla: 'public.refuge_members',
    nombre: 'trg_refuge_members_sync',
    motivo: 'member_count y el aforo — se calculan en el generador',
  },
] as const

async function ponerTriggers(accion: 'enable' | 'disable'): Promise<void> {
  for (const t of TRIGGERS) {
    await sql(`alter table ${t.tabla} ${accion} trigger ${t.nombre};`)
  }
  informar(accion === 'disable' ? '   ⚠ triggers desactivados' : '   ✓ triggers reactivados')
}

/**
 * Comprobación independiente. `tgenabled = 'O'` significa activo en modo origen;
 * 'D' es desactivado.
 *
 * Sale con código ≠ 0 si algo está desactivado, para poder encadenarlo en CI:
 * es la red que detecta una siembra abortada de forma sucia en la máquina de
 * otra persona.
 */
async function verificarTriggers(): Promise<void> {
  informar('Estado de los triggers críticos:')
  await sqlMostrando(`
    select t.tgname as trigger,
           c.relname as tabla,
           case t.tgenabled when 'D' then 'DESACTIVADO ⚠' else 'activo' end as estado
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where t.tgname in (${TRIGGERS.map((t) => `'${t.nombre}'`).join(',')})
     order by 3 desc, 1;
  `)
  // Falla el proceso si queda alguno desactivado.
  await sql(`
    do $$
    declare v_n integer;
    begin
      select count(*) into v_n from pg_trigger
       where tgname in (${TRIGGERS.map((t) => `'${t.nombre}'`).join(',')}) and tgenabled = 'D';
      if v_n > 0 then
        raise exception 'HAY % TRIGGER(S) DESACTIVADO(S). El gate de reciprocidad de Darma podría estar apagado. Ejecuta: node --experimental-strip-types scripts/seed/sembrar.ts --verificar-triggers y reactívalos.', v_n;
      end if;
    end $$;
  `)
  informar('   ✓ todos los triggers críticos están activos')
}

// ── Fases de siembra ────────────────────────────────────────────────────────

/** Id del perfil `i`. O(1), sin guardar un array de 100 000 uuids. */
function idPerfil(semilla: number, i: number): string {
  return idDeterminista(`${semilla}:perfil:${i}`)
}

function idPost(semilla: number, i: number): string {
  return idDeterminista(`${semilla}:post:${i}`)
}

function idRefugio(semilla: number, i: number): string {
  return idDeterminista(`${semilla}:refugio:${i}`)
}

async function sembrarPerfiles(o: Opciones): Promise<void> {
  informar(`\n▸ Fase 1/5 · perfiles (${o.perfiles})`)

  // auth.users PRIMERO: profiles.id es una FK a auth.users(id). Sembrar
  // `profiles` sin `auth.users` falla en la primera fila, y es el tropiezo con
  // el que empieza todo el mundo que intenta poblar un proyecto de Supabase.
  const azarUsuarios = crearAzar(o.semilla ^ 0x5eed0001)
  const ahora = new Date()

  await copiar(
    'auth.users',
    [
      'instance_id', 'id', 'aud', 'role', 'email', 'encrypted_password',
      'email_confirmed_at', 'created_at', 'updated_at',
      'raw_app_meta_data', 'raw_user_meta_data',
    ],
    function* () {
      for (let i = 0; i < o.perfiles; i += 1) {
        const creado = creadoEn(azarUsuarios, ahora)
        yield fila([
          '00000000-0000-0000-0000-000000000000',
          idPerfil(o.semilla, i),
          'authenticated',
          'authenticated',
          // TLD .invalid, reservado por la RFC 2606: no existe y no puede
          // recibir correo. Una siembra que use un dominio real acaba enviando
          // 100 000 correos el día que alguien pruebe el flujo de recuperación.
          `${PREFIJO_SEED}${i}@darma.invalid`,
          '$2a$10$siembra.no.es.una.contrasena.valida.jamas.usar.aqui.hash',
          creado,
          creado,
          creado,
          '{"provider":"seed","providers":["seed"]}',
          '{}',
        ])
      }
    },
    'auth.users',
    o.perfiles,
  )

  const azar = crearAzar(o.semilla ^ 0x5eed0002)
  await copiar(
    'public.profiles',
    [
      'id', 'alias', 'avatar_seed', 'bio', 'karma_reputation', 'karma_spendable',
      'listen_credits', 'listens_given', 'posts_published', 'crystals',
      'shadow_banned', 'availability', 'created_at', 'last_seen_at',
    ],
    function* () {
      for (let i = 0; i < o.perfiles; i += 1) {
        // Karma con cola larga: casi todo el mundo es 'semilla' y unos pocos
        // llegan a 'mentor'. `profiles.level` es una columna GENERADA, así que
        // no se siembra: la calcula Postgres y por eso no puede desincronizarse.
        const reputacion = colaLarga(azar, 0.9, 40_000)
        const creado = creadoEn(azar, ahora)
        const u = azar()

        yield fila([
          idPerfil(o.semilla, i),
          aliasSembrado(i),
          avatarSeedSembrado(azar),
          null,
          reputacion,
          Math.floor(reputacion * 0.3),
          // Crédito de escucha alto en los sembrados: si algún día se vuelve a
          // sembrar con el trigger ACTIVO (lote pequeño), no se atasca.
          10 + Math.floor(azar() * 90),
          Math.floor(reputacion / 10),
          0,
          azar() < 0.08 ? Math.floor(azar() * 500) : 0,
          // ~1 % en shadow-ban: es lo que hace que la política posts_read tenga
          // filas que excluir y que su coste real se pueda medir.
          azar() < 0.01,
          u < 0.75 ? 'disponible' : u < 0.9 ? 'necesito_hablar' : 'ausente',
          creado,
          creado,
        ])
      }
    },
    'profiles',
    o.perfiles,
  )
}

interface PostSembrado {
  id: string
  autor: number
  creado: Date
  upvotes: number
  replies: number
  tipo: string
  tema: string | null
  riesgo: string
  estado: string
  cuerpo: string
}

/**
 * Generador de posts. Se recorre DOS veces con la misma semilla: una para
 * sembrar `posts` y otra, en la fase de comentarios, para volver a derivar qué
 * post lleva cuántas respuestas — sin guardar un millón de objetos en memoria.
 *
 * Está en una sola función a propósito. Con dos copias de "la lógica de generar
 * un post" (una por fase), basta que alguien toque una para que los
 * comentarios acaben colgando de posts que no existen. Regenerar cuesta CPU y
 * la CPU sobra; la coherencia, no.
 *
 * `ahora` se pasa desde fuera y es el MISMO valor en las dos pasadas: si cada
 * fase llamara a `new Date()`, las fechas y por tanto la secuencia divergirían.
 */
function* generarPosts(o: Opciones, ahora: Date): Generator<PostSembrado> {
  const azar = crearAzar(o.semilla ^ 0x5eed0003)
  for (let i = 0; i < o.posts; i += 1) {
    const autor = autorDePost(azar, o.perfiles)
    const creado = creadoEn(azar, ahora)
    const upvotes = colaLarga(azar, 1.25, 5000)
    const replies = colaLarga(azar, 1.7, 400)
    const estado = estadoDePost(azar)
    const riesgo = riesgoDePost(azar)
    const tipo = tipoDePost(azar)
    const tema = temaDePost(azar)
    const cuerpo = cuerpoSintetico(azar, 60, 400)

    yield { id: idPost(o.semilla, i), autor, creado, upvotes, replies, tipo, tema, riesgo, estado, cuerpo }
  }
}

/**
 * Instante de referencia de la siembra.
 *
 * Fijo por semilla y NO `new Date()`: si la fase de posts y la de comentarios
 * usaran relojes distintos, el generador produciría secuencias distintas y los
 * comentarios apuntarían a uuids de posts inexistentes. Se ancla al día actual
 * a medianoche UTC para que las fechas sigan siendo "recientes" sin depender
 * del minuto en que se lanzó el script.
 */
function instanteReferencia(): Date {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

async function sembrarPosts(o: Opciones): Promise<void> {
  informar(`\n▸ Fase 2/5 · posts (${o.posts})`)
  const ahora = instanteReferencia()

  await copiar(
    'public.posts',
    [
      'id', 'author_id', 'kind', 'body', 'topic', 'upvote_count', 'reply_count',
      'hot_score', 'risk', 'state', 'created_at', 'updated_at',
    ],
    function* () {
      for (const p of generarPosts(o, ahora)) {
        yield fila([
          p.id,
          idPerfil(o.semilla, p.autor),
          p.tipo,
          p.cuerpo,
          p.tema,
          p.upvotes,
          p.replies,
          // Calculado aquí porque trg_posts_hot está desactivado. Ver la
          // decisión nº 3 de la cabecera.
          hotScore(p.upvotes, p.replies, p.creado),
          p.riesgo,
          p.estado,
          p.creado,
          p.creado,
        ])
      }
    },
    'posts',
    o.posts,
  )
}

async function sembrarComentarios(o: Opciones): Promise<void> {
  informar(`\n▸ Fase 3/5 · comentarios (${o.comentarios})`)
  const ahora = instanteReferencia()
  const azar = crearAzar(o.semilla ^ 0x5eed0004)

  await copiar(
    'public.comments',
    ['id', 'post_id', 'author_id', 'body', 'is_validated', 'quality_score', 'is_helpful', 'upvote_count', 'state', 'created_at'],
    function* () {
      let emitidos = 0
      let n = 0

      for (const post of generarPosts(o, ahora)) {
        if (emitidos >= o.comentarios) break
        if (post.replies === 0 || post.estado !== 'active') continue

        // Como mucho 12 comentarios reales por post, aunque `reply_count` diga
        // más. `reply_count` es el contador DESNORMALIZADO —la verdad para el
        // feed— y en producción tampoco tiene por qué coincidir con el número
        // de filas visibles: solo cuenta comentarios VALIDADOS.
        const cuantos = Math.min(post.replies, 12)

        for (let k = 0; k < cuantos && emitidos < o.comentarios; k += 1) {
          // Autor distinto del del post y distinto entre sí dentro del mismo
          // post: `uq_comments_one_listen_per_post` es un índice ÚNICO PARCIAL
          // sobre (post_id, author_id) where is_validated. Repetir autor en el
          // mismo post con is_validated = true rompería el COPY entero.
          const autor = (post.autor + 1 + k * 7919) % o.perfiles

          yield fila([
            idDeterminista(`${o.semilla}:comentario:${n}`),
            post.id,
            idPerfil(o.semilla, autor),
            cuerpoSintetico(azar, 80, 600),
            true,
            Math.round(azar() * 1000) / 1000,
            k === 0 && azar() < 0.15,
            colaLarga(azar, 1.5, 200),
            'active',
            new Date(post.creado.getTime() + Math.floor(azar() * 86400000)),
          ])
          emitidos += 1
          n += 1
        }
      }
    },
    'comments',
    o.comentarios,
  )
}

async function sembrarRefugios(o: Opciones): Promise<void> {
  informar(`\n▸ Fase 4/5 · refugios y mensajes (${o.refugios} salas, ${o.mensajes} mensajes)`)
  const ahora = instanteReferencia()

  // Las salas se materializan en memoria (decenas de miles de objetos, no
  // millones) en vez de regenerarse por fase. Con tres pasadas del PRNG
  // "alineadas a mano" bastaría cambiar una línea para que los mensajes
  // acabasen en salas distintas de las de sus miembros, y el fallo sería
  // silencioso: filas válidas, datos incoherentes, mediciones sin sentido.
  interface Sala {
    duo: boolean
    creado: Date
    miembros: number
    mensajes: number
    tema: string | null
    archivado: boolean
  }

  const salas: Sala[] = []
  {
    const azar = crearAzar(o.semilla ^ 0x5eed0005)
    let restantes = o.mensajes
    for (let i = 0; i < o.refugios; i += 1) {
      const duo = azar() < 0.8
      // `refuges.message_count` y `last_message_at` son contadores
      // desnormalizados cuyo trigger está desactivado durante la siembra: hay
      // que escribirlos con el valor correcto o la bandeja de refugios
      // mostrará números inventados.
      const mensajes = Math.min(Math.max(restantes, 0), colaLarga(azar, 0.85, 4000))
      restantes -= mensajes
      salas.push({
        duo,
        creado: creadoEn(azar, ahora),
        miembros: duo ? 2 : 3 + Math.floor(azar() * 5),
        mensajes,
        tema: temaDePost(azar),
        // ~10 % archivados: el índice idx_refuges_activity es PARCIAL sobre
        // `archived_at is null`, y sin filas archivadas no demuestra nada.
        archivado: azar() < 0.1,
      })
    }
  }

  await copiar(
    'public.refuges',
    ['id', 'kind', 'title', 'topic', 'created_by', 'max_members', 'member_count', 'message_count', 'last_message_at', 'archived_at', 'created_at'],
    function* () {
      for (let i = 0; i < o.refugios; i += 1) {
        const s = salas[i]
        yield fila([
          idRefugio(o.semilla, i),
          s.duo ? 'duo' : 'circulo',
          null,
          s.tema,
          idPerfil(o.semilla, i % o.perfiles),
          s.duo ? 2 : 8,
          s.miembros,
          s.mensajes,
          s.mensajes > 0 ? new Date(s.creado.getTime() + s.mensajes * 60000) : null,
          s.archivado ? s.creado : null,
          s.creado,
        ])
      }
    },
    'refuges',
    o.refugios,
  )

  await copiar(
    'public.refuge_members',
    ['refuge_id', 'user_id', 'is_host', 'muted', 'joined_at'],
    function* () {
      for (let i = 0; i < o.refugios; i += 1) {
        const s = salas[i]
        for (let m = 0; m < s.miembros; m += 1) {
          yield fila([
            idRefugio(o.semilla, i),
            // 104729 es primo y coprimo con o.perfiles en la práctica: garantiza
            // que los miembros de una misma sala son personas DISTINTAS (la PK
            // es (refuge_id, user_id) y un duplicado rompería el COPY entero).
            idPerfil(o.semilla, (i + m * 104729) % o.perfiles),
            m === 0,
            false,
            s.creado,
          ])
        }
      }
    },
    'refuge_members',
    o.refugios * 2,
  )

  const azarMensajes = crearAzar(o.semilla ^ 0x5eed0007)
  await copiar(
    'public.refuge_messages',
    ['refuge_id', 'sender_id', 'ciphertext', 'nonce', 'enc_version', 'kind', 'byte_size', 'state', 'created_at'],
    function* () {
      for (let i = 0; i < o.refugios; i += 1) {
        const s = salas[i]
        for (let m = 0; m < s.mensajes; m += 1) {
          // El ciphertext es un BLOB OPACO: el servidor no tiene la clave (ver
          // 0002_comunidad.sql §2). Se siembra ruido hexadecimal del tamaño
          // típico de un mensaje cifrado, no texto: sembrar texto legible aquí
          // enseñaría a alguien que esa columna admite texto en claro.
          const bytes = 64 + Math.floor(azarMensajes() * 400)
          yield fila([
            idRefugio(o.semilla, i),
            idPerfil(o.semilla, (i + m) % o.perfiles),
            `\\x${'ab'.repeat(bytes)}`,
            '\\x000102030405060708090a0b',
            1,
            'text',
            bytes,
            'active',
            new Date(s.creado.getTime() + m * 60000),
          ])
        }
      }
    },
    'refuge_messages',
    o.mensajes,
  )
}

async function sembrarModeracion(o: Opciones): Promise<void> {
  informar(`\n▸ Fase 5/5 · moderación y crisis (${o.flags} señales, ${o.crisis} eventos)`)
  const ahora = new Date()

  const azarFlags = crearAzar(o.semilla ^ 0x5eed0008)
  await copiar(
    'public.moderation_flags',
    ['ref_type', 'ref_id', 'subject_id', 'reporter_id', 'signal', 'severity', 'state', 'created_at'],
    function* () {
      for (let i = 0; i < o.flags; i += 1) {
        const post = Math.floor(azarFlags() * o.posts)
        // Solo ~4 % pendientes. Es LA propiedad que hace que idx_moderation_queue
        // (índice parcial `where state = 'pending'`) mantenga su tamaño
        // proporcional al backlog y no al histórico. Sembrar el 100 % pendiente
        // haría que el índice parcial pareciese inútil.
        const u = azarFlags()
        yield fila([
          'post',
          idPost(o.semilla, post),
          idPerfil(o.semilla, Math.floor(azarFlags() * o.perfiles)),
          idPerfil(o.semilla, Math.floor(azarFlags() * o.perfiles)),
          u < 0.5 ? 'ai_toxicity' : u < 0.85 ? 'user_report' : 'spam_heuristic',
          1 + Math.floor(azarFlags() * 5),
          u < 0.04 ? 'pending' : u < 0.6 ? 'resolved' : 'dismissed',
          creadoEn(azarFlags, ahora),
        ])
      }
    },
    'moderation_flags',
    o.flags,
  )

  const azarCrisis = crearAzar(o.semilla ^ 0x5eed0009)
  await copiar(
    'public.crisis_events',
    ['user_id', 'ref_type', 'ref_id', 'risk', 'resources_shown', 'country_code', 'human_reviewed', 'created_at', 'attended_at'],
    function* () {
      for (let i = 0; i < o.crisis; i += 1) {
        const creado = creadoEn(azarCrisis, ahora)
        // Muy pocos SIN ATENDER: idx_crisis_pending es parcial sobre
        // `attended_at is null and risk in ('high','critical')`, y su valor está
        // precisamente en que la cola viva sea diminuta frente al histórico.
        const pendiente = azarCrisis() < 0.002
        yield fila([
          idPerfil(o.semilla, Math.floor(azarCrisis() * o.perfiles)),
          'post',
          idPost(o.semilla, Math.floor(azarCrisis() * o.posts)),
          azarCrisis() < 0.25 ? 'critical' : 'high',
          '{linea_024,chat_telefono_esperanza}',
          'ES',
          !pendiente,
          creado,
          pendiente ? null : new Date(creado.getTime() + 600000),
        ])
      }
    },
    'crisis_events',
    o.crisis,
  )
}

// ── ANALYZE y limpieza ──────────────────────────────────────────────────────

const TABLAS_ANALIZADAS = [
  'public.profiles', 'public.posts', 'public.comments',
  'public.refuges', 'public.refuge_members', 'public.refuge_messages',
  'public.moderation_flags', 'public.crisis_events',
]

/**
 * SIN ESTO, LAS MEDICIONES MIENTEN — y mienten hacia el lado bueno.
 *
 * Recién sembrada, `pg_class.reltuples` sigue diciendo que `posts` está casi
 * vacía. El planificador elige entonces planes de tabla pequeña (seq scans que
 * "van rapidísimo" porque cree que hay 20 filas, o el índice correcto por pura
 * casualidad) y el `EXPLAIN ANALYZE` resultante no describe nada de lo que
 * pasará en producción. Es la causa número uno de mediciones falsamente buenas.
 */
async function analizar(): Promise<void> {
  informar('\n▸ ANALYZE (sin esto, los EXPLAIN mienten)')
  const t0 = Date.now()
  await sql(`analyze ${TABLAS_ANALIZADAS.join(', ')};`)
  informar(`   ✓ estadísticas actualizadas en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

/**
 * Borra SOLO lo sembrado, identificado por el prefijo reservado del alias.
 *
 * El borrado va por `auth.users`, no por `profiles`: `profiles.id` referencia
 * `auth.users(id)` con `on delete cascade`, y desde ahí cascadean posts,
 * comentarios, refugios, señales y eventos de crisis. Borrar `profiles`
 * directamente dejaría huérfanas las filas de `auth.users`, que es justo el
 * estado que hace fallar la siguiente siembra por el UNIQUE del email.
 */
async function limpiar(): Promise<void> {
  informar(`\n▸ Limpiando lo sembrado (alias con prefijo "${PREFIJO_SEED}")`)
  await sql(`
    delete from auth.users u
     where exists (
       select 1 from public.profiles p
        where p.id = u.id and p.alias like '${PREFIJO_SEED}%'
     );
  `)
  // Cinturón y tirantes: si algún perfil se creó sin su fila de auth.users
  // (siembra interrumpida entre las dos fases), esto lo recoge.
  await sql(`delete from public.profiles where alias like '${PREFIJO_SEED}%';`)
  informar('   ✓ borrado')
  // Tras borrar el 90 % de una tabla, las estadísticas son tan falsas como
  // después de sembrarla.
  await analizar()
}

// ── Orquestación ────────────────────────────────────────────────────────────

async function principal(): Promise<void> {
  const o = leerOpciones(process.argv.slice(2))

  if (o.verificarTriggers) {
    await verificarTriggers()
    return
  }

  comprobarEntorno()

  if (o.limpiar) {
    await limpiar()
    await verificarTriggers()
    return
  }

  informar('Darma · siembra masiva')
  informar(`   semilla=${o.semilla}  perfiles=${o.perfiles}  posts=${o.posts}`)
  informar(`   fases: ${[...o.fases].join(', ')}`)

  // Si el proceso muere por una señal, el `finally` de abajo NO se ejecuta. Sin
  // estos manejadores, un Ctrl-C en mitad de la siembra deja el gate de
  // reciprocidad apagado en la base de quien lo ejecutó — y, cuando comparta el
  // comando, en la de quien lo copie.
  let reactivando = false
  const reactivarYSalir = (senal: string) => {
    if (reactivando) return
    reactivando = true
    process.stdout.write(`\n${senal}: reactivando triggers antes de salir…\n`)
    ponerTriggers('enable')
      .catch(() => process.stderr.write('NO SE PUDIERON REACTIVAR LOS TRIGGERS. Ejecuta --verificar-triggers.\n'))
      .finally(() => process.exit(130))
  }
  process.on('SIGINT', () => reactivarYSalir('SIGINT'))
  process.on('SIGTERM', () => reactivarYSalir('SIGTERM'))

  const t0 = Date.now()
  await ponerTriggers('disable')
  try {
    if (o.fases.has('perfiles')) await sembrarPerfiles(o)
    if (o.fases.has('posts')) await sembrarPosts(o)
    if (o.fases.has('comentarios')) await sembrarComentarios(o)
    if (o.fases.has('refugios')) await sembrarRefugios(o)
    if (o.fases.has('moderacion')) await sembrarModeracion(o)
  } finally {
    // Pase lo que pase. Un script que muere a mitad y deja el gate 3:1 apagado
    // es peor que un script que no funciona.
    await ponerTriggers('enable')
  }

  await analizar()
  await verificarTriggers()

  informar(`\n✓ Siembra completa en ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`)
  informar('  Siguiente paso: los planes de scripts/load/explain.sql')
  informar('    psql "$DATABASE_URL" -f scripts/load/explain.sql > /tmp/explain.txt')
}

principal().catch((error: unknown) => {
  process.stderr.write(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`)
  process.stderr.write('  Si la siembra se interrumpió, comprueba los triggers:\n')
  process.stderr.write('    node --experimental-strip-types scripts/seed/sembrar.ts --verificar-triggers\n')
  process.exit(1)
})
