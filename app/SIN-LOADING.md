# No añadas `loading.tsx` — ni ningún `<Suspense>` — a este proyecto

Si estás a punto de crear un `loading.tsx` **o de escribir un `<Suspense>`**,
lee esto antes. Rompe la aplicación entera y no lo detecta nada.

> `loading.tsx` no es más que el azúcar de Next para un límite de Suspense, así
> que los dos disparan exactamente el mismo fallo. La primera versión de este
> documento solo hablaba de `loading.tsx`, se retiraron los ocho que había, y
> **los dos `<Suspense>` escritos a mano sobrevivieron a la limpieza**: el feed
> siguió sin pintar un solo post y el formulario de responder siguió muerto
> durante toda una ola de trabajo. Ver «Lo que se escapó» al final.

## Qué pasa

El layout raíz (`app/layout.tsx`) es **asíncrono**: espera a `resolverLocale()`
para poner el `lang` del documento, y por tanto **suspende en todas las
peticiones**.

Con un `loading.tsx` en el árbol, React nunca completa el intercambio del
fallback. El resultado no es una pantalla en blanco —eso se vería enseguida—
sino algo mucho peor de encontrar:

- La página se pinta entera y **parece correcta**.
- El fallback se queda en el DOM junto al contenido (dos `<main>`).
- **La hidratación no arranca.** Ningún componente de cliente cobra vida.

Es decir: la app se ve bien y no responde a nada. El composer se queda en
«Preparando el espacio para escribir…» para siempre; ningún formulario envía;
ningún botón hace nada.

## Cómo se encontró

Recorriendo la aplicación a mano, pantalla por pantalla. **Ni `tsc`, ni el lint,
ni los 1.209 tests lo veían**, porque cada pieza estaba bien por separado: el
layout raíz es correcto, el `loading.tsx` es correcto, el composer es correcto.
Lo que falla es la combinación, y solo se manifiesta al hidratar en un navegador
de verdad.

Durante un rato pareció que `/feed` era inmune —era la única ruta que
funcionaba— porque tenía su propio `loading.tsx` en el mismo segmento. Era
casualidad: al probarlo con calma también estaba roto, solo que su contenido
vive dentro de un `<Suspense>` propio y el fallo se disfrazaba de «feed vacío».

## Qué se hizo

Se eliminaron los ocho `loading.tsx` del proyecto. El coste es el esqueleto de
carga; el beneficio es que la aplicación funciona. No hay comparación posible.

El esqueleto sigue en `app/(app)/_esqueleto.tsx` por si algún día se puede
recuperar.

## Si de verdad hace falta un esqueleto

Hay que quitar el `await` del layout raíz antes. Dos caminos, ninguno gratis:

1. **`lang` estático + corrección en cliente.** El layout vuelve a ser síncrono
   con `lang="es"`, y `ProveedorIdioma` ajusta `document.documentElement.lang`
   al montar. Coste: entre el HTML inicial y la hidratación, un lector de
   pantalla anuncia el inglés con fonética española.
2. **Rutas por idioma** (`/es`, `/en`). El locale sale del segmento y no de las
   cabeceras, así que el layout deja de suspender. Coste: cambia todas las URL
   y el proxy.

Mientras ninguno esté hecho, este archivo se queda.

## Lo que se escapó

Retirar los `loading.tsx` no bastó. Quedaron dos `<Suspense>` escritos a mano
que hacían exactamente lo mismo:

- `app/(app)/feed/page.tsx` — alrededor de la lista de posts.
- `app/(app)/post/[id]/page.tsx` — alrededor del hilo entero.

El síntoma, medido en el navegador antes de quitarlos:

```
textarea   display=inline-block   0x0
form                              0x0
div.hilo   display=flex           0x0
div  []    display=none      ←  todo el contenido, aquí dentro
body                          1280x720
```

En el feed, `main` medía 1280x**166** —la cabecera y las pestañas— y los
`<article>` de los posts medían **0x0**. Es decir: la pantalla principal de
Darma no enseñaba ni una publicación, y el hilo no dejaba responder. Después de
quitarlos: `main` 1272x**1027** y cuatro artículos de 648x206.

Cómo se encontró, otra vez: **recorriendo la app a mano**. `tsc`, el lint y las
1.233 pruebas seguían en verde. La pista fue que `/publicar` —la única de las
tres rutas SIN `<Suspense>`— era la única que respondía a los clics.

Si sospechas de esto en una ruta nueva, la comprobación es de diez segundos en
la consola del navegador:

```js
document.querySelectorAll('article').length          // ¿hay contenido?
document.querySelector('article').getBoundingClientRect()   // ¿mide 0x0?
```

Un elemento con texto, `visibility: visible` y tamaño cero significa que tiene
un ancestro con `display: none`. Sube por `parentElement` hasta encontrarlo: si
es un `div` sin clase colgando de `<body>`, es esto.
