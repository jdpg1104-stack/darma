// ============================================================================
// Textos sintéticos de la suite E2E.
//
// ⚠️ NINGUNA de estas frases es de una persona real. Son fixtures escritos para
// disparar un clasificador, y viven aquí —en un solo archivo, con este aviso—
// porque acaban grabados en las trazas y los vídeos que Playwright guarda como
// artefactos cuando un test falla. Un texto de crisis copiado de un post real
// convertiría un artefacto de CI en una filtración.
//
// Los patrones que hacen escalar el riesgo los define `lib/crisis.ts`; aquí no
// se duplica ninguna lista, solo se compone una frase que los contiene.
// ============================================================================

/**
 * Texto de riesgo ALTO. Fixture sintético: contiene señales explícitas de
 * ideación suicida para que `evaluarRiesgo()` devuelva `high`/`critical` y la
 * app tenga que enseñar la tarjeta de recursos EN LA MISMA RESPUESTA
 * (CONTRATOS §9.1).
 */
export const TEXTO_CRISIS =
  'Esta noche quiero acabar con todo, ya no aguanto más ni un día. ' +
  'Llevo semanas pensando en suicidarme y no sé a quién contárselo.'

/**
 * Texto de riesgo ALTO sin señal `critical`. Útil para comprobar que la tarjeta
 * también sale en `high`, que es donde empieza `requiresIntervention()`.
 */
export const TEXTO_CRISIS_ALTA =
  'Llevo semanas pensando en suicidarme y no sé a quién contárselo. ' +
  'No quiero preocupar a nadie pero necesito soltarlo en algún sitio.'

/**
 * Texto de riesgo BAJO. NO debe producir tarjeta de recursos: si la produce, la
 * app está escalando de más y el ruido acabaría haciendo que la tarjeta se
 * ignore justo el día que importa.
 */
export const TEXTO_RIESGO_BAJO =
  'No puedo más con esto, estoy completamente solo desde hace meses y ' +
  'me cuesta encontrarle sentido a los días entre semana.'

/** Texto neutro y suficientemente largo para pasar la validación de longitud. */
export const TEXTO_NEUTRO =
  'Hoy ha sido un día raro en el trabajo y me vendría bien contarlo en voz alta ' +
  'para ordenarlo un poco. Nada grave, solo cansancio acumulado de la semana.'

/** Texto que la persona escribe cuando se le rechaza la publicación. */
export const TEXTO_QUE_NO_SE_DEBE_PERDER =
  'Llevo días durmiendo mal y quería escribirlo aquí antes de que se me olvide ' +
  'cómo me siento exactamente ahora mismo.'

/**
 * Comentario de apoyo. Largo y concreto a propósito: `lib/moderation.ts`
 * rechaza el relleno tipo «ánimo!» antes incluso de llegar al clasificador.
 */
export function comentarioDeApoyo(n: number): string {
  return (
    `Te leo y te acompaño. Lo que cuentas tiene todo el sentido del mundo y no ` +
    `estás exagerando nada. A mí me ayudó mucho poner por escrito lo que sentía ` +
    `antes de dormir; quizá a ti también te sirva. Aquí estoy si quieres seguir ` +
    `contando (${n}).`
  )
}

/** Cuerpo de un post sembrado por el fixture, para que alguien lo escuche. */
export function postSembrado(n: number): string {
  return (
    `Hoy me está costando más de lo normal levantarme y hacer las cosas de ` +
    `siempre. No sé si es una racha o algo más de fondo, pero quería dejarlo ` +
    `escrito en algún sitio donde alguien lo lea (${n}).`
  )
}
