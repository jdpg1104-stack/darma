// ============================================================================
// B11 · La tarjeta de recursos de ayuda
//
// ── DE DÓNDE SALEN LOS NÚMEROS ─────────────────────────────────────────────
// De `i18n/recursosCrisis.ts` (dueño: B17). De ningún otro sitio. Este bloque
// NO escribe ni un teléfono en su propio código: si mañana el 024 cambia, se
// cambia en un archivo con su fuente oficial y su campo `verificadoPor`, no en
// once sitios repartidos por la app.
//
// ── EL AVISO VIVO DEL PROYECTO ─────────────────────────────────────────────
// `tablaListaParaProduccion()` devuelve HOY `false`: los 24 recursos siguen
// SIN verificar por una persona contra su fuente oficial. Este bloque no puede
// dar por buenos esos números, así que:
//   · Se siguen mostrando. Una pantalla de crisis en blanco es un callejón sin
//     salida, y un número probablemente correcto es mejor que ninguno.
//   · El mensaje de la tarjeta lo DICE. No se presenta como verificado lo que
//     nadie ha verificado.
//   · Se registra en `crisis_events.resources_shown` exactamente qué se mostró,
//     con la marca de sin verificar. Esa columna existe para poder responder
//     algún día ante un regulador o ante una familia.
//
// ── EL PAÍS ────────────────────────────────────────────────────────────────
// Sale de `identity_vault.country_code`, leído con el cliente ADMIN en el
// servidor. NUNCA viaja al cliente ni sale en una respuesta de API como campo
// suelto: solo aparece incorporado en la tarjeta. Se indexa por PAÍS y jamás
// por idioma — un hispanohablante en Estados Unidos necesita el 988, no el 024.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  recursosParaPais,
  tablaListaParaProduccion,
  type RecursoCrisis,
} from '../../i18n/recursosCrisis.ts'
import { crisisMessage } from '../crisis.ts'
import type { NivelRiesgo } from './esquemas.ts'

/** Forma pública de un recurso (CONTRATOS / ficha B11). */
export interface RecursoAyuda {
  nombre: string
  telefono?: string
  url?: string
  horario?: string
}

export interface TarjetaAyuda {
  titulo: string
  mensaje: string
  recursos: RecursoAyuda[]
}

/**
 * Aviso que se AÑADE al mensaje mientras la tabla no esté verificada.
 *
 * Está escrito para no asustar: la persona que lo lee puede estar en el peor
 * momento de su vida y no necesita una disculpa legal, necesita saber que si
 * un número no responde hay otro.
 */
export const AVISO_SIN_VERIFICAR =
  'Si alguno de estos números no responde, prueba con el siguiente o con el de emergencias de tu país.'

/** ¿Están los recursos verificados por una persona? Hoy: no. */
export function recursosVerificados(): boolean {
  return tablaListaParaProduccion()
}

/** Convierte un recurso de B17 a la forma pública. PURA. */
export function aRecursoAyuda(recurso: RecursoCrisis): RecursoAyuda {
  const esEnlace = recurso.tipo === 'web' || recurso.tipo === 'chat'
  const salida: RecursoAyuda = { nombre: recurso.nombre, horario: recurso.horario }
  if (esEnlace) salida.url = recurso.valor
  else salida.telefono = recurso.valor
  return salida
}

/**
 * Construye la tarjeta. PURA: sin red, sin reloj, sin `await`.
 *
 * CONTRATOS §9 — la crisis gana siempre y no espera a nadie: la tarjeta se
 * puede devolver en la MISMA respuesta que la publicación, sin un viaje extra.
 */
export function construirTarjeta(nivel: NivelRiesgo, pais: string | null): TarjetaAyuda {
  const entrada = recursosParaPais(pais)
  const base = crisisMessage(nivel as 'none' | 'low' | 'high' | 'critical')
  const mensaje = recursosVerificados() ? base : `${base} ${AVISO_SIN_VERIFICAR}`

  return {
    titulo: nivel === 'critical' ? 'Estamos contigo ahora mismo' : 'Aquí tienes a quien llamar',
    mensaje,
    recursos: entrada.recursos.map(aRecursoAyuda),
  }
}

/**
 * Qué se guarda en `crisis_events.resources_shown`.
 *
 * Identificadores estables (`PAIS·nombre`), no el texto de la tarjeta: se
 * puede agregar por SQL y no crece con el idioma. Si la tabla no está
 * verificada, la primera entrada lo dice — esa marca es la que permitirá
 * distinguir, dentro de un año, lo que se mostró antes y después de la
 * revisión humana.
 */
export function recursosMostrados(tarjeta: TarjetaAyuda, pais: string | null): string[] {
  const clave = recursosParaPais(pais).pais
  const ids = tarjeta.recursos.map((r) => `${clave}·${r.nombre}`)
  return recursosVerificados() ? ids : ['SIN_VERIFICACION_HUMANA', ...ids]
}

export interface DepsPais {
  /** Cliente ADMIN: `identity_vault` no tiene NINGUNA política RLS. */
  admin?: SupabaseClient
  /** País ya resuelto (cabecera de borde, cookie). Evita el viaje a la base. */
  paisConocido?: string | null
}

/**
 * País de una persona. NUNCA lanza y NUNCA devuelve el país a un llamante que
 * no vaya a incrustarlo en la tarjeta.
 *
 * Se lee con el cliente admin porque `identity_vault` es la tabla que guarda
 * el único vínculo con la persona real; su ausencia de políticas RLS es
 * deliberada. Si la lectura falla, `null` → recursos internacionales, que
 * nunca están vacíos.
 */
export async function resolverPaisDeUsuario(
  userId: string,
  deps: DepsPais = {},
): Promise<string | null> {
  if (deps.paisConocido !== undefined) return deps.paisConocido
  if (!deps.admin) return null
  try {
    const { data, error } = await deps.admin
      .from('identity_vault')
      .select('country_code')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return null
    const fila = data as { country_code?: string | null }
    return fila.country_code ?? null
  } catch {
    return null
  }
}
