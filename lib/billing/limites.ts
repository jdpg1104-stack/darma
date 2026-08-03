// ============================================================================
// Límites de las rutas de /api/billing/*
//
// Están todos juntos porque un límite solo se entiende en relación con los
// demás, y calibrados sobre el uso HUMANO, no sobre lo que aguanta el servidor.
//
// `restore` es el más bajo con diferencia y no es una errata: es la única ruta
// que dispara N verificaciones contra la tienda por una sola petición nuestra.
// Sin freno, un bucle de restauración nos convierte en un cliente abusivo de la
// App Store Server API y Apple nos limita a NOSOTROS, con lo que deja de
// funcionar la verificación de todas las compras legítimas.
//
// Las cuatro rutas que mueven saldo pasan `failClosed: true` (ver la cabecera
// de lib/rateLimit.ts): en las rutas de dinero, ante la duda, no.
// ============================================================================

export interface Limite {
  limite: number
  ventanaSegundos: number
}

export const LIMITES_PETICION: Readonly<Record<'verify' | 'restore' | 'boost' | 'gift' | 'ledger' | 'catalog', Limite>> = {
  /** Verificar una compra. Una compra real son 1–2 llamadas. */
  verify: { limite: 20, ventanaSegundos: 3600 },
  /** Restaurar. N verificaciones contra la tienda por petición. */
  restore: { limite: 3, ventanaSegundos: 3600 },
  /** Impulsar. El techo real son 3/día en el trigger; esto es la red. */
  boost: { limite: 10, ventanaSegundos: 3600 },
  /** Regalar. Bajo: un regalo es un gesto, no una ráfaga. */
  gift: { limite: 20, ventanaSegundos: 3600 },
  /** Historial. Lectura, pero pagina: 60/h son 60 páginas. */
  ledger: { limite: 60, ventanaSegundos: 3600 },
  /** Catálogo. Estático; el límite solo evita el bucle tonto. */
  catalog: { limite: 60, ventanaSegundos: 3600 },
} as const

/** Máximo de páginas de historial. CONTRATOS §5: el límite duro es 50. */
export const LIMITE_PAGINA_MAX = 50
export const LIMITE_PAGINA_POR_DEFECTO = 20

/** `gifts.message`: `check (char_length(message) <= 140)`. Espejo del CHECK. */
export const MENSAJE_REGALO_MAX = 140

/**
 * Longitud máxima de una clave de idempotencia del cliente. No es un límite de
 * producto sino de coste: la clave entra en un índice único y aceptar cadenas
 * sin tope es aceptar que alguien engorde el índice a voluntad.
 */
export const IDEMPOTENCIA_MAX = 80
