// ============================================================================
// /encuestas — redactar una encuesta. SERVER COMPONENT.
// Rol mínimo: `moderador` (el mismo que exige `POST /api/polls/crear` y el
// mismo que vuelve a exigir `crear_encuesta()` dentro de Postgres).
//
// Existe porque no había NINGUNA vía de creación: el banco se repone solo y
// `encuesta_siguiente()` sirve las encuestas al feed, pero nadie podía publicar
// una (pedido de B09 → B00 en HANDOFF/PEDIDOS.md).
//
// ── LO QUE SE VE Y LO QUE NO ───────────────────────────────────────────────
// La lista de abajo enseña la pregunta, el idioma, el estado y el total de
// votos. NO enseña `author_id` (quién preguntó no forma parte de responder) ni
// `poll_options.vote_count` — el reparto por opción solo sale por
// `encuesta_resultados()`, que aplica el umbral de revelación dentro del motor.
// Que esta pantalla tenga el cliente `service_role` en la mano no es una
// excusa para saltárselo: sería el único sitio del sistema donde el agregado
// de una encuesta se lee sin umbral, y ese sitio acaba siendo el que se copia.
//
// ── EL FORMULARIO NO ESCRIBE ───────────────────────────────────────────────
// Envía a `POST /api/polls/crear`, que es donde están el rate limiting, la
// auditoría y la evaluación de crisis. Una Server Action aquí sería un segundo
// camino de escritura con sus propias comprobaciones, y de eso conviene tener
// uno solo.
// ============================================================================

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../api/admin/_guard.ts'
import { ROL_MINIMO } from '../../api/polls/crear/limites.ts'
import { TablaSerie } from '../_componentes/TablaSerie.tsx'
import { entero, fecha } from '../_componentes/Formato.ts'
import { FormularioEncuesta } from './FormularioEncuesta.tsx'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface FilaEncuesta {
  id: string
  question: string
  language: string
  state: string
  origin: string
  total_votes: number
  created_at: string
}

/**
 * `polls.state` → CLAVE del catálogo. No es lo mismo «retirada por moderación»
 * que «guardada sin publicar por señales de crisis», pero `polls.state` no
 * distingue los dos casos. Se etiqueta por lo que la persona ve: no está en el
 * feed.
 *
 * `Map` y no objeto literal: la clave viene de la base de datos y un `state`
 * inesperado no debe poder tocar el prototipo.
 */
const CLAVE_POR_ESTADO = new Map<string, string>([
  ['active', 'admin.encuestas.estado.active'],
  ['hidden', 'admin.encuestas.estado.hidden'],
  ['removed', 'admin.encuestas.estado.removed'],
])

export default async function PaginaEncuestas() {
  await requireAdmin(ROL_MINIMO, { accion: 'admin.encuestas.lista' })

  const t = obtenerTraductor(await resolverLocale())
  const admin = createAdminClient()
  const { data } = await admin
    .from('polls')
    .select('id, question, language, state, origin, total_votes, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  const filas = (data ?? []) as FilaEncuesta[]

  return (
    <section>
      <h1>{t('admin.encuestas.titulo')}</h1>
      <p>{t('admin.encuestas.intro1')}</p>
      <p>{t('admin.encuestas.intro2')}</p>

      <h2>{t('admin.encuestas.nueva')}</h2>
      <FormularioEncuesta />

      <h2>{t('admin.encuestas.ultimas')}</h2>
      <TablaSerie
        titulo={t('admin.encuestas.tablaTitulo')}
        columnas={[
          { clave: 'pregunta', etiqueta: t('admin.encuestas.colPregunta') },
          { clave: 'idioma', etiqueta: t('admin.encuestas.colIdioma') },
          { clave: 'origen', etiqueta: t('admin.encuestas.colOrigen') },
          { clave: 'estado', etiqueta: t('admin.encuestas.colEstado') },
          { clave: 'votos', etiqueta: t('admin.encuestas.colRespuestas') },
          { clave: 'creada', etiqueta: t('admin.encuestas.colCreada') },
        ]}
        filas={filas.map((f) => {
          const claveEstado = CLAVE_POR_ESTADO.get(f.state)
          return {
            // La pregunta la escribió una persona: se pinta tal cual, nunca se traduce.
            pregunta: f.question,
            idioma: f.language,
            origen:
              f.origin === 'banco'
                ? t('admin.encuestas.origenBanco')
                : t('admin.encuestas.origenPersona'),
            estado: claveEstado === undefined ? f.state : t(claveEstado),
            // El total NO revela el reparto, y es lo que permite entender por qué
            // una encuesta todavía no enseña porcentajes sin mentir sobre cuánta
            // gente ha contestado.
            votos: entero(f.total_votes),
            creada: fecha(f.created_at),
          }
        })}
      />
    </section>
  )
}
