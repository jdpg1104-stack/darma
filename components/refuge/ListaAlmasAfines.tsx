'use client'

// ============================================================================
// B10 · Almas afines
//
// ── LA ÚNICA SEÑAL ES `availability`, Y LA PONE LA PERSONA ─────────────────
// Aquí se ve si alguien está 'disponible', 'ausente' o 'necesito_hablar'. Ese
// estado lo pone ella misma y es lo único que se comparte.
//
// Lo que NO se hace, y suena humano, y es exactamente lo que no se puede hacer:
// avisar a los contactos cuando el clasificador marca a alguien en riesgo.
// Sería revelar un dato de salud mental a terceros sin consentimiento y haría
// que la gente dejara de escribir con sinceridad — con lo cual el clasificador
// dejaría de detectar nada y no habría a quien avisar. `crisis_events` no tiene
// ninguna política RLS y no se filtra por ningún camino (HANDOFF/B10.md §10).
// ============================================================================

import { useState } from 'react'

import { Avatar, Boton, Chip, EstadoVacio } from '@/components/ui'
import type { AlmaAfin } from '@/lib/crypto/tipos'
import { MenuBloquear } from './MenuBloquear'
import { olvidarAlmaAfin } from './api'
import estilos from './refugio.module.css'

export interface ListaAlmasAfinesProps {
  almas: readonly AlmaAfin[]
}

const ETIQUETA: Readonly<Record<AlmaAfin['disponibilidad'], { texto: string; tono: 'neutro' | 'logro' | 'aviso' }>> = {
  disponible: { texto: 'Disponible', tono: 'logro' },
  necesito_hablar: { texto: 'Necesita hablar', tono: 'aviso' },
  ausente: { texto: 'Ausente', tono: 'neutro' },
}

export function ListaAlmasAfines({ almas }: ListaAlmasAfinesProps) {
  const [ocultas, setOcultas] = useState<ReadonlySet<string>>(new Set())

  const visibles = almas.filter((a) => !ocultas.has(a.id))

  if (visibles.length === 0) {
    return (
      <EstadoVacio
        tono="cuidado"
        titulo="Todavía no has guardado a nadie"
        descripcion="Las almas afines son las personas que te han acompañado y a las que puedes volver. Se guardan desde su perfil, y ellas no reciben ningún aviso por ello."
      />
    )
  }

  async function olvidar(id: string) {
    // Optimista y reversible: si la petición falla, la persona vuelve a la
    // lista. Nunca al revés — desaparecer de la lista sin haberse borrado de
    // verdad haría creer que alguien ya no está guardado cuando sí lo está.
    setOcultas((previas) => new Set([...previas, id]))
    try {
      await olvidarAlmaAfin(id)
    } catch {
      setOcultas((previas) => {
        const copia = new Set(previas)
        copia.delete(id)
        return copia
      })
    }
  }

  return (
    <ul className={estilos.lista}>
      {visibles.map((alma) => {
        const estadoDisponibilidad = ETIQUETA[alma.disponibilidad]
        return (
          <li key={alma.id} className={estilos.almaFila}>
            <Avatar semilla={alma.avatarSeed} alias={alma.alias} nivel={alma.nivel} tamano={40} />
            <span className={estilos.almaCuerpo}>
              <span className={estilos.filaTitulo}>{alma.alias}</span>
              <span className={estilos.filaMeta}>
                {/* Texto, no solo color: el chip lleva la palabra escrita. */}
                <Chip tono={estadoDisponibilidad.tono}>{estadoDisponibilidad.texto}</Chip>
                {alma.note ? ` · ${alma.note}` : ''}
              </span>
            </span>
            <span className={estilos.almaAcciones}>
              <MenuBloquear userId={alma.id} alias={alma.alias} />
              <Boton variante="fantasma" tamano="sm" onClick={() => void olvidar(alma.id)}>
                Quitar
              </Boton>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
