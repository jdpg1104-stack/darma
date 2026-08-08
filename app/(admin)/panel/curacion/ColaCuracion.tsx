'use client'

// ============================================================================
// La cola de curación — CLIENTE, porque decidir exige interacción
//
// ── UNA TARJETA CADA VEZ, NO UNA LISTA ────────────────────────────────────
// La lista completa con un botón «aprobar» en cada fila invita a barrer de
// arriba abajo sin abrir nada: es la versión con ratón del `UPDATE` en bloque
// que esta pantalla viene a sustituir. Con una sola tarjeta delante, la única
// forma de avanzar es decidir sobre ESA — y el enlace para verla está antes que
// los botones, en el orden en que se lee.
//
// ── EL BOTÓN DE APROBAR NO SE HABILITA HASTA ABRIR EL VÍDEO ───────────────
// No es un obstáculo por desconfianza. La regla escrita del proyecto es
// «aprobar es una decisión humana y se toma con el vídeo delante», y hasta hoy
// era una frase sin nada que la sostuviera. Abrir el enlace es la señal más
// barata de que eso ocurrió. No demuestra que se haya visto entero —nada lo
// demuestra— pero convierte el atajo en algo que hay que hacer a propósito.
//
// Descartar NO exige abrirlo: un título que ya deja claro que no encaja no
// merece gastar el clic, y poner la misma fricción a las dos salidas empujaría
// a aprobar por inercia, que es justo lo contrario de lo que se busca.
//
// ── Y AHORA, EL MOMENTO (2026-08-08) ──────────────────────────────────────
// Para una pieza larga, aprobar ya no es un sí: es elegir QUÉ minuto se enseña.
// El botón de aprobar exige además el recorte cuando el vídeo pasa del techo de
// fragmento, y la validación se hace aquí ANTES de enviar por una razón
// concreta: el servidor y el CHECK del esquema van a rechazarlo igual, pero
// enterarse tras el viaje significa perder el número que acabas de anotar
// mientras mirabas el vídeo.
//
// El enlace al vídeo lleva `?t=` al inicio del fragmento en cuanto hay un
// inicio escrito: comprobar el recorte es exactamente para lo que se abre el
// vídeo la segunda vez.
// ============================================================================

import { useCallback, useMemo, useState } from 'react'

import { Boton, Chip } from '@/components/ui'
import { obtenerTraductor } from '@/i18n'
import type { Locale } from '@/i18n'
import { clipValido, exigeFragmento } from '@/lib/video/acreditacion'

export interface ItemPendiente {
  id: string
  source: string
  title: string
  summary: string | null
  url: string
  language: string
  topic: string | null
  duracionSegundos: number | null
}

export type Cola = 'pendientes' | 'recorte'

interface Props {
  inicial: readonly ItemPendiente[]
  total: number
  locale: Locale
  /** Qué se está curando. En `recorte` no se aprueba ni se descarta: se encuadra. */
  cola: Cola
  /** Topes del fragmento, servidos por la API para no tener una cuarta copia. */
  minSegundos: number
  maxSegundos: number
}

type Estado = 'lista' | 'enviando' | 'error'

/** El campo vacío es «sin fragmento», no «cero». `Number('')` es 0 y eso sería
 *  un recorte que empieza en el segundo 0 sin que nadie lo haya pedido. */
function aSegundos(valor: string): number | null {
  const limpio = valor.trim()
  if (limpio === '') return null
  const n = Number(limpio)
  return Number.isInteger(n) ? n : Number.NaN
}

/**
 * El enlace al vídeo, saltando al inicio del fragmento cuando ya hay uno.
 *
 * Solo se toca el parámetro `t` y solo sobre URLs http(s): una `url` del
 * catálogo viene de un feed de terceros, y construir un enlace a partir de
 * texto sin analizarlo es como se cuela un `javascript:` en un `href`.
 */
export function enlaceConSalto(url: string, inicioSegundos: number | null): string {
  if (inicioSegundos === null || inicioSegundos <= 0) return url
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return url
    u.searchParams.set('t', `${inicioSegundos}s`)
    return u.toString()
  } catch {
    return url
  }
}

export function ColaCuracion({ inicial, total, locale, cola, minSegundos, maxSegundos }: Props) {
  const t = useMemo(() => obtenerTraductor(locale), [locale])

  const [pendientes, setPendientes] = useState<readonly ItemPendiente[]>(inicial)
  const [restantes, setRestantes] = useState(total)
  const [estado, setEstado] = useState<Estado>('lista')
  const [aviso, setAviso] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [inicio, setInicio] = useState('')
  const [fin, setFin] = useState('')

  const actual = pendientes[0] ?? null

  const siguiente = useCallback(() => {
    setPendientes((c) => c.slice(1))
    setRestantes((n) => Math.max(0, n - 1))
    setAbierto(false)
    setMotivo('')
    setInicio('')
    setFin('')
    setEstado('lista')
  }, [])

  const decidir = useCallback(
    async (decision: 'aprobar' | 'rechazar' | 'recortar') => {
      if (!actual) return

      if (decision === 'rechazar' && motivo.trim().length < 3) {
        setAviso(t('admin.curacion.motivoObligatorio'))
        return
      }

      const desde = aSegundos(inicio)
      const hasta = aSegundos(fin)
      const conFragmento = desde !== null || hasta !== null

      if (decision !== 'rechazar') {
        if (conFragmento && !clipValido(desde, hasta, actual.duracionSegundos)) {
          setAviso(
            t('admin.curacion.fragmentoInvalido', { min: minSegundos, max: maxSegundos }),
          )
          return
        }
        if (!conFragmento && exigeFragmento(actual.duracionSegundos)) {
          setAviso(t('admin.curacion.fragmentoObligatorio'))
          return
        }
      }

      setEstado('enviando')
      setAviso(null)
      try {
        const res = await fetch('/api/admin/curacion', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: actual.id,
            decision,
            ...(decision === 'rechazar' ? { motivo: motivo.trim() } : {}),
            ...(decision !== 'rechazar' && conFragmento
              ? { inicioSegundos: desde, finSegundos: hasta }
              : {}),
          }),
        })
        const cuerpo: { ok?: boolean; mensajeClave?: string } = await res.json()

        if (!res.ok) {
          // La clave de catálogo del servidor manda; el texto genérico es el
          // respaldo. Es el contrato de errores del proyecto (CONTRATOS §4).
          setAviso(
            cuerpo.mensajeClave
              ? t(cuerpo.mensajeClave, { min: minSegundos, max: maxSegundos })
              : t('admin.curacion.error'),
          )
          setEstado('error')
          return
        }

        setAviso(
          t(
            decision === 'aprobar'
              ? 'admin.curacion.aprobado'
              : decision === 'recortar'
                ? 'admin.curacion.recortado'
                : 'admin.curacion.rechazado',
          ),
        )
        siguiente()
      } catch {
        setAviso(t('admin.curacion.error'))
        setEstado('error')
      }
    },
    [actual, fin, inicio, maxSegundos, minSegundos, motivo, siguiente, t],
  )

  if (!actual) {
    return (
      <section>
        <p>
          <strong>{t(cola === 'recorte' ? 'admin.curacion.vaciaRecorte' : 'admin.curacion.vacia')}</strong>
        </p>
        <p>
          {t(
            cola === 'recorte'
              ? 'admin.curacion.vaciaRecorteDetalle'
              : 'admin.curacion.vaciaDetalle',
          )}
        </p>
        {aviso ? <p role="status">{aviso}</p> : null}
      </section>
    )
  }

  const enviando = estado === 'enviando'
  const obligatorio = exigeFragmento(actual.duracionSegundos)
  const desdeAhora = aSegundos(inicio)
  // NaN es «has escrito algo que no es un entero». Se distingue de `null`
  // («no has escrito nada») porque lo primero es un error y lo segundo no.
  const saltoValido = desdeAhora !== null && Number.isInteger(desdeAhora) ? desdeAhora : null

  return (
    <section>
      <p role="status">{t('admin.curacion.quedan', { n: restantes })}</p>

      <article>
        <h2>{actual.title}</h2>
        <p>
          <Chip>{actual.language}</Chip> <Chip>{actual.topic ?? t('admin.curacion.sinTema')}</Chip>{' '}
          <Chip>{actual.source}</Chip>
          {actual.duracionSegundos !== null ? (
            <>
              {' '}
              <Chip>
                {t('admin.curacion.duracion', { min: Math.round(actual.duracionSegundos / 60) })}
              </Chip>
            </>
          ) : null}
        </p>
        {actual.summary ? <p>{actual.summary}</p> : null}

        {/* Antes que los botones, a propósito: el orden de lectura es el orden
            en que debería ocurrir la decisión. */}
        <p>
          <a
            href={enlaceConSalto(actual.url, saltoValido)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setAbierto(true)}
            data-testid="curacion-abrir"
          >
            {t('admin.curacion.abrir')}
          </a>
        </p>

        {!abierto ? <p>{t('admin.curacion.aviso')}</p> : null}

        <fieldset>
          <legend>{t('admin.curacion.fragmento')}</legend>
          <p>
            {t(
              obligatorio
                ? 'admin.curacion.fragmentoObligatorio'
                : 'admin.curacion.fragmentoOpcional',
            )}
          </p>
          <p>{t('admin.curacion.fragmentoAyuda', { min: minSegundos, max: maxSegundos })}</p>

          <label htmlFor="clip-inicio">{t('admin.curacion.fragmentoInicio')}</label>
          <input
            id="clip-inicio"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            disabled={enviando}
            data-testid="curacion-clip-inicio"
          />

          <label htmlFor="clip-fin">{t('admin.curacion.fragmentoFin')}</label>
          <input
            id="clip-fin"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={fin}
            onChange={(e) => setFin(e.target.value)}
            disabled={enviando}
            data-testid="curacion-clip-fin"
          />
        </fieldset>

        {cola === 'recorte' ? (
          <Boton
            onClick={() => void decidir('recortar')}
            disabled={!abierto || enviando}
            data-testid="curacion-recortar"
          >
            {t('admin.curacion.recortar')}
          </Boton>
        ) : (
          <>
            <Boton
              onClick={() => void decidir('aprobar')}
              disabled={!abierto || enviando}
              data-testid="curacion-aprobar"
            >
              {t('admin.curacion.aprobar')}
            </Boton>

            <hr />

            <label htmlFor="motivo-descarte">{t('admin.curacion.motivo')}</label>
            <textarea
              id="motivo-descarte"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={t('admin.curacion.motivoPlaceholder')}
              maxLength={200}
              rows={2}
              disabled={enviando}
            />
            <Boton
              variante="secundario"
              onClick={() => void decidir('rechazar')}
              disabled={enviando}
              data-testid="curacion-rechazar"
            >
              {t('admin.curacion.rechazar')}
            </Boton>
          </>
        )}
      </article>

      {aviso ? <p role="alert">{aviso}</p> : null}
    </section>
  )
}
