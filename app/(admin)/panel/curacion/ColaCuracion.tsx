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
// ============================================================================

import { useCallback, useMemo, useState } from 'react'

import { Boton, Chip } from '@/components/ui'
import { obtenerTraductor } from '@/i18n'
import type { Locale } from '@/i18n'

export interface ItemPendiente {
  id: string
  source: string
  title: string
  summary: string | null
  url: string
  language: string
  topic: string | null
}

interface Props {
  inicial: readonly ItemPendiente[]
  total: number
  locale: Locale
}

type Estado = 'lista' | 'enviando' | 'error'

export function ColaCuracion({ inicial, total, locale }: Props) {
  const t = useMemo(() => obtenerTraductor(locale), [locale])

  const [pendientes, setPendientes] = useState<readonly ItemPendiente[]>(inicial)
  const [restantes, setRestantes] = useState(total)
  const [estado, setEstado] = useState<Estado>('lista')
  const [aviso, setAviso] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')

  const actual = pendientes[0] ?? null

  const siguiente = useCallback(() => {
    setPendientes((cola) => cola.slice(1))
    setRestantes((n) => Math.max(0, n - 1))
    setAbierto(false)
    setMotivo('')
    setEstado('lista')
  }, [])

  const decidir = useCallback(
    async (decision: 'aprobar' | 'rechazar') => {
      if (!actual) return
      if (decision === 'rechazar' && motivo.trim().length < 3) {
        setAviso(t('admin.curacion.motivoObligatorio'))
        return
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
          }),
        })
        const cuerpo: { ok?: boolean; mensajeClave?: string } = await res.json()

        if (!res.ok) {
          // La clave de catálogo del servidor manda; el texto genérico es el
          // respaldo. Es el contrato de errores del proyecto (CONTRATOS §4).
          setAviso(cuerpo.mensajeClave ? t(cuerpo.mensajeClave) : t('admin.curacion.error'))
          setEstado('error')
          return
        }

        setAviso(t(decision === 'aprobar' ? 'admin.curacion.aprobado' : 'admin.curacion.rechazado'))
        siguiente()
      } catch {
        setAviso(t('admin.curacion.error'))
        setEstado('error')
      }
    },
    [actual, motivo, siguiente, t],
  )

  if (!actual) {
    return (
      <section>
        <p>
          <strong>{t('admin.curacion.vacia')}</strong>
        </p>
        <p>{t('admin.curacion.vaciaDetalle')}</p>
        {aviso ? <p role="status">{aviso}</p> : null}
      </section>
    )
  }

  const enviando = estado === 'enviando'

  return (
    <section>
      <p role="status">{t('admin.curacion.quedan', { n: restantes })}</p>

      <article>
        <h2>{actual.title}</h2>
        <p>
          <Chip>{actual.language}</Chip> <Chip>{actual.topic ?? t('admin.curacion.sinTema')}</Chip>{' '}
          <Chip>{actual.source}</Chip>
        </p>
        {actual.summary ? <p>{actual.summary}</p> : null}

        {/* Antes que los botones, a propósito: el orden de lectura es el orden
            en que debería ocurrir la decisión. */}
        <p>
          <a
            href={actual.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setAbierto(true)}
          >
            {t('admin.curacion.abrir')}
          </a>
        </p>

        {!abierto ? <p>{t('admin.curacion.aviso')}</p> : null}

        <Boton onClick={() => void decidir('aprobar')} disabled={!abierto || enviando}>
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
        <Boton variante="secundario" onClick={() => void decidir('rechazar')} disabled={enviando}>
          {t('admin.curacion.rechazar')}
        </Boton>
      </article>

      {aviso ? <p role="alert">{aviso}</p> : null}
    </section>
  )
}
