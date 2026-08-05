// ============================================================================
// /panel/privacidad — solicitudes RGPD y su plazo. SERVER COMPONENT.
//
// Existe por el pedido de B20 a B19 (HANDOFF/PEDIDOS.md): sin esta vista no se
// puede demostrar el cumplimiento del plazo del art. 12.3. Toda la lógica —qué
// vence, cuándo y qué cuenta como incumplimiento— vive en `./logica.ts`, que
// es puro y tiene sus pruebas al lado; esta página solo consulta y pinta.
//
// Mismo patrón que /panel/crisis: guard `requireAdmin` + cliente admin directo
// en el servidor, SIN ruta de API intermedia (la página es el único consumidor
// y una ruta extra sería una superficie más que proteger). Cero JS de cliente,
// y ⛔ sin `<Suspense>` ni loading.tsx (app/SIN-LOADING.md).
//
// Rol mínimo `operaciones`, no `moderador`: quién está a punto de irse no es
// una decisión de contenido sino información de operación y cumplimiento, más
// sensible que cualquier métrica agregada. Igual que economía.
//
// El copy va en español directo desde `logica.ts` (el panel admin es solo en
// español; los catálogos son de otro bloque — deuda anotada, ver logica.ts).
// ============================================================================

import Link from 'next/link'
import { Chip, EstadoVacio } from '@/components/ui'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import { duracion, entero, fecha } from '../../_componentes/Formato.ts'
import {
  ETIQUETA_ESTADO,
  ETIQUETA_TIPO,
  ETIQUETA_URGENCIA,
  TEXTOS,
  TOPE_ABIERTAS,
  aVista,
  leerAbiertas,
  leerFallidas,
  leerHistorial,
  parsearCursor,
  prepararAbiertas,
  resumirAbiertas,
  textoDesborde,
  type SolicitudVista,
} from './logica.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El chip que marca cada fila frente a su plazo. El color nunca va solo:
 *  el texto dice lo mismo (§Seguridad 5). */
function MarcaPlazo({ vista }: { vista: SolicitudVista }) {
  if (vista.urgencia !== null) {
    const tono =
      vista.urgencia === 'vencida'
        ? 'peligro'
        : vista.urgencia === 'vence_pronto'
          ? 'aviso'
          : 'neutro'
    return <Chip tono={tono}>{ETIQUETA_URGENCIA[vista.urgencia]}</Chip>
  }
  if (vista.cumplioPlazo !== null) {
    return vista.cumplioPlazo ? (
      <Chip tono="logro">{TEXTOS.dentroDelPlazo}</Chip>
    ) : (
      <Chip tono="peligro">{TEXTOS.fueraDePlazo}</Chip>
    )
  }
  return <>—</>
}

function TablaSolicitudes({
  titulo,
  filas,
}: {
  titulo: string
  filas: readonly SolicitudVista[]
}) {
  return (
    <table>
      <caption>{titulo}</caption>
      <thead>
        <tr>
          <th scope="col">{TEXTOS.colSolicitud}</th>
          <th scope="col">{TEXTOS.colTipo}</th>
          <th scope="col">{TEXTOS.colEstado}</th>
          <th scope="col">{TEXTOS.colSolicitada}</th>
          <th scope="col">{TEXTOS.colAntiguedad}</th>
          <th scope="col">{TEXTOS.colVence}</th>
          <th scope="col">{TEXTOS.colPlazo}</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((v) => (
          <tr key={v.id}>
            <th scope="row">
              <code>{v.id}</code>
            </th>
            <td>{ETIQUETA_TIPO[v.kind]}</td>
            <td>
              {v.state === 'failed' ? (
                <Chip tono="peligro">{ETIQUETA_ESTADO[v.state]}</Chip>
              ) : (
                ETIQUETA_ESTADO[v.state]
              )}
            </td>
            <td>{fecha(v.solicitadaEn)}</td>
            <td>{duracion(v.edadSegundos)}</td>
            <td>{v.venceEn === null ? '—' : fecha(v.venceEn)}</td>
            <td>
              <MarcaPlazo vista={v} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface PropsPagina {
  // En Next 16 los searchParams de una página son asíncronos.
  searchParams: Promise<{ antes?: string | string[] }>
}

export default async function PaginaPrivacidad({ searchParams }: PropsPagina) {
  await requireAdmin('operaciones', { accion: `${ACCIONES.panel}.privacidad` })

  const params = await searchParams
  const crudo = Array.isArray(params.antes) ? params.antes[0] : params.antes
  // Un cursor inválido o manipulado NO es un error de pantalla: primera página.
  const cursor = parsearCursor(crudo)

  const admin = createAdminClient()
  const ahora = new Date()

  // TRES consultas por render, el presupuesto de CONTRATOS §11 (ver logica.ts).
  const [abiertas, fallidas, historial] = await Promise.all([
    leerAbiertas(admin),
    leerFallidas(admin),
    leerHistorial(admin, cursor),
  ])

  const { urgentes, enPlazo, caducadas } = prepararAbiertas(abiertas.filas, ahora)
  const resumen = resumirAbiertas(abiertas.filas, ahora)
  const vistasFallidas = fallidas.filas.map((f) => aVista(f, ahora))
  const vistasHistorial = historial.filas.map((f) => aVista(f, ahora))
  // Caducadas al final de la tabla de abiertas: son madera muerta, no urgencia.
  const restoAbiertas = [...enPlazo, ...caducadas]

  const hayAlgo =
    abiertas.filas.length > 0 || vistasFallidas.length > 0 || vistasHistorial.length > 0

  return (
    <section>
      <h1>{TEXTOS.titulo}</h1>
      <p>{TEXTOS.intro}</p>

      {!hayAlgo ? (
        <EstadoVacio titulo={TEXTOS.vacioTitulo} descripcion={TEXTOS.vacioDescripcion} />
      ) : (
        <>
          <dl aria-label={TEXTOS.totales}>
            <div>
              <dt>{TEXTOS.totalVencidas}</dt>
              <dd>
                {resumen.vencidas > 0 ? (
                  <Chip tono="peligro">{entero(resumen.vencidas)}</Chip>
                ) : (
                  entero(resumen.vencidas)
                )}
              </dd>
            </div>
            <div>
              <dt>{TEXTOS.totalVencenPronto}</dt>
              <dd>
                {resumen.vencenPronto > 0 ? (
                  <Chip tono="aviso">{entero(resumen.vencenPronto)}</Chip>
                ) : (
                  entero(resumen.vencenPronto)
                )}
              </dd>
            </div>
            <div>
              <dt>{TEXTOS.totalFallidas}</dt>
              <dd>
                {vistasFallidas.length > 0 ? (
                  <Chip tono="peligro">{entero(vistasFallidas.length)}</Chip>
                ) : (
                  entero(vistasFallidas.length)
                )}
              </dd>
            </div>
            <div>
              <dt>{TEXTOS.totalPendientesConfirmar}</dt>
              <dd>{entero(resumen.pendientesConfirmar)}</dd>
            </div>
            <div>
              <dt>{TEXTOS.totalConfirmadas}</dt>
              <dd>{entero(resumen.confirmadas)}</dd>
            </div>
            <div>
              <dt>{TEXTOS.totalEnEjecucion}</dt>
              <dd>{entero(resumen.enEjecucion)}</dd>
            </div>
            <div>
              <dt>{TEXTOS.totalCaducadas}</dt>
              <dd>{entero(resumen.caducadas)}</dd>
            </div>
            {cursor === null ? (
              <div>
                <dt>{TEXTOS.totalCerradas}</dt>
                <dd>{entero(historial.totalDesdeCursor)}</dd>
              </div>
            ) : null}
          </dl>

          {abiertas.desbordadas ? <p>{textoDesborde(TOPE_ABIERTAS)}</p> : null}

          {urgentes.length > 0 ? (
            <section>
              <h2>{TEXTOS.seccionUrgentes}</h2>
              <p>{TEXTOS.notaUrgentes}</p>
              <TablaSolicitudes titulo={TEXTOS.seccionUrgentes} filas={urgentes} />
            </section>
          ) : (
            <p>
              <Chip tono="logro">{TEXTOS.todoAlDia}</Chip>
            </p>
          )}

          {vistasFallidas.length > 0 ? (
            <section>
              <h2>{TEXTOS.seccionFallidas}</h2>
              <p>{TEXTOS.notaFallidas}</p>
              {fallidas.desbordadas ? <p>{textoDesborde(TOPE_ABIERTAS)}</p> : null}
              <TablaSolicitudes titulo={TEXTOS.seccionFallidas} filas={vistasFallidas} />
            </section>
          ) : null}

          {restoAbiertas.length > 0 ? (
            <section>
              <h2>{TEXTOS.seccionAbiertas}</h2>
              <p>{TEXTOS.notaAbiertas}</p>
              <TablaSolicitudes titulo={TEXTOS.seccionAbiertas} filas={restoAbiertas} />
            </section>
          ) : null}

          <section>
            <h2>{TEXTOS.seccionHistorial}</h2>
            {vistasHistorial.length > 0 ? (
              <TablaSolicitudes titulo={TEXTOS.seccionHistorial} filas={vistasHistorial} />
            ) : (
              <p>{TEXTOS.sinFilasHistorial}</p>
            )}
            <p>
              {historial.siguienteCursor !== null ? (
                <Link
                  href={`/panel/privacidad?antes=${encodeURIComponent(historial.siguienteCursor)}`}
                >
                  {TEXTOS.masAntiguas}
                </Link>
              ) : null}{' '}
              {cursor !== null ? (
                <Link href="/panel/privacidad">{TEXTOS.volverAlPrincipio}</Link>
              ) : null}
            </p>
          </section>
        </>
      )}
    </section>
  )
}
