// ============================================================================
// El validador de calidad — el punto de extensión de B11
//
// `ValidadorComentario` (ver `tipos.ts`) es la costura. Hoy la implementa la
// heurística pura de `lib/moderation.ts`; cuando B11 cierre, su clasificador se
// enchufa sustituyendo `validadorPorDefecto` y NINGUNA ruta cambia. Anotado en
// HANDOFF/PEDIDOS.md.
//
// ── POR QUÉ LA HEURÍSTICA SE QUEDA AUNQUE LLEGUE EL MODELO ─────────────────
// No como alternativa, como SUELO. Un clasificador remoto tiene latencia, cuota
// y días raros; la validación de un comentario decide si alguien cobra su
// escucha, y eso no puede depender de que un proveedor esté de pie. La
// composición correcta cuando llegue B11 es: heurística primero (gratis, filtra
// el grueso del relleno), modelo solo sobre lo dudoso.
//
// ── ORIENTACIÓN DEL ERROR ──────────────────────────────────────────────────
// Al revés que la crisis: aquí un falso positivo SÍ duele. Negarle la
// validación a alguien que escribió algo sincero pero torpe es exactamente la
// experiencia que hace que esa persona no vuelva. Por eso el motivo que se
// devuelve está escrito para que se pueda arreglar el mensaje, no para dar un
// veredicto.
// ============================================================================

import { validateComment, moderationMessage } from '@/lib/moderation'
import type {
  ContextoValidacion,
  ValidadorComentario,
  VeredictoValidacion,
} from './tipos.ts'

/**
 * Implementación por defecto. Determinista y sin I/O, así que el camino de
 * comentar no añade ni un salto de red por validar.
 */
export class ValidadorHeuristico implements ValidadorComentario {
  async validar(texto: string, contexto: ContextoValidacion = {}): Promise<VeredictoValidacion> {
    const resultado = validateComment({
      body: texto,
      postBody: contexto.postBody,
      previousByAuthor: contexto.previosDelAutor,
    })

    return {
      valido: resultado.valid,
      score: resultado.score,
      // El `reason` interno ('filler_only', 'echoes_post') no sale nunca: se
      // traduce a una frase que propone cómo mejorar. Publicar el id de la
      // señal es publicar el manual para esquivarla.
      motivo: resultado.valid ? null : moderationMessage(resultado.reason),
    }
  }
}

/** El validador que usan las rutas. Sustitúyelo aquí cuando llegue B11. */
export const validadorPorDefecto: ValidadorComentario = new ValidadorHeuristico()
