'use server'

// ============================================================================
// Server Action de edición del perfil.
//
// Escribe EXACTAMENTE cuatro columnas: `alias`, `avatar_seed`, `bio`,
// `availability`. Son las del `grant update (...)` de 0001, y esa lista no es
// una elección de esta acción: es lo que Postgres deja escribir. Intentar
// cualquier otra por el cliente RLS no da error — simplemente no escribe, que
// es peor, porque parecería que ha funcionado. Por eso la validación es
// `.strict()` y una clave desconocida es un fallo ruidoso aquí arriba.
//
// `karma_reputation`, `crystals` y `level` no tienen ninguna vía:
//   · los dos primeros están fuera del `grant update`;
//   · `level` es una columna GENERADA y Postgres rechaza el UPDATE de plano.
// Hay un test que comprueba que el objeto de cambios que sale de esta acción no
// contiene ninguna de las tres claves, pase lo que pase en el formulario.
//
// ── CLIENTE RLS, NUNCA EL ADMIN ────────────────────────────────────────────
// `profiles_update_own` + el privilegio de columna hacen todo el trabajo. El
// `.eq('id', userId)` es redundante con la política y está justamente por eso:
// si algún día la política cambiara, esto seguiría escribiendo solo la fila
// propia.
// ============================================================================

import { revalidatePath } from 'next/cache'

import { obtenerTraductor, resolverLocale, traducirCodigoError, type Traductor } from '@/i18n'
import { createClient } from '@/lib/supabase/server'
import { requirePerfil } from '@/lib/auth/session'
import { esErrorApi } from '@/lib/auth/errores'
import { assertNoPii, PiiDetectedError } from '@/lib/anonymity'
import { limitarPerfil } from '@/components/perfil/limites'
import { esquemaEditarPerfil } from '@/components/perfil/validacion'
import { cambiosPerfilDesdeEntrada } from '@/components/perfil/proyecciones'
import type { EstadoEdicion } from '@/components/perfil/tipos'

// La traducción de "entrada validada" a "objeto del UPDATE" vive en
// `proyecciones.ts` y no aquí: en un módulo `'use server'` TODA exportación se
// publica como endpoint invocable desde el navegador, y una función de mapeo no
// tiene por qué serlo. Además así se puede probar sin el runtime de Next.

function fallo(mensaje: string, campo: EstadoEdicion['campo'] = null): EstadoEdicion {
  return { ok: false, mensaje, campo }
}

/**
 * Mensaje del primer problema de validación, EN EL IDIOMA DE LA PERSONA.
 *
 * Se resuelve por CAMPO y no leyendo `issue.message`: los mensajes de
 * `esquemaEditarPerfil` viven en `components/perfil/validacion.ts` en un solo
 * idioma y, además, describen reglas internas. El campo es lo único que hace
 * falta para elegir la frase, y es lo mismo que ya se usa para pintar el
 * `aria-invalid`.
 */
function claveDeProblema(campo: unknown, codigo: string | undefined): string {
  if (campo === 'alias') return 'perfil.edicion.errores.alias'
  if (campo === 'bio') return 'perfil.edicion.errores.bio'
  if (campo === 'avatarSeed') return 'perfil.edicion.errores.avatar'
  // `custom` sin campo es el `.refine()` de "no has cambiado nada". Lo demás
  // sin campo es una clave desconocida que `.strict()` rechazó.
  if (codigo === 'custom') return 'perfil.edicion.errores.sinCambios'
  return 'perfil.edicion.errores.generico'
}

export async function editarPerfil(
  _estadoPrevio: EstadoEdicion,
  datos: FormData,
): Promise<EstadoEdicion> {
  // Fuera del `try`: si esto fallara, el `catch` necesitaría el traductor que
  // aún no existe.
  const t: Traductor = obtenerTraductor(await resolverLocale())

  try {
    const sesion = await requirePerfil()

    const disponibilidad = datos.get('disponibilidad')

    // Dos límites, y el de disponibilidad es el que importa: pasar a
    // `necesito_hablar` es una SEÑAL SENSIBLE que otras personas leen como
    // "esta persona está mal ahora mismo". Alternarla en bucle sería una forma
    // barata de acaparar la atención de quien acude, que es el recurso más
    // escaso de Darma.
    await limitarPerfil('editarPerfil', sesion.userId)
    if (typeof disponibilidad === 'string' && disponibilidad.length > 0) {
      await limitarPerfil('disponibilidad', sesion.userId)
    }

    const bruto: Record<string, unknown> = {}
    for (const clave of ['alias', 'avatarSeed', 'bio', 'disponibilidad'] as const) {
      const valor = datos.get(clave)
      if (typeof valor === 'string') bruto[clave] = valor
    }

    const analizado = esquemaEditarPerfil.safeParse(bruto)
    if (!analizado.success) {
      // Se devuelve NUESTRO mensaje, no el árbol de zod: ese describe campos y
      // reglas internas, y es esquema gratis para quien sondea el formulario.
      const primero = analizado.error.issues[0]
      const campo = primero?.path[0]
      return fallo(
        t(claveDeProblema(campo, primero?.code)),
        campo === 'alias' || campo === 'bio' || campo === 'avatarSeed' ? campo : null,
      )
    }

    // La bio es el sitio evidente donde alguien pone su Instagram "para seguir
    // hablando por privado". Se comprueba EN EL SERVIDOR: el cliente puede
    // saltarse cualquier validación que viva solo en el navegador.
    if (analizado.data.bio) assertNoPii(analizado.data.bio)

    const cambios = cambiosPerfilDesdeEntrada(analizado.data)

    const supabase = await createClient()
    const { error } = await supabase.from('profiles').update(cambios).eq('id', sesion.userId)

    if (error) {
      // 23505 = unique_violation sobre `profiles.alias`. Para quien está
      // eligiendo su alias eso es "elige otro", no un 500 ni el texto crudo del
      // constraint (que además le contaría el nombre del índice).
      if (error.code === '23505') return fallo(t('perfil.edicion.errores.aliasEnUso'), 'alias')
      return fallo(t('perfil.edicion.errores.noGuardado'))
    }

    // Las dos pantallas que muestran estos datos.
    revalidatePath('/perfil')
    revalidatePath('/perfil/editar')

    return { ok: true, mensaje: t('perfil.edicion.guardado'), campo: null }
  } catch (causa) {
    if (causa instanceof PiiDetectedError) return fallo(t('perfil.edicion.errores.pii'), 'bio')
    // Por CÓDIGO, no por `causa.message`: el mensaje de `ErrorApi` está escrito
    // en un solo idioma (ver la cabecera de lib/auth/errores.ts).
    if (esErrorApi(causa)) {
      return fallo(
        traducirCodigoError(
          causa.code,
          t,
          causa.retryAfter !== undefined ? { retryAfter: causa.retryAfter } : {},
        ),
      )
    }

    // Nada inesperado llega al cliente con detalle. `console.error` está
    // permitido por el eslint del repo justamente para esto.
    console.error('[darma][b05] fallo al editar el perfil', causa)
    return fallo(t('perfil.edicion.errores.interno'))
  }
}
