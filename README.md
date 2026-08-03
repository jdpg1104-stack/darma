# Darma

**Una red social anónima donde escuchar es lo que da derecho a hablar.**

Sin foto, sin nombre real, sin voz. Acompañas a tres personas y desbloqueas tu
turno de contar lo tuyo.

En casi toda red social hablar es gratis y escuchar es opcional. Aquí es al
revés, y esa inversión no es una norma de la comunidad que alguien pueda
saltarse: **es un trigger de Postgres**, dentro de la misma transacción que
escribe la publicación. Si no has escuchado, la fila no llega a existir.

> ⚠️ **Este proyecto todavía no está en producción.** Hay un bloqueo deliberado
> que lo impide, explicado en [Estado](#estado).

---

## La idea en un minuto

Tres niveles de participación, y se entra por el más fácil:

| | Nivel | Qué pide |
|---|---|---|
| **01** | **Ánimo** | Nada. Lees contenido de bienestar y descubres la comunidad. |
| **02** | **Escucha** | Respondes de verdad a quien se ha desahogado. Cada respuesta validada suma un crédito. |
| **03** | **Apoyo** | Tres créditos abren tu turno de hablar. Tu primera vez es gratis. |

El karma no se compra nunca. Se gana escuchando, y el dinero solo alcanza para
estética y visibilidad — jamás prioridad de escucha ni sitio en la cola de
crisis. Hay un test que recorre todo el código de pago buscando la función que
otorga karma y **rompe el CI si aparece**.

---

## Por qué puede interesarte el código

La decisión que gobierna todo lo demás: **la autoridad vive en Postgres, no en
la aplicación.**

Cualquiera puede hablar con PostgREST directamente usando la clave anónima, que
es pública por diseño. Un control que solo exista en una ruta de Next se salta
con un `curl`. Así que las reglas del producto están donde no se pueden
esquivar:

- **La reciprocidad 3:1** es un trigger `BEFORE INSERT` que descuenta el crédito
  con el mismo `UPDATE ... RETURNING` que lo comprueba. Dos peticiones
  simultáneas no pueden gastar el mismo crédito.
- **El karma** solo se mueve por una función `security definer` con tope diario
  e idempotencia. `authenticated` no tiene privilegio de escritura sobre esas
  columnas.
- **La identidad real** vive en `identity_vault`, una tabla **sin ninguna
  política RLS** — o sea, denegada para todo el mundo salvo `service_role`. Ni
  un fallo en la API puede leerla.
- **RLS decide filas; los privilegios de columna deciden columnas.** Es la
  distinción que costó la mayoría de los fallos de seguridad de este proyecto, y
  está anotada en cada migración.

Si te interesa cómo se rompe esto en la práctica, la sección
[Lo que se rompió](#lo-que-se-rompió-por-el-camino) es la parte honesta.

---

## Puesta en marcha

Necesitas Node 24+ y una cuenta de [Supabase](https://supabase.com) (el plan
gratuito sirve para desarrollo).

```bash
git clone https://github.com/jdpg1104-stack/darma.git
cd darma
npm install
cp .env.example .env.local
```

Rellena `.env.local` con los valores de tu proyecto. La
`SUPABASE_SERVICE_ROLE_KEY` se copia a mano desde el panel de Supabase
(Settings → API): **es la única clave capaz de leer `identity_vault`**, así que
no debería pasar por ningún canal automatizado.

Aplica el esquema y arranca:

```bash
npx supabase link --project-ref <tu-proyecto>
npx supabase db push
npm run dev            # http://localhost:3000
```

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | `tsc --noEmit` — debe salir limpio siempre |
| `npm run lint` | ESLint 9 (flat config) |
| `npm test` | 1.209 pruebas con el runner nativo de Node |
| `npm run db:push` | Aplica las migraciones |

### Contribuir

`main` rechaza los pushes directos: el flujo es rama → PR → CI en verde →
fusionar. Hay además un hook local que verifica antes de publicar; se activa en
cada clon con:

```bash
git config core.hooksPath .githooks
```

---

## Stack

| Pieza | Elección |
|---|---|
| Framework | Next.js 16 (App Router, Server Components por defecto) |
| UI | React 19 |
| Estilos | Tailwind v4 y tokens CSS propios, sin librería de componentes |
| Datos y auth | Supabase — Postgres, RLS y Auth |
| Lenguaje | TypeScript estricto, sin un solo `any` |
| Idiomas | Español e inglés, con guard de paridad en CI |
| Despliegue | Vercel, región `fra1` |

Cero terceros en el navegador: sin fuentes de Google, sin analítica, sin SDKs
sociales. La CSP los bloquea a propósito. **Si añades una integración y «no
carga pero tampoco da error», mira la CSP en `next.config.ts` antes que el
código.**

---

## Mapa del repositorio

```
app/                    Rutas (App Router)
  ayuda/                Recursos de crisis · pública, sin sesión, sin JS de cliente
  (app)/                Todo lo que hay tras la sesión
  (admin)/              Centro de mando y cola de moderación
  (legal)/              Privacidad, retención, menores, «esto no es terapia»
lib/                    Dominio: karma, ranking, crisis, cripto, billing, crons
components/             UI por área (feed, hilo, perfil, refugios, economía…)
i18n/                   Catálogos y recursos de crisis POR PAÍS
supabase/migrations/    El esquema. La fuente de verdad de las reglas
e2e/                    94 recorridos de Playwright
HANDOFF/                Cómo se construyó, y cómo seguir construyéndolo
```

---

## Cuatro decisiones que conviene entender antes de tocar nada

**1. El país y el idioma son ejes distintos.** Los teléfonos de ayuda se indexan
por país, nunca por idioma: un hispanohablante en Estados Unidos necesita el
988, no el 024. `recursosParaPais()` rechaza un locale *en tiempo de tipos*.

**2. La detección de crisis solo escala, nunca descarta.** El nivel de riesgo es
un suelo, no un veredicto: puede subirlo el clasificador, un reporte o un
moderador, y no existe ninguna función que lo baje automáticamente. Los umbrales
están calibrados hacia el lado ruidoso a propósito — un falso positivo enseña
recursos a quien hoy no los necesitaba; un falso negativo es alguien que pidió
ayuda como pudo y no se la dimos.

**3. Los refugios van cifrados de extremo a extremo, con lo que eso implica.**
Perder el móvil es perder el historial, y la pantalla lo dice **antes** de
enseñar la frase de recuperación. Cualquier alternativa —recuperar por correo,
por soporte— obliga a que Darma pueda leer las conversaciones.

**4. Nada de `console.log` con contenido de una persona.** En una app anónima un
log despistado vuelca un desahogo a los registros del proveedor.

Todo esto, con su porqué, en [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Cómo se construyó

El proyecto se levantó con **veinte bloques de trabajo en paralelo**, cada uno
dueño exclusivo de unos directorios y coordinados por contratos escritos por
adelantado en [`HANDOFF/`](./HANDOFF/). La regla que lo sostiene:

> Cada archivo tiene exactamente un dueño. Cuando dos sesiones editan el mismo
> archivo, el problema no es el merge: es que la segunda revierte decisiones de
> la primera sin enterarse.

- [`HANDOFF/README.md`](./HANDOFF/README.md) — las reglas y las cuatro olas
- [`HANDOFF/CONTRATOS.md`](./HANDOFF/CONTRATOS.md) — tipos, rutas, economía, presupuestos
- `HANDOFF/B01.md` … `B20.md` — una ficha autocontenida por bloque

---

## Lo que se rompió por el camino

Catorce fallos de seguridad reales, encontrados y cerrados antes de que exista
la primera persona usuaria. Ninguno habría dado la cara en desarrollo. Los tres
que mejor explican el resto:

- **Cualquiera podía meterse solo en un refugio ajeno.** La política decía
  `user_id = auth.uid()`, que leído deprisa parece la comprobación de siempre y
  aquí significa lo contrario. El cifrado no protege de eso: al intruso se le
  entrega su sobre con la clave.
- **La detección de crisis solo entendía la primera persona.** Buscaba
  «suicidarme», no «suicidarse». Pero quien está peor rara vez habla de sí
  mismo: pregunta por «alguien». El caso que más importaba cazar era justo el
  que se escapaba.
- **El botón de crisis llevaba a un 404.** `/ayuda` estaba en el diseño desde el
  principio y no era de ningún bloque. Cada sesión hizo su parte bien y nadie
  tenía asignada la página a la que todas apuntaban.

El último salió recorriendo la app a mano, y de esa misma sesión salió otro que
ningún test veía: **la aplicación se pintaba entera y no respondía a nada**
—hidratación muerta— por una combinación de piezas individualmente correctas.
Está contado en [`app/SIN-LOADING.md`](./app/SIN-LOADING.md).

---

## Estado

Compila, pasa 1.209 pruebas, construye 110 rutas y funciona en dos idiomas. El
bucle completo está verificado contra Postgres: publicar, escuchar, validar,
karma, y el segundo intento de publicar bloqueado.

**Lo que falta antes de que esto pueda usarlo alguien:**

| | |
|---|---|
| 🔴 **Verificar los 24 teléfonos de crisis** | Se escribieron sin confirmarlos con cada organización. `tablaListaParaProduccion()` devuelve `false` y **bloquea el despliegue a propósito**. Un número muerto en esa pantalla es peor que no mostrar ninguno. |
| **Clave del clasificador** | Sin ella la app corre siempre degradada: publica y escala el riesgo, pero nadie gana karma. Coste estimado: ~485 $/día a 100.000 comentarios. |
| **Pruebas de carga** | Escritas, sin ejecutar. Necesitan una base mayor que el plan gratuito. |
| **Revisión legal** | Menores, retención y política de borrado. |

Lo pendiente, con quién lo pidió y por qué, está en
[`HANDOFF/PEDIDOS.md`](./HANDOFF/PEDIDOS.md).

---

## Aviso

Darma es **apoyo entre iguales, no atención sanitaria**. No sustituye a la
terapia y no puede atender una urgencia.

Si estás pasando por un momento difícil, habla con alguien ahora: en España, el
**024** (Línea de Atención a la Conducta Suicida, gratuito, 24 h). En otros
países, [findahelpline.com](https://findahelpline.com).
