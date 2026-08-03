// ============================================================================
// Política de retención — mapa tipado tabla → plazo → base legal.
//
// ── POR QUÉ ESTO ES CÓDIGO Y NO UN PÁRRAFO EN UNA PÁGINA ───────────────────
// Una política de retención escrita solo en prosa envejece en silencio: alguien
// añade una tabla con datos personales, nadie actualiza el documento, y el día
// que llega una petición de acceso la respuesta oficial de la empresa es falsa
// sin que nadie lo haya decidido. Aquí la política es un array tipado, la
// página `/legal/retencion` se RENDERIZA desde él, y una prueba compara la
// lista de tablas cubiertas contra una lista literal del esquema: si alguien
// crea una tabla con datos personales y no la clasifica, el test falla antes de
// que el documento mienta.
//
// `purgar_retencion()` (migración 0201) es el brazo ejecutor de las entradas
// con plazo finito y automatizable. Las que no se pueden purgar en automático
// lo dicen en `justificacion`, con su motivo.
// ============================================================================

export interface ReglaRetencion {
  /** Nombre exacto de la tabla en Postgres. */
  tabla: string
  /** '5 años', 'vida de la cuenta', 'indefinido'… en lenguaje humano. */
  plazo: string
  baseLegal: string
  /** Una frase. Por qué ese plazo y no otro. */
  justificacion: string
  /** ¿La borra `purgar_retencion()` por lotes, o requiere intervención? */
  purgaAutomatica: boolean
}

export const POLITICA_RETENCION: readonly ReglaRetencion[] = [
  {
    tabla: 'identity_vault',
    plazo: 'vida de la cuenta',
    baseLegal: 'Art. 6.1.b RGPD — ejecución del contrato (una cuenta por persona)',
    justificacion:
      'Es la única fila que vincula un seudónimo con una persona real, así que es la primera que se destruye al borrar la cuenta y no sobrevive ni un minuto a ella.',
    purgaAutomatica: false,
  },
  {
    tabla: 'profiles',
    plazo: 'vida de la cuenta, y después anonimizado indefinidamente',
    baseLegal: 'Art. 6.1.b RGPD + art. 17.3.e (derechos de terceros)',
    justificacion:
      'La fila no se elimina al borrar la cuenta: se anonimiza en el sitio, porque de ella cuelgan los comentarios con los que esa persona acompañó a otras y borrarla los destruiría.',
    purgaAutomatica: false,
  },
  {
    tabla: 'posts',
    plazo: 'vida de la cuenta',
    baseLegal: 'Art. 6.1.b RGPD',
    justificacion:
      'Al borrar la cuenta el cuerpo se sustituye por un texto lápida y la fila se conserva vacía de contenido, para que los comentarios que otras personas dejaron en ese hilo no queden colgando.',
    purgaAutomatica: false,
  },
  {
    tabla: 'comments',
    plazo: 'indefinido, seudonimizado tras el borrado',
    baseLegal: 'Art. 17.3.e RGPD — derechos de terceros',
    justificacion:
      'El comentario que escribiste es a la vez el apoyo que otra persona recibió en su peor día: se conserva, atribuido a un perfil ya anonimizado.',
    purgaAutomatica: false,
  },
  {
    tabla: 'karma_events',
    plazo: 'indefinido, seudonimizado',
    baseLegal: 'Art. 6.1.f RGPD — interés legítimo (integridad de la economía)',
    justificacion:
      'Es el libro mayor de la reputación y la única fuente de verdad: las columnas de karma de profiles son solo su caché, y sin el ledger no se pueden reconstruir ni auditar.',
    purgaAutomatica: false,
  },
  {
    tabla: 'crystal_ledger',
    plazo: '6 años',
    baseLegal: 'Art. 30 Código de Comercio y art. 66 Ley General Tributaria',
    justificacion:
      'Registro contable de compras reales: la obligación mercantil de conservarlo vence al derecho de supresión (art. 17.3.b). No lo purga el cron porque un trigger lo hace append-only a propósito; retirarlo a los 6 años es una operación manual y deliberada.',
    purgaAutomatica: false,
  },
  {
    tabla: 'crisis_events',
    plazo: '5 años',
    baseLegal: 'Art. 17.3.e RGPD — formulación y defensa de reclamaciones',
    justificacion:
      'Es la tabla que responde ante un regulador o ante una familia a la pregunta «¿qué hizo el sistema cuando esta persona dijo eso?», y ese plazo es el de prescripción de las acciones personales.',
    purgaAutomatica: true,
  },
  {
    tabla: 'moderation_flags',
    plazo: '2 años',
    baseLegal: 'Art. 6.1.f RGPD — interés legítimo (seguridad de la comunidad)',
    justificacion:
      'La reincidencia solo se puede medir con histórico; más allá de dos años una señal antigua dice más del pasado que del riesgo actual. Solo se purgan las ya resueltas o descartadas.',
    purgaAutomatica: true,
  },
  {
    tabla: 'refuge_messages',
    plazo: '2 años',
    baseLegal: 'Art. 5.1.e RGPD — limitación del plazo de conservación',
    justificacion:
      'El servidor guarda ciphertext que no puede leer; conservarlo más tiempo no aporta nada a nadie y sí aumenta lo que se pierde en una filtración.',
    purgaAutomatica: true,
  },
  {
    tabla: 'content_views',
    plazo: '90 días',
    baseLegal: 'Art. 5.1.c RGPD — minimización',
    justificacion:
      'Solo sirve para no repetirte un vídeo que ya viste; un historial de reproducción de años es un perfil de comportamiento que no necesitamos tener.',
    purgaAutomatica: true,
  },
  {
    tabla: 'content_sessions',
    plazo: '90 días',
    baseLegal: 'Art. 5.1.c RGPD — minimización',
    justificacion:
      'Latidos de reproducción para acreditar el tiempo real visto: cumplida su función antifraude, no hay razón para conservarlos.',
    purgaAutomatica: false,
  },
  {
    tabla: 'rate_limits',
    plazo: '1 día',
    baseLegal: 'Art. 6.1.f RGPD — interés legítimo (prevención del abuso)',
    justificacion:
      'Un contador por ventana que se puede truncar entero sin perder nada: solo abriría la ventana a todo el mundo durante un intervalo.',
    purgaAutomatica: true,
  },
  {
    tabla: 'consents',
    plazo: 'vida de la cuenta + 5 años',
    baseLegal: 'Art. 7.1 RGPD — deber de poder demostrar el consentimiento',
    justificacion:
      'Si no se conserva la huella del texto que se aceptó y cuándo, no se puede demostrar que hubo consentimiento; conservarlo es el propio cumplimiento del artículo que lo exige.',
    purgaAutomatica: false,
  },
  {
    tabla: 'privacy_requests',
    plazo: '3 años',
    baseLegal: 'Art. 5.2 y 12 RGPD — responsabilidad proactiva',
    justificacion:
      'Es la prueba de que una solicitud de acceso o de supresión se atendió dentro del plazo del art. 12.3; sin ella, «lo hicimos» no es demostrable.',
    purgaAutomatica: false,
  },
  {
    tabla: 'retired_aliases',
    plazo: 'indefinido',
    baseLegal: 'Art. 6.1.f RGPD — interés legítimo (integridad de la comunidad)',
    justificacion:
      'Un alias liberado por un borrado no se puede reclamar nunca: si alguien lo registrara, heredaría ante la comunidad una historia de hilos que no es suya. Un alias no es un dato personal una vez vaciada la bóveda de identidad.',
    purgaAutomatica: false,
  },
  {
    tabla: 'auth_totp',
    plazo: 'vida de la cuenta',
    baseLegal: 'Art. 32 RGPD — seguridad del tratamiento',
    justificacion: 'Secreto del segundo factor: se destruye con la cuenta, en la misma transacción.',
    purgaAutomatica: false,
  },
  {
    tabla: 'refuge_members',
    plazo: 'vida del refugio',
    baseLegal: 'Art. 17.3.e RGPD — derechos de terceros',
    justificacion:
      'Salir de un refugio marca `left_at`, no borra la fila: eliminarla reescribiría el hilo de quien se queda.',
    purgaAutomatica: false,
  },
  {
    tabla: 'kindred',
    plazo: 'vida de la cuenta',
    baseLegal: 'Art. 6.1.b RGPD',
    justificacion:
      'Libreta privada de almas afines con notas escritas por su dueña sobre otras personas: se elimina entera al borrar la cuenta, no sostiene nada de nadie.',
    purgaAutomatica: false,
  },
  {
    tabla: 'blocks',
    plazo: 'indefinido',
    baseLegal: 'Art. 6.1.f RGPD — interés legítimo (seguridad personal)',
    justificacion:
      'El bloqueo protege a quien lo puso; al borrar una cuenta se vacía el motivo escrito a mano pero la fila se conserva, porque quitarla reabriría un canal que alguien cerró a propósito.',
    purgaAutomatica: false,
  },
  {
    tabla: 'post_votes',
    plazo: 'vida de la cuenta',
    baseLegal: 'Art. 6.1.b RGPD',
    justificacion:
      'Un voto seudónimo que solo alimenta un contador agregado; se conserva tras el borrado unido al perfil ya anonimizado para no descuadrar el contador de un post ajeno.',
    purgaAutomatica: false,
  },
  {
    tabla: 'poll_votes',
    plazo: 'vida de la cuenta',
    baseLegal: 'Art. 6.1.b RGPD',
    justificacion:
      'Igual que los votos de post: retirarlo cambiaría el resultado de una encuesta de otra persona, y el voto ya es anónimo incluso para quien la creó.',
    purgaAutomatica: false,
  },
  {
    tabla: 'gifts',
    plazo: '6 años',
    baseLegal: 'Art. 30 Código de Comercio',
    justificacion:
      'Movimiento con contrapartida económica en cristales; el mensaje escrito a mano sí se vacía al borrar la cuenta, los importes no.',
    purgaAutomatica: false,
  },
  {
    tabla: 'boosts',
    plazo: '6 años',
    baseLegal: 'Art. 30 Código de Comercio',
    justificacion: 'Registro de una compra de visibilidad: mismo plazo mercantil que el resto de la economía.',
    purgaAutomatica: false,
  },
]

/** Índice por tabla, para la página y para las pruebas. */
export function reglaDeTabla(tabla: string): ReglaRetencion | undefined {
  return POLITICA_RETENCION.find((r) => r.tabla === tabla)
}

/** Las que `purgar_retencion()` barre por lotes desde un cron. */
export function tablasConPurgaAutomatica(): readonly string[] {
  return POLITICA_RETENCION.filter((r) => r.purgaAutomatica).map((r) => r.tabla)
}
