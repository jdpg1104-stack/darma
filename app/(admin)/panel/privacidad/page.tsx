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
// Todo el copy sale del catálogo (`admin.privacidad.*`). `logica.ts` devuelve
// CLAVES, no texto: la clasificación de plazos no conoce el idioma.
// ============================================================================

import Link from 'next/link'
import { Chip, EstadoVacio } from '@/components/ui'
import { obtenerTraductor, resolverLocale, type Traductor } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import { duracion, entero, fecha } from '../../_componentes/Formato.ts'
import {
  CLAVE_ESTADO,
  CLAVE_TIPO,
  CLAVE_URGENCIA,
  TOPE_ABIERTAS,
  aVista,
  leerAbiertas,
  leerFallidas,
  leerHistorial,
  parsearCursor,
  prepararAbiertas,
  resumirAbiertas,
  type SolicitudVista,
} from './logica.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El chip que marca cada fila frente a su plazo. El color nunca va solo:
 *  el texto dice lo mismo (§Seguridad 5). */
function MarcaPlazo({ vista, t }: { vista: SolicitudVista; t: Traductor }) {
  if (vista.urgencia !== null) {
    const tono =
      vista.urgencia === 'vencida'
        ? 'peligro'
        : vista.urgencia === 'vence_pronto'
          ? 'aviso'
          : 'neutro'
    return <Chip tono={tono}>{t(CLAVE_URGENCIA[vista.urgencia])}</Chip>
  }
  if (vista.cumplioPlazo !== null) {
    return vista.cumplioPlazo ? (
      <Chip tono="logro">{t('admin.privacidad.dentroDelPlazo')}</Chip>
    ) : (
      <Chip tono="peligro">{t('admin.privacidad.fueraDePlazo')}</Chip>
    )
  }
  return <>—</>
}

function TablaSolicitudes({
  titulo,
  filas,
  t,
}: {
  titulo: string
  filas: readonly SolicitudVista[]
  t: Traductor
}) {
  return (
    <table>
      <caption>{titulo}</caption>
      <thead>
        <tr>
          <th scope="col">{t('admin.privacidad.colSolicitud')}</th>
          <th scope="col">{t('admin.privacidad.colTipo')}</th>
          <th scope="col">{t('admin.privacidad.colEstado')}</th>
          <th scope="col">{t('admin.privacidad.colSolicitada')}</th>
          <th scope="col">{t('admin.privacidad.colAntiguedad')}</th>
          <th scope="col">{t('admin.privacidad.colVence')}</th>
          <th scope="col">{t('admin.privacidad.colPlazo')}</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((v) => (
          <tr key={v.id}>
            <th scope="row">
              <code>{v.id}</code>
            </th>
            <td>{t(CLAVE_TIPO[v.kind])}</td>
            <td>
              {v.state === 'failed' ? (
                <Chip tono="peligro">{t(CLAVE_ESTADO[v.state])}</Chip>
              ) : (
                t(CLAVE_ESTADO[v.state])
              )}
            </td>
            <td>{fecha(v.solicitadaEn)}</td>
            <td>{duracion(v.edadSegundos)}</td>
            <td>{v.venceEn === null ? '—' : fecha(v.venceEn)}</td>
            <td>
              <MarcaPlazo vista={v} t={t} />
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

  const t = obtenerTraductor(await resolverLocale())
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
      <h1>{t('admin.privacidad.titulo')}</h1>
      <p>{t('admin.privacidad.intro')}</p>

      {!hayAlgo ? (
        <EstadoVacio titulo={t('admin.privacidad.vacioTitulo')} descripcion={t('admin.privacidad.vacioDescripcion')} />
      ) : (
        <>
          <dl aria-label={t('admin.privacidad.totales')}>
            <div>
              <dt>{t('admin.privacidad.totalVencidas')}</dt>
              <dd>
                {resumen.vencidas > 0 ? (
                  <Chip tono="peligro">{entero(resumen.vencidas)}</Chip>
                ) : (
                  entero(resumen.vencidas)
                )}
              </dd>
            </div>
            <div>
              <dt>{t('admin.privacidad.totalVencenPronto')}</dt>
              <dd>
                {resumen.vencenPronto > 0 ? (
                  <Chip tono="aviso">{entero(resumen.vencenPronto)}</Chip>
                ) : (
                  entero(resumen.vencenPronto)
                )}
              </dd>
            </div>
            <div>
              <dt>{t('admin.privacidad.totalFallidas')}</dt>
              <dd>
                {vistasFallidas.length > 0 ? (
                  <Chip tono="peligro">{entero(vistasFallidas.length)}</Chip>
                ) : (
                  entero(vistasFallidas.length)
                )}
              </dd>
            </div>
            <div>
              <dt>{t('admin.privacidad.totalPendientesConfirmar')}</dt>
              <dd>{entero(resumen.pendientesConfirmar)}</dd>
            </div>
            <div>
              <dt>{t('admin.privacidad.totalConfirmadas')}</dt>
              <dd>{entero(resumen.confirmadas)}</dd>
            </div>
            <div>
              <dt>{t('admin.privacidad.totalEnEjecucion')}</dt>
              <dd>{entero(resumen.enEjecucion)}</dd>
            </div>
            <div>
              <dt>{t('admin.privacidad.totalCaducadas')}</dt>
              <dd>{entero(resumen.caducadas)}</dd>
            </div>
            {cursor === null ? (
              <div>
                <dt>{t('admin.privacidad.totalCerradas')}</dt>
                <dd>{entero(historial.totalDesdeCursor)}</dd>
              </div>
            ) : null}
          </dl>

          {abiertas.desbordadas ? <p>{t('admin.privacidad.desborde', { tope: TOPE_ABIERTAS })}</p> : null}

          {urgentes.length > 0 ? (
            <section>
              <h2>{t('admin.privacidad.seccionUrgentes')}</h2>
              <p>{t('admin.privacidad.notaUrgentes')}</p>
              <TablaSolicitudes titulo={t('admin.privacidad.seccionUrgentes')} filas={urgentes} t={t} />
            </section>
          ) : (
            <p>
              <Chip tono="logro">{t('admin.privacidad.todoAlDia')}</Chip>
            </p>
          )}

          {vistasFallidas.length > 0 ? (
            <section>
              <h2>{t('admin.privacidad.seccionFallidas')}</h2>
              <p>{t('admin.privacidad.notaFallidas')}</p>
              {fallidas.desbordadas ? <p>{t('admin.privacidad.desborde', { tope: TOPE_ABIERTAS })}</p> : null}
              <TablaSolicitudes titulo={t('admin.privacidad.seccionFallidas')} filas={vistasFallidas} t={t} />
            </section>
          ) : null}

          {restoAbiertas.length > 0 ? (
            <section>
              <h2>{t('admin.privacidad.seccionAbiertas')}</h2>
              <p>{t('admin.privacidad.notaAbiertas')}</p>
              <TablaSolicitudes titulo={t('admin.privacidad.seccionAbiertas')} filas={restoAbiertas} t={t} />
            </section>
          ) : null}

          <section>
            <h2>{t('admin.privacidad.seccionHistorial')}</h2>
            {vistasHistorial.length > 0 ? (
              <TablaSolicitudes titulo={t('admin.privacidad.seccionHistorial')} filas={vistasHistorial} t={t} />
            ) : (
              <p>{t('admin.privacidad.sinFilasHistorial')}</p>
            )}
            <p>
              {historial.siguienteCursor !== null ? (
                <Link
                  href={`/panel/privacidad?antes=${encodeURIComponent(historial.siguienteCursor)}`}
                >
                  {t('admin.privacidad.masAntiguas')}
                </Link>
              ) : null}{' '}
              {cursor !== null ? (
                <Link href="/panel/privacidad">{t('admin.privacidad.volverAlPrincipio')}</Link>
              ) : null}
            </p>
          </section>
        </>
      )}
    </section>
  )
}
