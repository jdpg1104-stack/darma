'use client'

// ============================================================================
// B10 · El redactor: donde el texto en claro deja de existir
//
// ── EL ORDEN DE LAS COSAS, QUE ES LO ÚNICO QUE IMPORTA AQUÍ ────────────────
// 1. `assessCrisisRisk(texto)` sobre el texto EN CLARO, en el navegador. El
//    servidor no puede hacerlo: recibiría un blob.
// 2. Si el nivel es high/critical, se enseña la tarjeta de recursos YA, en esta
//    misma interacción (CONTRATOS §9.1).
// 3. Se cifra y se envía. SIEMPRE. Se prioriza, no se censura (§9.2).
// 4. Se registra el nivel —solo el nivel— en `/api/refuges/crisis`.
//
// Si alguien invierte 2 y 3 «para no molestar si falla el envío», la persona en
// riesgo se queda sin recursos justo cuando falla la red. El orden es el que es.
//
// ── EL BOTÓN DE CRISIS VIVE AQUÍ DENTRO ────────────────────────────────────
// `BotonCrisis` va en la misma caja que el campo de texto y no flotando en una
// esquina, porque con el teclado abierto en móvil un elemento fijo al viewport
// se va detrás del teclado. El contenedor usa `dvh` y `env(safe-area-inset-*)`
// para que la fila entera —campo, enviar y recursos— siga en pantalla.
// ============================================================================

import { useState, type FormEvent } from 'react'

import { Boton, BotonCrisis } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import { assessCrisisRisk, type RiskLevel } from '@/lib/crisis'
import { TarjetaCrisis } from './TarjetaCrisis'
import estilos from './refugio.module.css'

export interface RedactorProps {
  /** Cifra y envía. Recibe el texto EN CLARO y es el único que lo ve. */
  alEnviar: (texto: string, riesgo: RiskLevel) => Promise<void>
  /** `false` cuando este dispositivo no tiene la llave: no se puede cifrar. */
  puedeEscribir: boolean
  pais?: string | null
}

export function Redactor({ alEnviar, puedeEscribir, pais = null }: RedactorProps) {
  const t = useTraductor()
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [riesgo, setRiesgo] = useState<RiskLevel>('none')
  const [error, setError] = useState<string | null>(null)

  async function manejarEnvio(evento: FormEvent) {
    evento.preventDefault()
    const contenido = texto.trim()
    if (!contenido || enviando) return

    // (1) y (2): evaluación y recursos ANTES de tocar la red.
    const evaluacion = assessCrisisRisk(contenido)
    setRiesgo(evaluacion.risk_level)

    setEnviando(true)
    setError(null)
    try {
      // (3): se envía igual, sea cual sea el nivel.
      await alEnviar(contenido, evaluacion.risk_level)
      setTexto('')
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : t('refugios.redactor.error'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className={estilos.redactor} onSubmit={manejarEnvio}>
      {/* La tarjeta se queda hasta que la persona escribe otra cosa: no es un
          toast, y desaparecer sola sería perderla justo cuando hace falta. */}
      <TarjetaCrisis nivel={riesgo} pais={pais} />

      {error ? (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={estilos.redactorFila}>
        <label className="sr-only" htmlFor="redactor-refugio">
          {t('refugios.redactor.etiqueta')}
        </label>
        <textarea
          id="redactor-refugio"
          className={estilos.campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={t(
            puedeEscribir ? 'refugios.redactor.marcador' : 'refugios.redactor.marcadorSinLlave',
          )}
          rows={1}
          disabled={!puedeEscribir}
          // El texto de un refugio no se corrige ni se autocompleta con
          // servicios del sistema: en algunos teclados eso viaja fuera.
          autoComplete="off"
          spellCheck={false}
        />
        <Boton type="submit" cargando={enviando} disabled={!puedeEscribir || texto.trim().length === 0}>
          {t('refugios.redactor.enviar')}
        </Boton>
      </div>

      <div className={estilos.filaCrisis}>
        <BotonCrisis posicion="inline" />
      </div>
    </form>
  )
}
