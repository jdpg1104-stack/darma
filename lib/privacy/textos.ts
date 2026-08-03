// ============================================================================
// SSOT de los textos legales — y el mecanismo que impide que mientan.
//
// ── EL MECANISMO, QUE ES TODO EL ARCHIVO ───────────────────────────────────
// Cada documento lleva una `version` y el `sha256` de su propio cuerpo. Al
// aceptar, se guarda en `consents` la versión Y esa huella, así que «esta
// persona aceptó los términos» deja de ser una afirmación sobre un texto que
// pudo cambiar después y pasa a ser una afirmación sobre un texto concreto,
// comprobable byte a byte.
//
// `textos.test.ts` recalcula el sha256 de cada cuerpo y lo compara con el
// declarado: **si alguien edita una coma sin subir la versión, la prueba
// falla**. Sin eso, el consentimiento versionado es decorado.
//
// Procedimiento para cambiar un texto legal:
//   1. Edita el `cuerpo`.
//   2. Sube `version` (`v1-2026-08` → `v2-2026-11`) y `actualizadoEn`.
//   3. Ejecuta la prueba: te dirá el sha256 nuevo. Pégalo.
//   4. A partir de ahí, `cubreVersionActual()` devuelve false para quien
//      aceptó la anterior, y la app le vuelve a pedir el consentimiento.
// Saltarse el paso 2 es exactamente lo que la prueba existe para impedir.
//
// ── POR QUÉ EL CUERPO ES TEXTO PLANO ───────────────────────────────────────
// Se renderiza con `white-space: pre-wrap`, NUNCA con `dangerouslySetInnerHTML`
// (hay una prueba que lo comprueba con un grep sobre las páginas). Un documento
// legal que inyecta HTML es XSS con traje: el sitio donde menos se revisa el
// marcado es justo el que la gente lee antes de registrarse.
// ============================================================================

import { AVISO_NO_TERAPIA_LARGO } from './avisos.ts'
import { POLITICA_RETENCION } from './retencion.ts'

export type TipoDocumentoLegal =
  | 'terminos'
  | 'privacidad'
  | 'cookies'
  | 'no_es_terapia'
  | 'menores'
  | 'retencion'

export interface DocumentoLegal {
  tipo: TipoDocumentoLegal
  /** `v1-2026-08`. Se guarda en `consents.version`. */
  version: string
  /** ISO-8601 (fecha). Se muestra como «Última actualización». */
  actualizadoEn: string
  titulo: string
  /** Texto plano. NUNCA se renderiza como HTML. */
  cuerpo: string
  /** sha256 hex del `cuerpo`. Verificado por prueba. */
  sha256: string
}

export const TERMINOS_VERSION = 'v1-2026-08'
export const PRIVACIDAD_VERSION = 'v1-2026-08'
export const COOKIES_VERSION = 'v1-2026-08'
export const NO_ES_TERAPIA_VERSION = 'v1-2026-08'
export const MENORES_VERSION = 'v1-2026-08'
export const RETENCION_VERSION = 'v1-2026-08'

const ACTUALIZADO = '2026-08-03'

// ── El cuerpo de /legal/retencion se GENERA desde POLITICA_RETENCION ────────
// Así el documento no puede desviarse de la política que el código aplica de
// verdad: añadir una tabla al array cambia el texto, cambia su sha256 y rompe
// la prueba hasta que alguien suba la versión. Un documento de retención
// escrito a mano se desincroniza el primer día y nadie se entera.
function cuerpoRetencion(): string {
  const entradas = POLITICA_RETENCION.map(
    (r) =>
      `${r.tabla}\n` +
      `  Plazo: ${r.plazo}\n` +
      `  Base legal: ${r.baseLegal}\n` +
      `  Por qué: ${r.justificacion}\n` +
      `  Borrado automático por lotes: ${r.purgaAutomatica ? 'sí' : 'no'}`,
  ).join('\n\n')

  return `Cuánto tiempo guardamos cada cosa, y por qué.

Esta página no es un resumen de la política: se genera a partir de la política
que el código aplica. Si una tabla aparece aquí con un plazo, ese plazo es el
que se ejecuta; y si alguien añadiera una tabla con datos personales sin
clasificarla, una prueba automática lo impediría antes de llegar a producción.

El barrido lo hace una función de la base de datos que borra por lotes
acotados. Nunca un borrado masivo sin límite: bloquearía la tabla y tumbaría la
aplicación justo cuando alguien la necesita.

${entradas}

Dos plazos merecen explicación aparte.

El registro contable de compras se conserva seis años aunque pidas el borrado.
No es una excepción que nos inventemos: el derecho de supresión cede ante una
obligación legal de conservación (art. 17.3.b RGPD), y llevar los libros seis
años es una de ellas. Lo que sí desaparece es el vínculo con tu identidad real.

El registro de crisis se conserva cinco años. Es la tabla que permite responder
—a ti, a una familia o a un regulador— qué hizo el sistema cuando alguien
escribió que quería morirse. Borrarla al mes nos dejaría sin capacidad de
rendir cuentas justo en lo único donde rendir cuentas es obligatorio.`
}

const CUERPO_TERMINOS = `Estas condiciones explican qué es Darma, qué puedes esperar de nosotros y qué
esperamos de ti. Están escritas para leerse, no para firmarse sin leer.

1. QUÉ ES DARMA

Darma es una red de apoyo emocional entre iguales, anónima. No hay fotos, no hay
nombres reales, no hay números de teléfono. Cada persona tiene un seudónimo y un
avatar generado, y esa es toda su identidad pública.

Darma no es un servicio sanitario ni un servicio de emergencias. Esto tiene su
propia página, /legal/no-es-terapia, y conviene leerla.

2. QUIÉN PUEDE ABRIR UNA CUENTA

Hay que tener 16 años cumplidos. La razón, y qué pasa entre los 16 y los 18,
está en /legal/menores.

Una persona, una cuenta. Para poder sostener esa regla sin saber quién eres,
guardamos una huella criptográfica irreversible de tu contacto en una tabla
aislada; nunca el contacto en sí.

3. RECIPROCIDAD: CÓMO SE GANA EL DERECHO A PUBLICAR

Escuchar a tres personas desbloquea una publicación. La primera es gratis,
porque exigir escuchar antes de haber visto nunca la aplicación significaría que
nadie llega a hablar.

Solo cuenta la escucha de calidad: un comentario de dos palabras no acredita.
Esta regla no vive en la interfaz, vive en la base de datos, así que se aplica
igual venga de donde venga la petición.

4. KARMA Y CRISTALES

El karma se gana acompañando y tiene un tope diario. Los cristales se compran.

La línea roja del producto: el dinero nunca compra karma, ni prioridad de
escucha, ni salta la cola de atención en una crisis. Si algún día lo hiciera,
Darma habría dejado de ser esto.

5. QUÉ NO SE PUEDE HACER AQUÍ

· Publicar datos de contacto, tuyos o de otra persona. La aplicación los detecta
  y bloquea el envío. No es paternalismo: el anonimato de todos depende de que
  nadie lo rompa por su cuenta.
· Contenido que promueva la autolesión, el suicidio o los trastornos
  alimentarios. Hablar de lo que te pasa está bien y es el motivo de existir de
  Darma; animar a otra persona a hacerse daño, no.
· Acoso, amenazas, y usar la aplicación para alcanzar a alguien que te bloqueó.
· Suplantar a otra persona o reclamar el seudónimo de alguien que se fue.
· Automatizar cuentas, farmear karma o manipular el feed.

6. MODERACIÓN

Podemos ocultar contenido, limitar una cuenta o cerrarla. Usamos también el
shadow-ban: la cuenta sigue funcionando con normalidad pero su contenido no
entra en el feed de nadie. Es deliberado, y no se comunica: contra el acoso
funciona mucho mejor que una expulsión, que solo provoca otra cuenta nueva.

Si crees que nos hemos equivocado contigo, puedes escribirnos y lo revisa una
persona.

7. TU CONTENIDO

Lo que escribes es tuyo. Nos das permiso para mostrarlo dentro de Darma, y para
nada más: no lo vendemos, no lo cedemos a terceros y no entrenamos modelos
comerciales con ello.

Cuando borras tu cuenta, lo que escribiste sobre ti se elimina y lo que
escribiste para acompañar a otras personas se conserva sin autor identificable.
Esto está explicado entero, y con sus motivos, en /legal/privacidad. Merece la
pena leerlo ANTES de pulsar el botón.

8. DISPONIBILIDAD

Hacemos lo posible por que Darma esté siempre en pie, pero no podemos
garantizar que no haya cortes. Si estás en peligro, no dependas de esta
aplicación: llama al 112, o al 024 si estás en España.

9. CAMBIOS

Si cambiamos estas condiciones, sube el número de versión y te lo volvemos a
pedir. La versión que aceptaste queda registrada junto a la huella del texto
exacto que tenías delante, para que «aceptaste los términos» signifique algo.

10. LEY APLICABLE

Se aplica la legislación española y el Reglamento General de Protección de
Datos. Si eres consumidor, esto no te quita ningún derecho que la ley te dé.`

const CUERPO_PRIVACIDAD = `Darma guarda lo más íntimo que una persona escribe. Esta página cuenta qué
hacemos con ello, sin rodeos.

1. EL PRINCIPIO

No protegemos tu identidad ocultándola en la interfaz. La protegemos no
teniéndola donde la aplicación pueda leerla.

Tu perfil público no contiene correo, teléfono ni nombre real: no hay ni una
columna donde meterlos. El único punto del sistema donde existe el vínculo con
la persona real es una tabla aislada a la que la aplicación no tiene acceso: ni
un fallo en una ruta, ni una consulta mal escrita, ni un permiso olvidado pueden
sacarla de ahí.

2. QUÉ GUARDAMOS

· Tu seudónimo, la semilla de tu avatar y tu biografía, si escribes una.
· Lo que publicas y comentas.
· Tu karma, tus créditos de escucha y tus cristales.
· Una huella criptográfica irreversible de tu correo o teléfono, en la tabla
  aislada. Sirve para una sola cosa: que una persona no tenga diez cuentas.
· Los consentimientos que has dado, con su versión y la huella del texto.

Qué NO guardamos: tu dirección IP asociada a lo que escribes, tu user-agent, tu
ubicación, tu fecha de nacimiento, ni ninguna foto o grabación de voz. La cámara
y el micrófono están denegados a nivel de navegador por la propia aplicación:
cara y voz son identificadores biométricos, y su sola posibilidad cambiaría lo
que la gente se atreve a contar.

3. LA HUELLA DE TU CONTACTO NO SE PUEDE DESHACER

La huella se calcula con una clave secreta que vive solo en el entorno del
servidor y que no se guarda junto a la huella. Esto significa dos cosas:

· No podemos recuperar tu correo a partir de ella. Nadie puede.
· Cuando borras tu cuenta, esa fila se elimina de forma definitiva y no queda
  absolutamente nada de lo que partir, ni siquiera teniendo la clave secreta.
  A partir de ese momento tu seudónimo es un nombre sin persona detrás.

4. TU DERECHO A LLEVARTE TUS DATOS

Puedes descargar todo lo tuyo desde tu perfil. Es un archivo JSON estructurado
—no un volcado de tablas— con tu perfil, tu karma y su histórico, tus
publicaciones, tus comentarios, el apoyo que recibiste, el contenido que viste,
tus cristales, tus consentimientos y tus solicitudes anteriores.

Tres cosas no van en la exportación, y las tres tienen motivo:

· La huella de tu contacto. No te sirve de nada —no es un dato, es un hash— y
  exportarla debilitaría la detección de multicuenta para todo el mundo.
· El seudónimo de las demás personas que aparecen en tus hilos. Su seudónimo es
  su dato, no el tuyo.
· Quién escribió los comentarios que recibiste. El texto sí está, porque va
  dirigido a ti y forma parte de tu historia; el autor no, porque ese comentario
  es dato personal DE ESA OTRA PERSONA.

El enlace de descarga caduca a las 24 horas, sirve una sola vez y solo funciona
con tu sesión iniciada. Un enlace de exportación filtrado sería el volcado
completo de la vida emocional de alguien, así que lo tratamos como tal. Puedes
pedir una exportación cada 24 horas.

5. TU DERECHO A DESAPARECER, Y QUÉ SOBREVIVE

Esta es la parte que casi nadie espera y que tienes derecho a saber ANTES de
pulsar el botón.

Cómo funciona el proceso:

· Pides el borrado y te llega un segundo paso de confirmación con un enlace de
  un solo uso que caduca en 24 horas. Existe para que una sesión robada o un
  fallo del navegador no puedan borrarle la cuenta a nadie.
· Al confirmar, tienes 30 días de arrepentimiento. Durante ese tiempo tu cuenta
  queda suspendida: deja de aparecer para los demás, pero tú la sigues viendo y
  puedes cancelar el borrado con un clic.
· Pasados los 30 días se ejecuta, y siempre dentro del plazo de un mes que fija
  el art. 12.3 del RGPD.

Qué pasa exactamente cuando se ejecuta:

PRIMERO, y siempre, se destruye la fila que te vincula con tu persona real. Es
lo primero que se hace, no lo último. A partir de ese instante, todo lo demás
que quede es un seudónimo sin nadie detrás.

LO QUE ESCRIBISTE SOBRE TI SE ELIMINA. El cuerpo de tus publicaciones se
sustituye por un texto lápida y el tema desaparece. La fila del post se conserva
vacía por una razón concreta: si desapareciera entera, los comentarios que otras
personas te dejaron en ese hilo quedarían colgando y los contadores de la
aplicación mentirían.

LO QUE ESCRIBISTE PARA OTRAS PERSONAS SE CONSERVA. Tus comentarios se quedan
donde están, atribuidos a un perfil ya anonimizado. Lo decimos con todas las
letras porque no es lo que se espera: tu borrado no puede robarle a otra persona
el apoyo que recibió. Ese comentario que dejaste a las tres de la madrugada es
tuyo y a la vez es lo que sostuvo a alguien en su peor día; borrarlo dejaría al
autor de aquel post sin la respuesta que le llegó, con un contador de respuestas
que miente y con su «me ayudó» apuntando al vacío. El RGPD contempla
exactamente esto en su artículo 17.3: el derecho al borrado cede cuando choca
con los derechos de terceros, y aquí la anonimización cumple el objetivo real,
que es que nadie pueda saber quién lo escribió.

Si esto no te vale, escríbenos antes de borrar la cuenta y lo miramos caso a
caso. Preferimos hablarlo a que te enteres después.

TU PERFIL NO SE ELIMINA, SE ANONIMIZA EN EL SITIO. Tu seudónimo pasa a ser uno
anónimo del tipo «alguien_1a2b3c4d», el avatar cambia, la biografía se borra, el
karma gastable y los cristales se ponen a cero y la cuenta deja de aparecer en
feeds y rankings. Se conserva el karma de reputación porque de él depende el
nivel que muestran los hilos antiguos, y un número no identifica a nadie. Tu
seudónimo anterior queda retirado para siempre: nadie podrá registrarlo y
heredar tu historial ante los ojos de la comunidad.

TU ACCESO DESAPARECE. La cuenta de acceso se elimina, con sus sesiones y su
segundo factor. No hay forma de volver a entrar, ni para ti ni para nadie.

QUÉ SE CONSERVA SEUDONIMIZADO, Y POR QUÉ: el libro de karma (es la contabilidad
de la economía), el libro de cristales (seis años por obligación mercantil) y el
registro de crisis (cinco años, para poder responder qué hizo el sistema cuando
alguien dijo que quería morirse). Ninguno de los tres conserva vínculo con tu
identidad real, porque esa fila ya no existe. Tus denuncias dejan de estar
atadas a tu seudónimo.

EN LOS REFUGIOS sales de todas las salas y tus mensajes quedan retirados. El
contenido de esas conversaciones está cifrado en tu dispositivo y el servidor
nunca ha podido leerlo: su borrado real es asunto de las claves, no de las
filas.

6. CUÁNTO TIEMPO GUARDAMOS CADA COSA

Está en /legal/retencion, tabla por tabla, con su plazo y su base legal.

7. QUIÉN MÁS VE TUS DATOS

Nadie que no sea necesario. No hay analítica de terceros, ni fuentes externas,
ni SDK sociales, ni píxeles de seguimiento: cada petición saliente sería alguien
que podría saber que estuviste aquí.

Los proveedores que sí intervienen son los de infraestructura —alojamiento de la
aplicación y base de datos—, con los datos alojados en la Unión Europea, y un
proveedor de clasificación automática que revisa el texto para detectar riesgo y
calidad de escucha. Ninguno recibe tu identidad real, porque nosotros tampoco la
tenemos accesible.

8. DECISIONES AUTOMATIZADAS

Un clasificador automático valora si un comentario cuenta como escucha y si un
texto indica riesgo. Puede afectarte: un comentario no validado no acredita
reciprocidad. Puedes pedir revisión humana escribiéndonos, y la cola de riesgo
la revisa siempre una persona.

Ante la duda, el sistema escala hacia arriba. Un falso positivo molesta; un
falso negativo es irreversible.

9. TUS DERECHOS

Acceso, rectificación, supresión, limitación, portabilidad y oposición. Los tres
primeros los puedes ejercer tú mismo desde la aplicación, sin escribir a nadie y
sin identificarte, que es como debe ser. Para el resto, escríbenos.

También puedes reclamar ante la Agencia Española de Protección de Datos.

10. UNA LIMITACIÓN QUE PREFERIMOS DECIR

Si un tutor legal nos pide el borrado de la cuenta de un menor, no podemos
atenderlo: para hacerlo tendríamos que reidentificar a esa persona, y el sistema
es incapaz de hacerlo por diseño. La vía es que la propia persona lo pida desde
su cuenta. Si hay riesgo para alguien, escríbenos y lo tratamos por el protocolo
de crisis, no por el de privacidad. Está explicado en /legal/menores.`

const CUERPO_COOKIES = `Darma usa las cookies imprescindibles para funcionar y ninguna más.

Qué guardamos en tu navegador:

· La cookie de sesión de autenticación. Es lo que permite que sigas dentro entre
  una pantalla y otra. Sin ella no hay aplicación.
· El token de refresco asociado, para no pedirte que entres cada hora.
· Tu preferencia de idioma y de tema, si las cambias.

Eso es todo. No hay cookies de analítica, ni de publicidad, ni de terceros. No
hay píxeles, ni fuentes externas, ni scripts de redes sociales. La política de
seguridad de contenido de la aplicación bloquea las peticiones a cualquier
dominio que no sea el nuestro, así que aunque alguien añadiera un rastreador por
error, el navegador lo rechazaría.

Por eso no verás un banner de cookies pidiéndote permiso: no hay nada que
consentir. Las cookies estrictamente necesarias para prestar un servicio que has
pedido no requieren consentimiento previo, y no usamos ninguna otra.

Si borras las cookies del navegador, cerrarás la sesión. Nada más.`

const CUERPO_MENORES = `La edad mínima para tener cuenta en Darma es de 16 años.

1. POR QUÉ 16 Y NO 14

El RGPD deja que cada Estado fije la edad del consentimiento digital entre los
13 y los 16 años; España la tiene en 14. Darma pone 16 por razones de producto y
de riesgo, no de cumplimiento.

Aquí se habla de lo que duele, y esta es una comunidad de iguales sin
profesionales de guardia. Poner la barra por encima del mínimo legal de la
mayoría de jurisdicciones tiene además una consecuencia práctica: no necesitamos
recoger el consentimiento de un progenitor para los servicios de la sociedad de
la información. Y eso importa más de lo que parece, como se explica en el punto
4.

2. CÓMO SE COMPRUEBA, Y QUÉ NO HACEMOS

En el registro se pide la fecha de nacimiento declarada. Con ella se calcula si
llegas a 16 y se registra únicamente el consentimiento de edad mínima con su
versión: la fecha NO se almacena. Guardar la fecha exacta de nacimiento sería
añadir un identificador más en una aplicación cuyo compromiso es justo el
contrario.

Si la fecha declarada es de una persona menor de 16, no se crea la cuenta y esa
fecha tampoco se guarda.

Nunca pedimos un documento de identidad. Decirlo claro: exigir el DNI para
proteger a un menor destruiría el anonimato de todas las demás personas, que es
lo que hace que alguien se atreva a escribir aquí lo que no le ha contado a
nadie. El remedio sería peor que el problema.

3. LA AUTODECLARACIÓN NO ES VERIFICACIÓN

Lo reconocemos con todas las letras: una casilla de edad no verifica nada.
Alguien de 15 años puede escribir otra fecha. Por eso no fiamos la protección de
menores a la casilla, sino a controles que se aplican a toda la comunidad y a
controles adicionales para las cuentas declaradas menores de 18:

· El protocolo de crisis está siempre activo, para todo el mundo, y el botón de
  ayuda es visible en todas las pantallas.
· Sin mensajería privada con desconocidos para cuentas declaradas menores de 18:
  solo con personas con las que ya existe una relación en la aplicación.
· Sin compras dentro de la aplicación para menores de 18.
· Umbral de moderación más bajo: lo que en una cuenta adulta sería una señal
  leve, en una cuenta declarada menor escala a revisión humana.

4. CONSENTIMIENTO PARENTAL: POR QUÉ NO LO PEDIMOS

Para los 16 y 17 años, allí donde una norma local exija autorización parental en
servicios relacionados con la salud, Darma NO recogerá datos del progenitor.

La razón es que hacerlo obligaría a vincular al menor con un adulto
identificable, y ese vínculo es exactamente el que rompe el anonimato que le
protege. Un adolescente que escribe que su casa no es un lugar seguro no puede
hacerlo en una aplicación que tiene registrado el correo de su padre.

Nuestra respuesta ahí no es recoger identidad: es restringir funciones. Menos
superficie, no más datos.

Esta decisión está tomada a conciencia y es una interpretación razonada, no una
certeza: queda anotada como punto pendiente de revisión legal externa antes de
abrir Darma al público.

5. SI ERES UN PADRE, UNA MADRE O UN TUTOR

No podemos atender una solicitud de borrado de la cuenta de tu hijo o hija. No
es una negativa administrativa: es que para hacerlo tendríamos que averiguar
cuál es su cuenta, y el sistema está construido para que eso sea imposible
incluso para nosotros. No hay ninguna consulta que responda «qué cuenta
pertenece a esta persona».

La única vía es que sea la propia persona quien lo pida desde su cuenta. Puede
hacerlo en dos clics y sin dar explicaciones a nadie.

Si tu preocupación es que esté en riesgo, escríbenos y lo tratamos por el
protocolo de crisis, no por el de privacidad. Ahí sí podemos ayudar, y es la
puerta correcta.`

/**
 * Texto que sustituye al cuerpo de un post al borrar la cuenta de su autor.
 *
 * ⚠️ Es un LITERAL COMPARTIDO CON POSTGRES: la función `borrar_usuario()` de
 * `0201_1_b20_privacidad.sql` lo tiene escrito dentro, porque el borrado ocurre
 * en una sola transacción de base de datos y no puede depender de que Node le
 * pase un parámetro. `textos.test.ts` lee la migración y comprueba que los dos
 * son idénticos; si alguien cambia uno solo, la prueba falla.
 */
export const TEXTO_LAPIDA_POST =
  'Esta persona pidió que su cuenta se eliminara. Su texto ya no está aquí. Los comentarios con los que acompañó a otras personas siguen en sus hilos, sin autor identificable, porque borrarlos le quitaría a alguien el apoyo que recibió.'

export const DOCUMENTOS_LEGALES: Readonly<Record<TipoDocumentoLegal, DocumentoLegal>> = {
  terminos: {
    tipo: 'terminos',
    version: TERMINOS_VERSION,
    actualizadoEn: ACTUALIZADO,
    titulo: 'Condiciones de uso',
    cuerpo: CUERPO_TERMINOS,
    sha256: '0947cc403fc06167f8419d79a4a17415d2376506d5def0b6f7fb3eb10e7d16b4',
  },
  privacidad: {
    tipo: 'privacidad',
    version: PRIVACIDAD_VERSION,
    actualizadoEn: ACTUALIZADO,
    titulo: 'Privacidad y protección de datos',
    cuerpo: CUERPO_PRIVACIDAD,
    sha256: 'c670705697cc36e50bef6d97cdc763498047146c39f8b52198d482b2ff515927',
  },
  cookies: {
    tipo: 'cookies',
    version: COOKIES_VERSION,
    actualizadoEn: ACTUALIZADO,
    titulo: 'Cookies',
    cuerpo: CUERPO_COOKIES,
    sha256: '578a6f93e5d582a78632139929e42663e7371f04edcbf6fa25be4eedf8cef305',
  },
  no_es_terapia: {
    tipo: 'no_es_terapia',
    version: NO_ES_TERAPIA_VERSION,
    actualizadoEn: ACTUALIZADO,
    titulo: 'Darma no sustituye a la terapia',
    cuerpo: AVISO_NO_TERAPIA_LARGO,
    sha256: '49d7c03d6f3b3c29b5f58407661aa11cc97224fcef10382e7bdf875dea4fb177',
  },
  menores: {
    tipo: 'menores',
    version: MENORES_VERSION,
    actualizadoEn: ACTUALIZADO,
    titulo: 'Edad mínima y menores',
    cuerpo: CUERPO_MENORES,
    sha256: '31d40db963ac4e1b0ab5fd2112e881acfda6b486f87f0799d0153a3d3aa6909d',
  },
  retencion: {
    tipo: 'retencion',
    version: RETENCION_VERSION,
    actualizadoEn: ACTUALIZADO,
    titulo: 'Cuánto tiempo guardamos cada cosa',
    cuerpo: cuerpoRetencion(),
    sha256: 'b0882d3ec75f062dc3080ea4c0eb70dac67895cb56967b111c06063745145d1b',
  },
}

/** Los seis documentos, en el orden en que se listan en `/legal`. */
export const ORDEN_DOCUMENTOS: readonly TipoDocumentoLegal[] = [
  'privacidad',
  'terminos',
  'no_es_terapia',
  'menores',
  'retencion',
  'cookies',
]

/** Ruta pública de un documento. Bajo `/legal/…` para que `proxy.ts` la deje
 *  pasar sin sesión: estos textos hay que poder leerlos ANTES de registrarse. */
export function rutaDocumento(tipo: TipoDocumentoLegal): string {
  const segmentos: Readonly<Record<TipoDocumentoLegal, string>> = {
    terminos: 'terminos',
    privacidad: 'privacidad',
    cookies: 'cookies',
    no_es_terapia: 'no-es-terapia',
    menores: 'menores',
    retencion: 'retencion',
  }
  return `/legal/${segmentos[tipo]}`
}

/**
 * sha256 hex de un texto. Se importa `node:crypto` de forma diferida para que
 * este módulo se pueda cargar desde un Server Component sin arrastrar el módulo
 * nativo al grafo de cliente.
 */
export async function huellaTexto(texto: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}
