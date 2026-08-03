// ============================================================================
// GET /api/privacy/exportar/[id] — descarga de UN SOLO USO, caduca en 24 h.
//
// ── LAS CUATRO BARRERAS, Y POR QUÉ HACEN FALTA LAS CUATRO ──────────────────
//  1. Sesión iniciada y `user_id` de la solicitud igual al de la sesión. El
//     uuid del enlace no es la credencial: es solo el localizador.
//  2. Uso único. Lo aplica `consumir_exportacion()` con un `update … returning`
//     sobre el estado, así que dos peticiones simultáneas con el mismo enlace
//     no pueden ganar las dos: la segunda no encuentra fila que cumpla.
//  3. Caducidad de 24 h, dentro de esa misma sentencia.
//  4. `Cache-Control: no-store` y `Content-Disposition: attachment`. Sin lo
//     primero, un proxy o el propio navegador guardan el archivo; sin lo
//     segundo, el JSON se abre en una pestaña y se queda en el historial.
//
// ── POR QUÉ 404 Y NUNCA 403 ────────────────────────────────────────────────
// Con el id de otra persona, con un id ya usado o con uno caducado, la
// respuesta es la misma: `no_encontrado`. Un 403 confirmaría que ese id existe,
// y con eso se puede enumerar quién ha pedido una exportación.
// ============================================================================

import { detectPii } from '@/lib/anonymity'
import { ErrorApi } from '@/lib/auth/errores'
import { requirePerfil } from '@/lib/auth/session'
import {
  construirExportacionCon,
  nombreArchivoExportacion,
  revisarPiiExportacion,
  serializarExportacion,
} from '@/lib/privacy/exportar'
import { createAdminClient } from '@/lib/supabase/admin'

import { limitarPrivacidad, registrarMovimiento } from '../../_dominio/comun'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Un uuid v4 y nada más. Se valida antes de tocar la base para que un id
 *  basura no llegue siquiera a ser una consulta. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Esta ruta no usa `manejarRuta` porque su respuesta feliz NO es JSON de
  // API sino un archivo adjunto; el camino de error sí se serializa a mano con
  // la misma forma de CONTRATOS §4.
  try {
    const { id } = await params
    if (!UUID.test(id)) throw new ErrorApi('no_encontrado')

    const sesion = await requirePerfil()
    const admin = createAdminClient()

    await limitarPrivacidad('descargar', sesion.userId, admin)

    // Comprobación de dueño, uso único y caducidad, todo en una sentencia.
    const { data, error } = await admin.rpc('consumir_exportacion', {
      p_solicitud: id,
      p_user: sesion.userId,
    })
    if (error) throw new ErrorApi('error_interno', { causa: error })
    if (data !== true) throw new ErrorApi('no_encontrado')

    const exportacion = await construirExportacionCon(admin, sesion.userId)

    // Modo AVISO, no filtro: si la persona escribió su propio teléfono en un
    // post, ese teléfono es suyo y va en su exportación. Lo que se registra es
    // el RECUENTO por tipo, nunca el texto — un patrón que aparece en muchas
    // exportaciones a la vez es una fuga sistemática y hay que poder verla.
    const pii = revisarPiiExportacion(exportacion, detectPii)

    registrarMovimiento('exportacion_descargada', sesion.userId, {
      solicitud: id,
      publicaciones: exportacion.publicaciones.length,
      comentarios: exportacion.comentarios.length,
      apoyo_recibido: exportacion.apoyoRecibido.length,
      truncados: exportacion.bloquesTruncados.join(',') || 'ninguno',
      pii: JSON.stringify(pii),
    })

    return new Response(serializarExportacion(exportacion), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nombreArchivoExportacion()}"`,
        // Sin esto el archivo se queda en cualquier caché intermedia. En una app
        // anónima, una exportación cacheada es la vida de alguien servida a otro.
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (causa) {
    const esApi =
      typeof causa === 'object' && causa !== null && (causa as { name?: string }).name === 'ErrorApi'
    const error = esApi ? (causa as ErrorApi) : new ErrorApi('error_interno', { causa })

    if (!esApi) console.error('[darma][privacidad] descarga fallida', causa)

    return Response.json(
      { ok: false, code: error.code, message: error.message },
      { status: error.status, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}
