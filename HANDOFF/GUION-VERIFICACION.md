# Guión de trabajo · verificar los 24 recursos de crisis en una tarde

Este es el guión operativo para la única tarea humana que bloquea producción:
**11 llamadas y 13 comprobaciones web/SMS**. El contexto y el porqué están en
`HANDOFF/VERIFICACION-TELEFONOS.md`; esto es el *cómo*, paso a paso, con los
comandos ya rellenados para copiar y pegar.

**Quién**: una persona con nombre y apellidos. El registro firma quién confirmó
cada dato; no se delega en un modelo ni en «el equipo».

**Cuánto**: unas 3–4 horas si se sigue el orden de franjas de abajo.

**Qué necesitas**:

- Un teléfono. ⚠️ Ojo: muchos de estos números son **códigos cortos o líneas
  gratuitas nacionales que NO se pueden marcar desde otro país** (`988`, `135`,
  `*4141`, `113`, los `0800`/`800`/`600`…). Si llamas desde España, para esos
  recursos usa el **número administrativo en formato internacional** que
  encontrarás en la fuente durante la Franja 0, o una línea VoIP del país, o
  alguien in situ. Está señalado recurso a recurso.
- Un navegador (cuatro fuentes bloquean clientes automáticos; hay que abrirlas
  a mano).
- Este archivo impreso o en una segunda pantalla, para ir anotando.

## Las tres reglas de oro

1. **NUNCA marques un número de emergencias** (112, 911, 999, 123, 131, 106 PE).
   Se verifican leyendo la web oficial del organismo. Marcar «para probar» ocupa
   una línea que alguien puede necesitar en ese instante.
2. **NUNCA envíes un SMS de prueba** a Crisis Text Line ni a Shout: te conecta
   con un consejero real. Se verifican por su web oficial.
3. En las llamadas, **menos de 30 segundos y colgar**. Son líneas de crisis: cada
   minuto tuyo es un minuto que no atienden a otra persona. Si la fuente publica
   un **número administrativo o de contacto general, llama a ese**, no a la línea
   de atención. La Franja 0 existe para encontrarlos antes de marcar nada.

---

## El guion de llamada (menos de 30 segundos)

En español:

> «Buenos días. Llamo desde una aplicación de apoyo emocional que muestra
> teléfonos de ayuda, para confirmar cuatro datos y no publicar nada incorrecto:
> ¿este número es el correcto para atención en crisis? ¿Atienden las 24 horas
> todos los días? ¿La llamada es gratuita desde móvil y desde fijo? ¿En qué
> idiomas atienden? Nada más — gracias por lo que hacéis.»

En inglés (GB, US):

> "Good morning. I'm calling from an emotional-support app that lists helplines,
> to confirm four facts so we don't publish anything wrong: is this the right
> number for crisis support? Are you available 24/7? Is the call free from
> mobiles and landlines? Which languages do you support? That's all — thank you
> for what you do."

Si preguntan más: es una app anónima de apoyo entre iguales que muestra recursos
de crisis y quiere los datos confirmados con la fuente. No inventes nada, no
simules una crisis, no alargues.

**Anota siempre**: la hora exacta de la llamada, quién contestó (rol, no nombre
si no lo dan), y las respuestas a las cuatro preguntas más la de ámbito si
aplica. Una línea «24/7» que no contesta también es un dato: anótalo y reintenta
una vez más tarde antes de concluir nada.

---

## Franja 0 · Reconocimiento web (≈60 min, sin depender de husos horarios)

Antes de marcar nada. Aquí caen las 13 comprobaciones web/SMS **y** la caza de
números administrativos para las llamadas de las franjas 1 y 2.

Para cada URL: comprueba que carga, busca el número **literal** en la página, la
mención expresa de horario («24 horas», «24/7», «365 días»), la de gratuidad
(«gratuito», «free», «llamada sin coste») y la de idiomas. Y en el pie o la
sección «Contacto», el **teléfono administrativo** en formato internacional:
apúntalo en el hueco de cada recurso.

### 0.a — Tres fuentes están rotas: encuéntrales URL nueva primero

Detectado el 2026-08-05 (ver VERIFICACION-TELEFONOS.md). Sin fuente viva no hay
verificación posible. Los «puntos de partida» son sugerencias de búsqueda, **no
fuentes**: la fuente es la URL oficial que tú encuentres y leas.

| Recurso | Fuente rota | Punto de partida para buscar |
|---|---|---|
| ES·Emergencias (112) | `https://www.112.es` no responde | Buscar «112» en `administracion.gob.es` o `interior.gob.es`; cada CCAA tiene además su portal 112 |
| AR·Línea de Salud Mental Responde | `https://www.argentina.gob.ar/salud/mental` → 404 | Buscar «salud mental 0800» desde `https://www.argentina.gob.ar/salud` |
| GB·Emergency services (999) | `https://www.gov.uk/call-999` → 404 | Buscar «999» en `https://www.gov.uk` |

Cuando tengas la URL nueva: **actualiza el campo `fuente` de ese recurso en
`i18n/recursosCrisis.ts` en la misma sesión**, antes de registrar la
verificación. El script de registro no toca `fuente`; es edición manual.

### 0.b — Las 8 emergencias (solo lectura, JAMÁS llamar)

| # | Recurso | URL a leer | Qué campo confirma cada dato |
|---|---|---|---|
| 1 | ES·Emergencias `112` | (la URL nueva de 0.a) | Número literal; «24 horas»; «gratuito desde cualquier teléfono»; idiomas — tenemos `es/en/fr/de`: confírmalo o recórtalo, la atención multilingüe varía por CCAA |
| 2 | MX·Emergencias `911` | <https://www.gob.mx/911> | Número; cobertura nacional; gratuidad; es |
| 3 | AR·Emergencias `911` | <https://www.argentina.gob.ar/emergencias> | Número; **ámbito: el 911 no cubre todas las provincias por igual — busca la mención de cobertura**; gratuidad |
| 4 | CO·Emergencias `123` | <https://www.policia.gov.co> (🤖 bloquea bots: ábrela a mano) | Número 123 literal; gratuidad; cobertura nacional |
| 5 | CL·SAMU `131` | <https://www.minsal.cl> (🤖 a mano) | «131» como número del SAMU; gratuidad |
| 6 | PE·SAMU `106` | <https://www.gob.pe/institucion/minsa/campa%C3%B1as/samu> | «106» literal; gratuidad; cobertura |
| 7 | US·Emergencies `911` | <https://www.911.gov> (🤖 a mano) | Número; «24/7»; gratuidad; atención en español (tenemos `en/es`) |
| 8 | GB·Emergency services `999` | (la URL nueva de 0.a) | «999» literal; gratuito; 24/7 |

Comandos de registro (tras leer y confirmar cada una, con TU nombre):

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "ES·Emergencias" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "MX·Emergencias" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "AR·Emergencias" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "CO·Emergencias" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "CL·SAMU · Emergencias" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "PE·SAMU · Emergencias" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "US·Emergencies" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "GB·Emergency services" --por "Nombre Apellido"
```

### 0.c — Los 2 SMS (web oficial; NO mandes SMS de prueba)

| # | Recurso | URL a leer | Qué campo confirma cada dato |
|---|---|---|---|
| 9 | US·Crisis Text Line, SMS a `741741` | <https://www.crisistextline.org> | El número `741741`; **la palabra clave** (el 2026-08-05 la web decía «text HOME or HOLA to 741741»); «24/7»; «free»; español sí/no |
| 10 | GB·Shout, SMS a `85258` | <https://giveusashout.org> | El número `85258`; **la palabra `SHOUT`**; «24/7»; «free»; en |

⚠️ Además de registrar la verificación, **apunta la palabra clave exacta**: el
campo `palabraClave` de estos dos recursos está a `null` en
`i18n/recursosCrisis.ts` y hay que rellenarlo a mano en la misma edición (el
script de registro no lo hace). Mientras esté a `null`, `/ayuda` manda a la
fuente en vez de prometer una palabra; con el dato confirmado, se enseña.

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "US·Crisis Text Line" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "GB·Shout" --por "Nombre Apellido"
```

### 0.d — El chat y los 2 directorios internacionales

| # | Recurso | URL a abrir | Qué confirmar |
|---|---|---|---|
| 11 | US·988 Lifeline Chat | <https://988lifeline.org/chat/> | Que la página carga y el chat está **en servicio** (botón/ventana activos, sin aviso de suspensión); «24/7»; español disponible. NO inicies una conversación de prueba. |
| 12 | INTERNACIONAL·Find A Helpline | <https://findahelpline.com> | Que carga, que el buscador de país funciona (prueba con un país cualquiera y cierra), y que tiene interfaz en `en` y `es` |
| 13 | INTERNACIONAL·Befrienders Worldwide | <https://befrienders.org> | Que carga y el directorio por país responde |

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "US·988 Lifeline Chat" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "INTERNACIONAL·Find A Helpline" --por "Nombre Apellido"
node --experimental-strip-types scripts/security/registrarVerificacion.ts "INTERNACIONAL·Befrienders Worldwide" --por "Nombre Apellido"
```

### 0.e — Caza de números administrativos para las llamadas

Mientras tienes cada fuente abierta, apunta el teléfono de **contacto general /
administración / sede** (formato internacional) de estas organizaciones. Es el
número al que llamar en las franjas 1 y 2 siempre que exista, para no ocupar la
línea de atención:

| Organización | Dónde suele estar en su web | Anótalo aquí |
|---|---|---|
| Ministerio de Sanidad (opera el 024) | `sanidad.gob.es` → contacto/información | ______________ |
| Teléfono de la Esperanza | `telefonodelaesperanza.org` → sedes provinciales (tienen fijos) | ______________ |
| CONADIC / Línea de la Vida (MX) | `gob.mx/salud/conadic` → contacto | ______________ |
| Centro de Asistencia al Suicida (AR) | su web daba el 2026-08-05 un `(011) 5275-1135` — confírmalo al abrirla | ______________ |
| Salud Capital / Línea 106 (CO) | `saludcapital.gov.co` → atención al ciudadano | ______________ |
| MINSAL / Salud Responde (CL) | `minsal.cl` → contacto | ______________ |
| MINSA / Línea 113 (PE) | `gob.pe/minsa` → central telefónica | ______________ |
| 988 Lifeline (US) | `988lifeline.org` → «Contact» (administrativo, no el 988) | ______________ |
| Samaritans (GB) | `samaritans.org` → «Contact us» → general enquiries | ______________ |

---

## Franjas 1 y 2 · Las 11 llamadas

Orden por **prioridad de lanzamiento** (España primero: la app nace en español y
con `es` por defecto; si el mercado inicial cambia, reordena) y por **franja
horaria**: se llama en horario laboral local de cada país, que es cuando los
números administrativos contestan y las líneas están mejor dotadas.

Husos el 2026-08 (verano en el hemisferio norte), con la hora de España
peninsular (CEST, UTC+2) como referencia:

| País | Diferencia con España | Cuando en España son las 17:00, allí son | Ventana buena (hora de España) |
|---|---|---|---|
| España | — | 17:00 | 10:00–20:00 |
| Reino Unido | −1 h | 16:00 | 10:00–19:00 |
| México (CDMX) | −8 h | 09:00 | 17:00–20:00 |
| Argentina | −5 h | 12:00 | 15:00–19:00 |
| Colombia | −7 h | 10:00 | 16:00–20:00 |
| Chile (invierno austral) | −6 h | 11:00 | 16:00–20:00 |
| Perú | −7 h | 10:00 | 16:00–20:00 |
| EE. UU. (costa este) | −6 h | 11:00 | 15:00–21:00 |

Plan resumido de la tarde: **15:00** Franja 0 · **16:00** España y Reino Unido ·
**17:00–19:00** América. Todas las líneas se declaran 24/7, así que el orden es
por cortesía y probabilidad de respuesta, no por obligación.

En cada llamada: el guion de 30 segundos de arriba + la **pregunta específica**
del recurso, y colgar.

### Franja 1 · 16:00–17:00 — Europa

**1 · ES·Línea de Atención a la Conducta Suicida — `024`**

- En tabla: 24/7 · gratuito · atiende es/ca/eu/gl/en · fuente <https://www.sanidad.gob.es/linea024/home.htm>
- La fuente (leída el 2026-08-05) ya decía «gratuito, confidencial y disponible
  las 24 horas del día, los 365 días del año»: la llamada confirma la lista de
  idiomas y firma el conjunto.
- Vía: el 024 se marca sin problema desde España. Si en 0.e encontraste
  contacto administrativo del Ministerio, mejor ese.
- Pregunta específica: **¿atendéis en catalán, euskera, gallego e inglés,
  además de castellano?** (la lista completa que publicamos).
- Nota de la fuente para el futuro: ofrecen también chat y videointerpretación
  en lengua de signos que hoy no enseñamos; apúntalo si lo confirman.

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "ES·Línea de Atención a la Conducta Suicida" --por "Nombre Apellido"
```

**2 · ES·Teléfono de la Esperanza — `717003717`**

- En tabla: 24/7 · **con coste** · es · fuente <https://telefonodelaesperanza.org>
- Vía: si en 0.e apuntaste el fijo de una sede, llama ahí; si no, al 717 003 717
  (con el guion corto: es una línea de escucha).
- Preguntas específicas: **¿la llamada tiene coste para quien llama, desde móvil
  y desde fijo?** (lo publicamos como «con coste»: si resulta gratuita, mejor
  noticia y hay que corregir la tabla) y **¿24 horas todos los días?**

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "ES·Teléfono de la Esperanza" --por "Nombre Apellido"
```

**3 · GB·Samaritans — `116123`**

- En tabla: 24/7 · gratuito · en · fuente <https://www.samaritans.org>
- La fuente ya decía «Call 116 123 for free», «24 hours a day, 365 days a year».
- Vía: el `116123` es un número armonizado europeo — **desde España el 116 123
  te atiende el Teléfono de la Esperanza español, no Samaritans**. Llama al
  número de *general enquiries* de `samaritans.org` que apuntaste en 0.e (en
  formato +44), o desde una línea británica.
- Pregunta específica: **¿solo atendéis en inglés?** (publicamos `en` a secas) y
  si el 116 123 es gratuito desde cualquier operador del Reino Unido.

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "GB·Samaritans" --por "Nombre Apellido"
```

### Franja 2 · 17:00–19:00 — América

**4 · MX·Línea de la Vida — `8009112000`** *(17:00+, mañana en CDMX)*

- En tabla: 24/7 · gratuito · es · fuente <https://www.gob.mx/salud/conadic>
- Vía: los 800 mexicanos **no se marcan desde fuera de México**. Usa el
  contacto administrativo de CONADIC de 0.e (formato +52) o una línea mexicana.
- Preguntas específicas: **¿el 800 911 2000 sigue operativo como Línea de la
  Vida?** (ha habido reorganizaciones hacia el 911; si la atención se movió,
  la tabla necesita cambio, no firma) y ámbito nacional.

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "MX·Línea de la Vida" --por "Nombre Apellido"
```

**5 · AR·Centro de Asistencia al Suicida (CAS) — `135`** *(17:00+, mediodía en AR)*

- En tabla: 24/7 · gratuito · es · fuente <https://www.asistenciaalsuicida.org.ar>
- La fuente daba el 2026-08-05 TRES números: `135` (línea gratuita),
  `(011) 5275-1135` y `0800 345 1435 «desde todo el país»`. Que distingan el 135
  del «desde todo el país» sugiere que **el 135 NO es nacional**.
- Vía: el `135` no se marca desde fuera; el `(011) 5275-1135` sí (+54 11 5275 1135).
- Pregunta específica (LA pregunta de esta llamada): **¿desde dónde funciona el
  135?** Si la respuesta es «solo CABA y GBA», la entrada necesita el 0800 o una
  nota de ámbito ANTES de firmarse: anótalo y edita la tabla primero.

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "AR·Centro de Asistencia al Suicida (CAS)" --por "Nombre Apellido"
```

**6 · AR·Línea de Salud Mental Responde — `08009990091`**

- En tabla: 24/7 · gratuito · es · fuente **rota** (404) — usa la URL nueva de 0.a
  y actualiza `fuente` antes de registrar.
- Vía: `0800` no marcable desde fuera; contacto administrativo del ministerio o
  línea argentina.
- Preguntas específicas: **¿el 0800 999 0091 sigue siendo el número?** y
  **¿es de ámbito nacional?** (es nuestro «alcance nacional» frente al 135).

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "AR·Línea de Salud Mental Responde" --por "Nombre Apellido"
```

**7 · CO·Línea 106 «El poder de ser escuchado» — `106`** *(17:00+, media mañana en CO)*

- En tabla: 24/7 · gratuito · es · fuente <https://www.saludcapital.gov.co> (🤖 ábrela a mano)
- Vía: el `106` no se marca desde fuera; usa el número de atención al ciudadano
  de Salud Capital de 0.e (+57) o una línea colombiana.
- Pregunta específica (LA pregunta): **la 106 la opera la Secretaría de Salud de
  Bogotá — ¿funciona fuera de Bogotá?** Si es solo Bogotá, Colombia necesita
  otra entrada nacional o una nota de ámbito antes de firmar: anótalo y escala.

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "CO·Línea 106 «El poder de ser escuchado»" --por "Nombre Apellido"
```

**8 · CL·Línea de prevención del suicidio — `*4141`** *(17:00+, media mañana en CL)*

- En tabla: 24/7 · gratuito · es · fuente <https://www.gob.cl/hablemosdetodo/> (🤖 a mano)
- Vía: `*4141` **solo funciona desde móviles chilenos**. Contacto de MINSAL de
  0.e o línea chilena.
- Preguntas específicas: **¿el *4141 funciona desde fijo o solo desde móvil?**
  (si es solo móvil, hay que anotarlo en la entrada antes de firmar) y ¿desde
  todos los operadores?

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "CL·Línea de prevención del suicidio *4141" --por "Nombre Apellido"
```

**9 · CL·Salud Responde — `6003607777`**

- En tabla: 24/7 · **con coste** · es · fuente <https://www.minsal.cl> (🤖 a mano)
- Vía: los `600` chilenos no se marcan desde fuera. Mismo contacto MINSAL; en su
  web suele publicarse también un número alternativo en formato `+56 2` — si lo
  ves en 0.e, apúntalo.
- Preguntas específicas: **¿qué coste tiene la llamada?** (lo publicamos «con
  coste»: confirma que sigue siendo así y desde qué redes) y **¿la opción de
  salud mental sigue disponible 24/7?**

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "CL·Salud Responde" --por "Nombre Apellido"
```

**10 · PE·Línea 113 · opción 5 (salud mental) — `113`** *(17:00+, media mañana en PE)*

- En tabla: 24/7 · gratuito · es · fuente <https://www.gob.pe/minsa>
- Vía: `113` no marcable desde fuera; central de MINSA de 0.e (+51) o línea
  peruana.
- Pregunta específica (LA pregunta): **¿la opción 5 del menú sigue siendo salud
  mental?** Los menús del 113 se reorganizan; si cambió, el `nombre` de la
  entrada («Línea 113 · opción 5») debe corregirse antes de firmar.

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "PE·Línea 113 · opción 5 (salud mental)" --por "Nombre Apellido"
```

**11 · US·988 Suicide & Crisis Lifeline — `988`** *(cualquier hora desde las 15:00)*

- En tabla: 24/7 · gratuito · en/es · fuente <https://988lifeline.org>
- La fuente ya decía «available 24/7/365», «free and confidential», con
  servicios en español.
- Vía: el `988` no se marca desde fuera de EE. UU./Canadá. Usa el contacto
  administrativo de 988lifeline.org de 0.e, o una línea estadounidense. Dado que
  la web oficial confirma los cuatro datos, esta llamada es la más prescindible
  de las 11 si la tarde se acorta — pero alguien tiene que decidirlo y firmarlo.
- Pregunta específica: **¿la atención en español está disponible 24/7 o en
  horario reducido?**

```bash
node --experimental-strip-types scripts/security/registrarVerificacion.ts "US·988 Suicide & Crisis Lifeline" --por "Nombre Apellido"
```

---

## Qué hacer cuando un dato NO coincide

El script de registro solo firma (`verificadoPor`, `verificadoEn`, quitar de
`PENDIENTES_DECLARADOS`). **No firmes datos que resultaron falsos.** El orden
correcto es:

1. Corrige la entrada en `i18n/recursosCrisis.ts` (número, `horario`,
   `gratuito`, `idiomasAtencion`, `fuente`, `palabraClave`, o el `nombre` si el
   ámbito cambia). Si cambias el `nombre`, cambia también su línea en
   `PENDIENTES_DECLARADOS` — el identificador es `PAIS·nombre`.
2. Ejecuta la prueba del inventario (abajo) para comprobar coherencia.
3. ENTONCES registra la verificación con el comando.

Si la discrepancia es de producto y no de dato (p. ej. Colombia necesita una
línea nacional además de la 106, o Argentina el 0800 del CAS), no lo resuelvas
sobre la marcha: anótalo, deja ese recurso sin firmar y escálalo. Un recurso sin
firmar bloquea producción, que es exactamente lo que debe hacer.

Consejos con el comando:

- `--seco` al final enseña el cambio sin escribir nada. Úsalo la primera vez.
- El identificador debe ser EXACTO, guillemets y puntos medios incluidos; los
  comandos de este guión ya los llevan bien. Si tu terminal se atraganta con
  `«»` o `·`, copia el comando en Git Bash.
- Si un recurso ya tiene `verificadoPor`, el script se niega: la re-verificación
  es edición manual.

---

## Checklist de cierre · cómo saber que has terminado

En orden, desde la raíz del repo:

1. **¿Cuántos quedan?**

   ```bash
   node --experimental-strip-types scripts/security/gateTelefonos.ts
   ```

   Terminado = imprime `[darma] Teléfonos de crisis: los 24 verificados y
   dentro de la ventana de frescura.` y sale con código 0. Esa línea ES
   `tablaListaParaProduccion() === true` (más la comprobación de caducidad).
   Mientras liste pendientes, no has terminado.

2. **¿El inventario es coherente?** (firmas sin quitar de pendientes, o al revés)

   ```bash
   node --test --experimental-strip-types i18n/recursosCrisis.test.ts
   ```

   Todo en verde.

3. **¿El freno de producción se ha soltado de verdad?**

   ```bash
   # bash / Git Bash
   DARMA_EXIGIR_TELEFONOS=1 npm run build
   ```

   ```powershell
   # PowerShell
   $env:DARMA_EXIGIR_TELEFONOS='1'; npm run build
   ```

   Mientras quede un recurso sin firmar, ese build FALLA con el informe del
   gate. El día que termine en verde, producción está desbloqueada.

4. **Agenda la caducidad.** `VENTANA_VERIFICACION_DIAS = 180`: unos seis meses
   después de hoy (verificando el 2026-08, hacia **febrero de 2027**) el gate
   vuelve a bloquear producción aunque todo esté firmado. Pon un recordatorio
   ahora; la segunda vuelta será mucho más corta con este mismo guión y los
   números administrativos ya anotados en 0.e.

5. **Entrega los flecos.** La palabra clave de los SMS (`palabraClave`), las
   URL de `fuente` que hayas cambiado y cualquier discrepancia de ámbito (135,
   106) son cambios de código: confírmalos en la misma rama o repórtalos en
   `HANDOFF/PEDIDOS.md` para que los recoja quien toque `recursosCrisis.ts` o
   `TarjetaCrisis`.
