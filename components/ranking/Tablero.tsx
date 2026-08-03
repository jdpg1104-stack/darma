'use client'

// ============================================================================
// B06 · Tablero paginado.
//
// ES EL ÚNICO COMPONENTE CLIENTE DE TODA LA PANTALLA, y solo por el «cargar
// más». Las filas de la primera página llegan renderizadas desde el servidor:
// sin JavaScript el tablero se ve entero, con su podio y su posición, y lo
// único que falta es el botón de continuar. Ese es el orden correcto de
// degradación en una pantalla que alguien puede abrir con mala conexión.
//
// ── PAGINACIÓN KEYSET, NUNCA OFFSET ────────────────────────────────────────
// El cursor es opaco por contrato (CONTRATOS §5) y aquí se trata como tal: se
// guarda y se reenvía, jamás se interpreta. Si el servidor cambia de tupla de
// keyset, este componente no se entera.
//
// ── POR QUÉ EL ERROR NO SE TRAGA ───────────────────────────────────────────
// Si «cargar más» falla, se dice. La alternativa —dejar el botón como si nada—
// hace pensar que la lista se ha terminado, y alguien que estaba buscando su
// nombre concluye que no está.
// ============================================================================

import { useCallback, useState } from 'react'

import { Avatar, Boton } from '../ui/index.ts'
import type { FilaRanking, PeriodoRanking, TableroRanking } from '@/lib/ranking/tipos'
import { InsigniaMovimiento } from './InsigniaMovimiento.tsx'
import estilos from './ranking.module.css'

export interface TableroProps {
  periodo: PeriodoRanking
  /** Página 1, renderizada en el servidor. */
  inicial: TableroRanking
  /** Para resaltar tu propia fila cuando aparece dentro de la página. */
  miId?: string | null
}

interface RespuestaApi {
  ok: boolean
  data?: TableroRanking
}

export function Tablero({ periodo, inicial, miId }: TableroProps) {
  const [items, setItems] = useState<FilaRanking[]>(inicial.items)
  const [cursor, setCursor] = useState<string | null>(inicial.siguienteCursor)
  const [cargando, setCargando] = useState(false)
  const [fallo, setFallo] = useState(false)

  const cargarMas = useCallback(async () => {
    if (!cursor || cargando) return
    setCargando(true)
    setFallo(false)

    try {
      const url = `/api/ranking?periodo=${encodeURIComponent(periodo)}&cursor=${encodeURIComponent(cursor)}`
      const respuesta = await fetch(url, { headers: { accept: 'application/json' } })
      const cuerpo = (await respuesta.json()) as RespuestaApi

      if (!respuesta.ok || !cuerpo.ok || !cuerpo.data) {
        setFallo(true)
        return
      }

      // Se concatena sin deduplicar: el keyset garantiza que la página
      // siguiente empieza exactamente donde terminó la anterior, así que un
      // duplicado sería un bug del servidor y taparlo aquí lo escondería.
      setItems((previos) => [...previos, ...cuerpo.data!.items])
      setCursor(cuerpo.data.siguienteCursor)
    } catch {
      setFallo(true)
    } finally {
      setCargando(false)
    }
  }, [cursor, cargando, periodo])

  const esHistorico = periodo === 'historico'

  return (
    <>
      <ol className={estilos.tablero}>
        {items.map((fila) => (
          <li
            key={fila.perfil.id}
            className={`${estilos.fila} ${fila.perfil.id === miId ? estilos.filaPropia : ''}`}
            aria-current={fila.perfil.id === miId ? 'true' : undefined}
          >
            <span className={estilos.posicion}>
              <span className="sr-only">Puesto </span>
              {fila.posicion}
            </span>

            <Avatar
              semilla={fila.perfil.avatarSeed}
              tamano={40}
              alias={fila.perfil.alias}
              nivel={fila.perfil.nivel}
            />

            <span className={estilos.alias}>{fila.perfil.alias}</span>

            <span className={estilos.escuchas}>
              {fila.escuchas}
              <span className="sr-only">
                {fila.escuchas === 1 ? ' persona acompañada' : ' personas acompañadas'}
              </span>
            </span>

            <InsigniaMovimiento
              movimiento={fila.movimiento}
              esHistorico={esHistorico}
              nivel={fila.perfil.nivel}
            />
          </li>
        ))}
      </ol>

      {cursor ? (
        <div className={estilos.masAcciones}>
          <Boton variante="secundario" onClick={cargarMas} cargando={cargando}>
            Ver más
          </Boton>
        </div>
      ) : null}

      {fallo ? (
        <p className={estilos.error} role="status">
          No hemos podido cargar más. Inténtalo otra vez en un momento.
        </p>
      ) : null}
    </>
  )
}
