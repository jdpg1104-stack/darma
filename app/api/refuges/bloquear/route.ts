// ============================================================================
// B10 · POST /api/refuges/bloquear
//
// El bloqueo es la herramienta de seguridad personal más importante de la app,
// así que lo aplica el MOTOR, no esta ruta: en cuanto la fila existe,
// `refuge_has_block()` entra en el USING de las políticas de `refuges` y
// `refuge_messages` y la sala compartida desaparece para las dos partes. Sin
// desplegar nada, sin caché que invalidar y sin que la app pueda equivocarse.
//
// Esta ruta solo escribe la fila y aplica el límite. Si algún día alguien
// «mejora» esto ocultando a la persona en la UI en vez de escribir el bloqueo,
// el bloqueo dejará de existir para un `curl` a PostgREST — que es exactamente
// lo que hace quien de verdad quiere alcanzar a alguien.
//
// 'block' corta en los dos sentidos. 'mute' solo oculta a quien silencia, y la
// otra parte no nota nada: eso es lo que hace seguro silenciar a alguien
// agresivo sin provocarle.
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { codigoDesdeErrorDeRefugio, contexto, limitar } from '../_dominio/servidor'
import { esquemaBloquear } from '../_dominio/validacion'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const ctx = await contexto()
    await limitar('bloquear', ctx)

    const cuerpo = esquemaBloquear.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorApi('entrada_invalida')

    if (cuerpo.data.userId === ctx.sesion.userId) {
      throw new ErrorApi('entrada_invalida', { mensaje: 'No puedes bloquearte a ti.' })
    }

    const { error } = await ctx.supabase.from('blocks').insert({
      // De la SESIÓN. Aceptar un `blocker_id` del cuerpo permitiría bloquear en
      // nombre de otra persona, que es una forma de aislarla.
      blocker_id: ctx.sesion.userId,
      blocked_id: cuerpo.data.userId,
      mode: cuerpo.data.mode,
      reason: cuerpo.data.reason ?? null,
    })

    if (error) {
      // Bloquear a quien ya estaba bloqueado no es un error para la persona:
      // el resultado es el que quería. 23505 se traduce a ok.
      const codigo = typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (codigo === '23505') return sobreOk({ ok: true })
      throw codigoDesdeErrorDeRefugio(error)
    }

    return sobreOk({ ok: true }, 201)
  })
}
