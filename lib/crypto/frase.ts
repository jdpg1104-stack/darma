// ============================================================================
// B10 · Frase de recuperación de 12 palabras
//
// ── POR QUÉ 256 PALABRAS Y NO LAS 2 048 DE BIP-39 ──────────────────────────
// Con una lista de 256, cada palabra es EXACTAMENTE un byte. Doce palabras son
// doce bytes: 96 bits de entropía, mapeados sin módulo y por tanto sin sesgo, y
// la conversión frase↔bytes es una tabla de consulta que cabe en la cabeza de
// quien la revise. Con 2 048 harían falta 11 bits por palabra y un empaquetado
// a nivel de bit, que es exactamente el sitio donde se cuelan los errores.
//
// 96 bits detrás de PBKDF2-SHA256 con 600 000 iteraciones están fuera del
// alcance de cualquier fuerza bruta realista sobre un dump filtrado: aunque
// alguien probara mil millones de frases por segundo SIN pagar el coste del
// KDF, serían más de dos mil años. El KDF añade seis órdenes de magnitud más.
// El eslabón débil de este esquema no es la entropía: es que la persona apunte
// la frase en las notas del móvil, y eso se ataja en la pantalla (ver
// `components/refuge/DialogoFraseRecuperacion.tsx`), no aquí.
//
// ── REGLAS DE LA LISTA (verificadas por frase.test.ts) ─────────────────────
// · 256 palabras exactas, en español, sin tildes ni eñes: se dictan por
//   teléfono y se escriben en teclados de todo tipo. Una tilde perdida no puede
//   romper una recuperación.
// · Todas de 4 letras o más y con las CUATRO PRIMERAS LETRAS ÚNICAS, así que la
//   frase sigue siendo interpretable aunque quien la copió se comiera el final
//   de una palabra.
// · Nada con carga emocional negativa. Es una lista que alguien va a leer en un
//   momento malo.
//
// ⚠️ ESTA LISTA NO SE PUEDE CAMBIAR NUNCA MÁS. Reordenarla o sustituir una
// palabra invalida en silencio todas las frases ya escritas en un papel. Si
// hiciera falta otra lista, sería otra versión del formato de copia de
// seguridad, con su propio campo de versión, no una edición de este array.
// ============================================================================

/** 256 palabras. El índice ES el byte: PALABRAS[0x00] … PALABRAS[0xff]. */
export const PALABRAS: readonly string[] = [
  'abeja', 'abrigo', 'aceite', 'acero', 'adorno', 'agenda',
  'agua', 'aguja', 'alambre', 'aldea', 'alfombra', 'almeja',
  'altura', 'amapola', 'ambar', 'amigo', 'ancla', 'anillo',
  'antena', 'arbol', 'arcilla', 'arena', 'armario', 'arroz',
  'asiento', 'astilla', 'atlas', 'avena', 'avion', 'azafran',
  'azucar', 'azul', 'bahia', 'balcon', 'ballena', 'bambu',
  'banco', 'barco', 'barro', 'baston', 'batalla', 'bebida',
  'belleza', 'beso', 'bicho', 'blanco', 'bloque', 'bosque',
  'bota', 'boton', 'brazo', 'brisa', 'bronce', 'bruma',
  'buho', 'burbuja', 'buzon', 'caballo', 'cabina', 'cactus',
  'cadena', 'cafe', 'caja', 'calor', 'calle', 'camino',
  'campana', 'canela', 'cangrejo', 'canto', 'capa', 'caracol',
  'carbon', 'carne', 'carta', 'casa', 'cascada', 'castillo',
  'cebolla', 'cedro', 'cielo', 'ciervo', 'cima', 'cinta',
  'ciruela', 'cisne', 'ciudad', 'clavo', 'cobre', 'cocina',
  'codo', 'cofre', 'colina', 'collar', 'color', 'columna',
  'comida', 'concha', 'conejo', 'copa', 'coral', 'corcho',
  'cordel', 'corona', 'correa', 'cortina', 'cosecha', 'costa',
  'crema', 'cristal', 'cuadro', 'cuchara', 'cuerda', 'cueva',
  'cumbre', 'cuna', 'dado', 'dama', 'dedo', 'delfin',
  'desierto', 'dibujo', 'diente', 'disco', 'duna', 'dulce',
  'enigma', 'elefante', 'embudo', 'encina', 'escalera', 'escoba',
  'espejo', 'espiga', 'espuma', 'estrella', 'faro', 'fiesta',
  'figura', 'flauta', 'flecha', 'flor', 'fogata', 'fresa',
  'fruta', 'fuego', 'fuente', 'galleta', 'ganso', 'garza',
  'gaviota', 'gemelo', 'globo', 'gota', 'granate', 'grillo',
  'gruta', 'guante', 'guitarra', 'harina', 'helecho', 'hielo',
  'hierba', 'higuera', 'hilo', 'hoguera', 'hoja', 'hongo',
  'hormiga', 'horno', 'huerto', 'humo', 'iglesia', 'imagen',
  'imperio', 'invierno', 'isla', 'jabon', 'jarra', 'jardin',
  'jazmin', 'jirafa', 'joya', 'juego', 'junco', 'laberinto',
  'ladrillo', 'lago', 'lampara', 'lana', 'lanza', 'lapiz',
  'laurel', 'leche', 'lengua', 'lenteja', 'libro', 'lienzo',
  'lima', 'limon', 'linterna', 'lirio', 'llama', 'llave',
  'lluvia', 'lobo', 'loma', 'lucero', 'luna', 'lupa',
  'madera', 'maiz', 'maleta', 'manzana', 'mapa', 'marfil',
  'mariposa', 'martillo', 'mesa', 'metal', 'miel', 'mina',
  'molino', 'moneda', 'monte', 'mora', 'mosaico', 'muelle',
  'muralla', 'musgo', 'nabo', 'naranja', 'nave', 'neblina',
  'nido', 'nieve', 'nogal', 'nube', 'nudo', 'olivo',
  'olla', 'orilla', 'oruga', 'otono', 'paja', 'palma',
  'pantano', 'pared', 'parque', 'pasillo', 'pastel', 'patio',
  'pecera', 'pedal', 'peine', 'pelota',
]

export const PALABRAS_POR_FRASE = 12

/** Índice inverso, construido una vez. Sin él, cada validación serían doce
 *  recorridos lineales de la lista. */
const INDICE: ReadonlyMap<string, number> = new Map(PALABRAS.map((p, i) => [p, i]))

/**
 * Normaliza lo que la persona escribió: minúsculas, sin tildes, sin puntuación
 * y con los espacios colapsados.
 *
 * Deliberadamente generoso. Quien está recuperando su cuenta lo hace desde un
 * papel y a veces con prisa; rechazar «Abeja,» por la mayúscula y la coma sería
 * castigarla por un fallo que no cambia nada.
 */
export function normalizarFrase(entrada: string): string[] {
  return entrada
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Convierte 12 bytes en la frase. */
export function bytesAFrase(bytes: Uint8Array): string[] {
  if (bytes.length !== PALABRAS_POR_FRASE) {
    throw new Error('La frase de recuperación son 12 palabras.')
  }
  return [...bytes].map((b) => PALABRAS[b])
}

/**
 * Convierte la frase en los 12 bytes de los que salió.
 *
 * LANZA UN ÚNICO ERROR, SIN DECIR QUÉ PALABRA FALLA. Es a propósito y es la
 * prueba nº 6 de la ficha: un mensaje del tipo «la palabra 7 no existe»
 * convierte un problema de 2^96 en doce problemas independientes de 256
 * opciones cada uno, que se resuelven a mano.
 */
export function fraseABytes(palabras: readonly string[]): Uint8Array {
  const bytes = new Uint8Array(PALABRAS_POR_FRASE)
  let valida = palabras.length === PALABRAS_POR_FRASE

  for (let i = 0; i < PALABRAS_POR_FRASE; i++) {
    const indice = INDICE.get(palabras[i] ?? '')
    if (indice === undefined) {
      valida = false
      // Se recorre la frase entera aunque ya se sepa que es inválida: salir en
      // la primera palabra mala haría que el TIEMPO de respuesta dijera dónde
      // está el fallo, que es justo lo que el mensaje calla.
      continue
    }
    bytes[i] = indice
  }

  if (!valida) throw new Error('La frase de recuperación no es válida.')
  return bytes
}

/**
 * Genera una frase nueva. 12 bytes de `crypto.getRandomValues`, nunca de
 * `Math.random`, que es un PRNG predecible y no criptográfico.
 */
export function crearFraseRecuperacionSincrona(): string[] {
  const bytes = new Uint8Array(PALABRAS_POR_FRASE)
  crypto.getRandomValues(bytes)
  return bytesAFrase(bytes)
}

/** Misma cosa con la firma asíncrona que fija el contrato de la ficha. */
export async function crearFraseRecuperacion(): Promise<string[]> {
  return crearFraseRecuperacionSincrona()
}
