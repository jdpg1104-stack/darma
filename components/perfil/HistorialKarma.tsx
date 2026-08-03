'use client'

// ============================================================================
// HistorialKarma — el ledger, con "cargar más" por cursor.
//
// Es de cliente por una sola razón: acumular páginas sin recargar la pantalla.
// La PRIMERA página llega ya renderizada desde el servidor, así que el
// historial se ve —y se lee entero— aunque el JS no llegue nunca a hidratar;
// lo único que se pierde sin JS es el botón de ampliar.
//
// ── EL CURSOR NO SE INTERPRETA ─────────────────────────────────────────────
// `siguienteCursor` es una cadena opaca que se devuelve tal cual. Este
// componente no sabe —ni debe saber— que dentro va el par `(created_at, id)`.
// El día que el keyset cambie de columnas, aquí no se toca nada.
//
// ── POR QUÉ NO HAY NÚMERO DE PÁGINA ────────────────────────────────────────
// Porque no hay `OFFSET` y no lo va a haber: el historial de alguien con tres
// años de uso son decenas de miles de filas, y `OFFSET 20000` las lee todas
// para tirarlas. Sin OFFSET no existe "la página 47", y ofrecer un salto a una
// página concreta obligaría a reintroducirlo.
// ============================================================================

import { useMemo, useState } from 'react'

import { useTraductor } from '@/i18n/Proveedor'
import { Boton, EstadoVacio } from '../ui/index.ts'
import { formatearDelta, formatearFechaCorta } from './fechas.ts'
import type { EventoKarma, PaginaCursor } from './tipos.ts'
import estilos from './perfil.module.css'

export interface HistorialKarmaProps {
  /** Primera página, renderizada en el servidor. */
  inicial: PaginaCursor<EventoKarma>
}

/** Respuesta de la ruta, en la forma de CONTRATOS §4. */
interface RespuestaHistorial {
  ok: boolean
  data?: PaginaCursor<EventoKarma>
}

export function HistorialKarma({ inicial }: HistorialKarmaProps) {
  const t = useTraductor()
  // Los doce meses cortos, en el idioma activo. `formatearFechaCorta` los
  // recibe en vez de leerlos por su cuenta: así sigue siendo pura y da el mismo
  // resultado en el servidor y tras hidratar (ver la cabecera de fechas.ts).
  const meses = useMemo(
    () => Array.from({ length: 12 }, (_, i) => t(`comun.mesCorto.${i + 1}`)),
    [t],
  )
  const [items, setItems] = useState<EventoKarma[]>(inicial.items)
  const [cursor, setCursor] = useState<string | null>(inicial.siguienteCursor)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargarMas() {
    if (!cursor || cargando) return
    setCargando(true)
    setError(null)

    try {
      const respuesta = await fetch(
        `/api/karma/historial?limite=20&cursor=${encodeURIComponent(cursor)}`,
        { headers: { accept: 'application/json' } },
      )
      const cuerpo = (await respuesta.json()) as RespuestaHistorial

      if (!respuesta.ok || !cuerpo.ok || !cuerpo.data) {
        // Mensaje propio, no el del servidor: el cuerpo de error ya está
        // redactado, pero encadenar textos ajenos en la UI es cómo acaba
        // apareciendo un nombre de tabla en pantalla.
        setError(t('karma.errorCargarMas'))
        return
      }

      setItems((previos) => [...previos, ...cuerpo.data!.items])
      setCursor(cuerpo.data.siguienteCursor)
    } catch {
      setError(t('karma.errorCargarMas'))
    } finally {
      setCargando(false)
    }
  }

  if (items.length === 0) {
    return (
      <section className={estilos.seccion} aria-labelledby="titulo-historial">
        <h2 className={estilos.tituloSeccion} id="titulo-historial">
          {t('karma.historialTitulo')}
        </h2>
        <EstadoVacio
          titulo={t('karma.historialVacioTitulo')}
          descripcion={t('karma.historialVacioDescripcion')}
          tono="neutro"
        />
      </section>
    )
  }

  return (
    <section className={estilos.seccion} aria-labelledby="titulo-historial">
      <h2 className={estilos.tituloSeccion} id="titulo-historial">
        {t('karma.historialTitulo')}
      </h2>

      {/* aria-live para que quien usa lector de pantalla se entere de que la
          lista ha crecido; 'polite' porque no interrumpe nada urgente. */}
      <ul className={estilos.historial} aria-live="polite">
        {items.map((evento, indice) => (
          <li
            // No hay id que usar como clave: el bigint del ledger no sale de la
            // API a propósito (CONTRATOS §1). El par (instante, posición) es
            // estable porque la lista solo CRECE por el final: nunca se
            // reordena ni se inserta en medio.
            key={`${evento.ocurridoEn}-${indice}`}
            className={estilos.evento}
          >
            {/* Por `kind`, no por `evento.descripcion`: esa cadena la resuelve
                `KARMA_WEIGHTS` de lib/karma.ts (la SSOT de la economía) y está
                en un solo idioma. */}
            <span className={estilos.eventoDescripcion}>{t(`karma.tipos.${evento.kind}`)}</span>
            <time className={estilos.eventoFecha} dateTime={evento.ocurridoEn}>
              {formatearFechaCorta(evento.ocurridoEn, meses)}
            </time>
            <span
              className={`${estilos.delta} ${
                evento.deltaReputacion > 0
                  ? estilos.deltaPositivo
                  : evento.deltaReputacion < 0
                    ? estilos.deltaNegativo
                    : ''
              }`}
            >
              {formatearDelta(evento.deltaReputacion)}
              {/* Un gasto mueve el saldo gastable y no la reputación: si solo
                  se pintara el delta de reputación, un boost de −50 saldría en
                  el historial como «0» y la pantalla de transparencia estaría
                  ocultando justo el movimiento que la persona busca. */}
              {evento.deltaGastable !== 0 ? (
                <span className={estilos.deltaGastable}>
                  {formatearDelta(evento.deltaGastable)} {t('karma.gastableSufijo')}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {error ? <p className={estilos.error}>{error}</p> : null}

      {cursor ? (
        <div className={estilos.acciones}>
          <Boton variante="secundario" onClick={cargarMas} cargando={cargando}>
            {t('karma.cargarMas')}
          </Boton>
        </div>
      ) : null}
    </section>
  )
}
