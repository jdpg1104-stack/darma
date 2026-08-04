# Verificación de los 24 recursos de crisis

Es lo único que separa a Darma de producción. `tablaListaParaProduccion()`
devuelve `false` y desde el PR #3 eso **detiene el build de producción**: hasta
que esta lista esté a cero, no se despliega.

> ⚠️ **Yo no puedo hacer esto por ti, y no es una limitación de permisos.** Los
> números de este repositorio se escribieron de memoria. Un modelo confirmando
> de memoria un número que se escribió de memoria no verifica nada: repite la
> misma apuesta con más confianza. La única verificación que vale es abrir la
> `fuente` oficial y leer el número que hay hoy, o marcarlo y que conteste
> alguien.
>
> Por eso ninguna fila de abajo dice si el número «parece correcto». Solo dice
> dónde comprobarlo.
>
> Las notas en cursiva bajo cada país (el alcance del `135`, si el `*4141` va
> desde fijo, la palabra clave de los SMS…) **también salen de memoria y también
> hay que verificarlas**. No están ahí como dato, sino como pista de qué mirar:
> son las cosas que más se dan por supuestas y más se rompen. Si una resulta
> falsa, bórrala.

## Cuánto trabajo es de verdad

No son 24 llamadas. Son **11**:

| Tipo | Cuántos | Cómo se verifica |
|---|---|---|
| **Líneas de ayuda** | **11** | Marcar. Es el único tipo que exige llamada. |
| Emergencias | 8 | Página oficial del gobierno. **No los marques.** |
| SMS | 2 | Página oficial de la organización. |
| Chat / Web | 3 | Abrir la URL y comprobar que sigue viva y en servicio. |

**Nunca marques un número de emergencias para probarlo.** Ocupas una línea que
alguien puede necesitar en ese momento. Los 8 se confirman leyendo la web oficial
del organismo que los opera.

## Qué hay que confirmar en cada uno

No solo que el número exista. Los cuatro datos que la app enseña y que caducan:

1. **El número** — es lo que cambia menos, y aun así cambia.
2. **El horario** — todos están declarados `24/7`. Si una línea es de 9 a 21,
   enseñarla de madrugada como disponible es peor que no enseñarla.
3. **Si es gratuita** — hay dos declaradas de pago (Teléfono de la Esperanza y
   Salud Responde). Confírmalo: alguien sin saldo necesita saberlo.
4. **Los idiomas de atención** — es el idioma en que ATIENDE la línea, no el de
   la interfaz.

---

## España

- [ ] **Línea de Atención a la Conducta Suicida** · `024` · 24/7 · gratuito ·
      es/ca/eu/gl/en
      <https://www.sanidad.gob.es/linea024/home.htm>
- [ ] **Teléfono de la Esperanza** · `717003717` · 24/7 · **con coste** · es
      <https://telefonodelaesperanza.org>
- [ ] 🚨 **Emergencias** · `112` · 24/7 · gratuito · es/en/fr/de
      <https://www.112.es>

## México

- [ ] **Línea de la Vida** · `8009112000` · 24/7 · gratuito · es
      <https://www.gob.mx/salud/conadic>
- [ ] 🚨 **Emergencias** · `911` · 24/7 · gratuito · es
      <https://www.gob.mx/911>

## Argentina

- [ ] **Centro de Asistencia al Suicida (CAS)** · `135` · 24/7 · gratuito · es
      <https://www.asistenciaalsuicida.org.ar>
- [ ] **Línea de Salud Mental Responde** · `08009990091` · 24/7 · gratuito · es
      <https://www.argentina.gob.ar/salud/mental>
- [ ] 🚨 **Emergencias** · `911` · 24/7 · gratuito · es
      <https://www.argentina.gob.ar/emergencias>

> El `135` es de línea fija y de alcance limitado en algunas provincias; el
> `08009990091` es el alcance nacional. Confirma cuál corresponde a cada caso.

## Colombia

- [ ] **Línea 106 «El poder de ser escuchado»** · `106` · 24/7 · gratuito · es
      <https://www.saludcapital.gov.co>
- [ ] 🚨 **Emergencias** · `123` · 24/7 · gratuito · es
      <https://www.policia.gov.co>

> La `106` la opera la Secretaría de Salud de **Bogotá**. Verifica si aplica
> fuera de la ciudad; si no, el país necesita otra entrada o una nota.

## Chile

- [ ] **Línea de prevención del suicidio** · `*4141` · 24/7 · gratuito · es
      <https://www.gob.cl/hablemosdetodo/>
- [ ] **Salud Responde** · `6003607777` · 24/7 · **con coste** · es
      <https://www.minsal.cl>
- [ ] 🚨 **SAMU · Emergencias** · `131` · 24/7 · gratuito · es
      <https://www.minsal.cl>

> `*4141` solo funciona desde móvil. Merece confirmarse y quizá anotarse.

## Perú

- [ ] **Línea 113 · opción 5 (salud mental)** · `113` · 24/7 · gratuito · es
      <https://www.gob.pe/minsa>
- [ ] 🚨 **SAMU · Emergencias** · `106` · 24/7 · gratuito · es
      <https://www.gob.pe/institucion/minsa/campa%C3%B1as/samu>

> Confirma que la opción 5 sigue siendo la de salud mental: los menús de las
> líneas 113 se reorganizan.

## Estados Unidos

- [ ] **988 Suicide & Crisis Lifeline** · `988` · 24/7 · gratuito · en/es
      <https://988lifeline.org>
- [ ] 💬 **Crisis Text Line** · SMS a `741741` · 24/7 · gratuito · en/es
      <https://www.crisistextline.org>
- [ ] 🌐 **988 Lifeline Chat** · <https://988lifeline.org/chat/> · 24/7 · en/es
- [ ] 🚨 **Emergencies** · `911` · 24/7 · gratuito · en/es
      <https://www.911.gov>

> Confirma la palabra clave del SMS: en Crisis Text Line no siempre es la misma
> y la app no la muestra hoy.

## Reino Unido

- [ ] **Samaritans** · `116123` · 24/7 · gratuito · en
      <https://www.samaritans.org>
- [ ] 💬 **Shout** · SMS a `85258` · 24/7 · gratuito · en
      <https://giveusashout.org>
- [ ] 🚨 **Emergency services** · `999` · 24/7 · gratuito · en
      <https://www.gov.uk/call-999>

> Shout exige enviar la palabra `SHOUT`. Igual que arriba: confírmala.

## Internacional

Se enseñan cuando no se puede determinar el país. No tienen número: son
directorios.

- [ ] 🌐 **Find A Helpline** · <https://findahelpline.com> · en/es
- [ ] 🌐 **Befrienders Worldwide** · <https://befrienders.org> · en

---

## Cómo registrar una verificación

Por cada recurso confirmado, en `i18n/recursosCrisis.ts`:

1. `verificadoPor: 'Tu Nombre'` — sustituye el `null`.
2. `verificadoEn: '2026-08-04'` — la fecha de HOY, no la de escritura.
3. Borra su línea de `PENDIENTES_DECLARADOS`.

Los tres pasos son obligatorios: `i18n/recursosCrisis.test.ts` compara las dos
listas y falla si añades un número sin declararlo o lo marcas como verificado
sin tocar el inventario.

Para ver cuántos quedan en cualquier momento:

```bash
node --experimental-strip-types scripts/security/gateTelefonos.ts
```

Y para comprobar que el freno de producción se ha soltado de verdad:

```bash
DARMA_EXIGIR_TELEFONOS=1 npm run build
```

Mientras quede uno sin confirmar, ese comando sale con error. El día que salga
en verde, producción está desbloqueada.

## La verificación caduca

`VENTANA_VERIFICACION_DIAS = 180`. Pasados seis meses, el gate vuelve a
bloquear el despliegue aunque `verificadoPor` esté puesto. No es burocracia: las
líneas de ayuda cambian de número, de horario y de financiación, y un teléfono
confirmado hace dos años es tan peligroso como uno sin confirmar.
