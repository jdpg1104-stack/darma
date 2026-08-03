/* ===========================================================================
 * Darma · service worker
 *
 * JavaScript plano: este archivo NO pasa por el bundler y lo sirve `public/`
 * tal cual. Nada de imports, nada de sintaxis que un navegador de hace dos años
 * no entienda.
 *
 * ── LAS CUATRO REGLAS DE ESTE ARCHIVO ──────────────────────────────────────
 *
 * 1. `/ayuda` VA EN EL PRECACHE. Los recursos de crisis tienen que funcionar
 *    sin red. Una persona en riesgo puede abrir la app en un sótano, en un tren
 *    o con el saldo agotado, y encontrarse una pantalla de «sin conexión» en vez
 *    de un teléfono al que llamar es el peor fallo que puede tener esta app.
 *
 * 2. NUNCA SE CACHEA NADA BAJO `/api/`. Dos motivos, y el segundo es el grave:
 *    (a) servir un feed cacheado sirve desahogos rancios; (b) si dos personas
 *    usan el mismo dispositivo —cosa habitual en una app de apoyo emocional— la
 *    respuesta cacheada del feed de una se le serviría a la otra. Contenido
 *    ajeno en el disco de esta persona. El `fetch` handler descarta esas
 *    peticiones ANTES de mirar nada más.
 *
 * 3. UN EVENTO `push` SIEMPRE MUESTRA UNA NOTIFICACIÓN. Si llega un `push` y no
 *    se llama a `showNotification`, Chrome cuenta un «push silencioso» y tras
 *    unos pocos REVOCA el permiso del origen. Por eso la decisión de callar
 *    (agrupación, horas de silencio, techo diario) se toma EN EL SERVIDOR
 *    —`decidirEnvio()` en lib/push/horario.ts— y aquí no se decide nada: si
 *    llegó, se muestra.
 *
 * 4. LA CACHÉ ESTÁ VERSIONADA Y LAS VIEJAS SE BORRAN. Sin esto, alguien se
 *    queda con el shell de hace tres meses y no hay forma de sacarlo de ahí sin
 *    que borre los datos del sitio a mano.
 * ======================================================================== */

'use strict'

/* Subir este número invalida el shell de todo el mundo en el siguiente
 * `activate`. Cámbialo cuando cambie algo del precache. */
const CACHE = 'darma-v1'

/* El shell mínimo. Corto a propósito: cada entrada es una descarga obligatoria
 * en la primera visita, y la lista larga es la que hace que la instalación
 * falle entera por un recurso que se renombró. */
const PRECACHE = [
  '/',
  '/feed',
  '/ayuda', // ← recursos de crisis. No lo quites de aquí.
  '/offline',
  '/manifest.json',
]

/* ── install ─────────────────────────────────────────────────────────────── */
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      /* Una a una y tolerando fallos: con `cache.addAll` basta que UNA ruta
       * devuelva 404 para que la instalación entera se aborte, y entonces
       * `/ayuda` tampoco queda cacheada. Aquí, si algo falla, el resto entra. */
      await Promise.all(
        PRECACHE.map(async (ruta) => {
          try {
            const respuesta = await fetch(ruta, { credentials: 'same-origin' })
            if (respuesta.ok) await cache.put(ruta, respuesta)
          } catch (_) {
            /* Sin red durante la instalación: se reintenta en el próximo
             * arranque. No se propaga. */
          }
        }),
      )
      /* Activar de inmediato: el shell nuevo debe sustituir al viejo sin
       * esperar a que se cierren todas las pestañas. */
      await self.skipWaiting()
    })(),
  )
})

/* ── activate ────────────────────────────────────────────────────────────── */
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(
        nombres.map((nombre) => (nombre === CACHE ? null : caches.delete(nombre))),
      )
      await self.clients.claim()
    })(),
  )
})

/* ── message · borrado de caché al cerrar sesión ─────────────────────────── */
/* B01 debe enviar `{tipo:'darma:logout'}` al cerrar sesión (pedido anotado en
 * HANDOFF/PEDIDOS.md). Sin esto, el shell cacheado de una cuenta sigue vivo
 * cuando otra persona entra en el mismo dispositivo. */
self.addEventListener('message', (evento) => {
  const dato = evento.data
  if (!dato || dato.tipo !== 'darma:logout') return
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(nombres.map((nombre) => caches.delete(nombre)))
    })(),
  )
})

/* ── fetch ───────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (evento) => {
  const peticion = evento.request

  /* Solo GET. Un POST cacheado no tiene sentido y `cache.put` lo rechaza. */
  if (peticion.method !== 'GET') return

  const url = new URL(peticion.url)

  /* Solo nuestro origen. Lo de fuera pasa de largo sin tocarse. */
  if (url.origin !== self.location.origin) return

  /* ⛔ REGLA 2: `/api/**` no se cachea NUNCA, ni se lee de caché. Va primero,
   * antes que cualquier otra rama, para que ningún camino posterior pueda
   * alcanzarlo por accidente. */
  if (url.pathname.startsWith('/api/')) return

  /* Navegación: red primero (el contenido de Darma cambia constantemente), con
   * caída a la caché y, en último término, a `/offline`. */
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        try {
          const respuesta = await fetch(peticion)
          if (respuesta.ok) {
            const cache = await caches.open(CACHE)
            cache.put(peticion, respuesta.clone())
          }
          return respuesta
        } catch (_) {
          return (
            (await caches.match(peticion)) ||
            /* `/ayuda` sale de aquí cuando no hay red: está en el precache. */
            (await caches.match(url.pathname)) ||
            (await caches.match('/offline')) ||
            new Response('Sin conexión', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          )
        }
      })(),
    )
    return
  }

  /* Estáticos: stale-while-revalidate. Se responde con lo que haya y se
   * refresca por detrás. */
  if (url.pathname.startsWith('/_next/static/') || /\.(css|js|woff2|svg|png|ico)$/.test(url.pathname)) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const cacheada = await cache.match(peticion)

        const red = fetch(peticion)
          .then((respuesta) => {
            if (respuesta.ok) cache.put(peticion, respuesta.clone())
            return respuesta
          })
          .catch(() => cacheada)

        return cacheada || red
      })(),
    )
  }
})

/* ── push ────────────────────────────────────────────────────────────────── */
self.addEventListener('push', (evento) => {
  evento.waitUntil(
    (async () => {
      /* Valores por defecto para el caso de una carga ilegible. REGLA 3: hay
       * que mostrar algo sí o sí, así que se muestra lo mínimo en vez de no
       * mostrar nada. */
      let carga = { tipo: 'te_escucharon', titulo: 'Darma', cuerpo: 'Tienes algo nuevo.', url: '/feed' }

      try {
        if (evento.data) {
          const dato = evento.data.json()
          if (dato && typeof dato === 'object') {
            carga = {
              tipo: typeof dato.tipo === 'string' ? dato.tipo : carga.tipo,
              titulo: typeof dato.titulo === 'string' ? dato.titulo : carga.titulo,
              cuerpo: typeof dato.cuerpo === 'string' ? dato.cuerpo : carga.cuerpo,
              /* Solo rutas internas: una `url` absoluta convertiría un push en
               * un enlace a cualquier sitio. */
              url: typeof dato.url === 'string' && dato.url.startsWith('/') ? dato.url : carga.url,
            }
          }
        }
      } catch (_) {
        /* Carga no-JSON: se muestra el aviso genérico. */
      }

      const esCrisis = carga.tipo === 'alma_afin_en_crisis'

      await self.registration.showNotification(carga.titulo, {
        body: carga.cuerpo,
        /* `tag` por TIPO: el sistema colapsa los del mismo tipo en uno solo, así
         * que la agrupación del servidor se ve reforzada por el propio SO. */
        tag: 'darma-' + carga.tipo,
        renotify: esCrisis,
        /* La crisis es lo único que puede sonar y vibrar. Todo lo demás llega
         * en silencio: el aviso está para que lo veas cuando mires el móvil, no
         * para que lo mires. */
        silent: !esCrisis,
        requireInteraction: esCrisis,
        icon: '/icono-darma.svg',
        badge: '/icono-darma.svg',
        /* `data` lleva SOLO la ruta. Nada de ids ni de alias: lo que no viaja no
         * se puede reconstruir desde el dispositivo. */
        data: { url: carga.url },
      })
    })(),
  )
})

/* ── notificationclick ───────────────────────────────────────────────────── */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const destino = (evento.notification.data && evento.notification.data.url) || '/feed'

  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      /* Enfocar la pestaña que ya está abierta antes que abrir otra: abrir una
       * segunda ventana de Darma encima de la primera deja dos sesiones de la
       * misma persona compitiendo por la misma pantalla. */
      for (const ventana of ventanas) {
        if (new URL(ventana.url).origin === self.location.origin && 'focus' in ventana) {
          await ventana.focus()
          if ('navigate' in ventana) {
            try {
              await ventana.navigate(destino)
            } catch (_) {
              /* Algunos navegadores no permiten `navigate()`; el foco ya se dio. */
            }
          }
          return
        }
      }

      if (self.clients.openWindow) await self.clients.openWindow(destino)
    })(),
  )
})

/* ── pushsubscriptionchange ──────────────────────────────────────────────── */
/* El navegador rota la suscripción sin avisar (actualización, limpieza de datos
 * del sitio, reinstalación de la PWA). Sin re-suscribir aquí, la persona deja
 * de recibir avisos y NO HAY ERROR: solo silencio, que es el fallo más difícil
 * de detectar de todo el bloque. */
self.addEventListener('pushsubscriptionchange', (evento) => {
  evento.waitUntil(
    (async () => {
      try {
        const anterior = evento.oldSubscription
        const clave =
          (evento.newSubscription && evento.newSubscription.options.applicationServerKey) ||
          (anterior && anterior.options && anterior.options.applicationServerKey)

        const nueva =
          evento.newSubscription ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: clave,
          }))

        const json = nueva.toJSON()

        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          }),
        })

        if (anterior && anterior.endpoint && anterior.endpoint !== json.endpoint) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: anterior.endpoint }),
          })
        }
      } catch (_) {
        /* Sin sesión o sin red: el cliente vuelve a intentarlo en el próximo
         * arranque desde `components/pwa/OptInPush.tsx`. */
      }
    })(),
  )
})
