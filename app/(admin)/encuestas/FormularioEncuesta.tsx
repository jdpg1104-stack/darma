'use client'

// ============================================================================
// La ÚNICA pieza de cliente de esta pantalla (CONTRATOS §1: `'use client'` en
// la hoja más pequeña posible del árbol). La página y la lista de encuestas
// recientes se renderizan en el servidor y envían 0 bytes de JS.
//
// ── ESTE FORMULARIO NO AUTORIZA NADA ──────────────────────────────────────
// Que exista en el DOM no significa que quien lo tenga delante pueda publicar.
// La decisión la toma `POST /api/polls/crear` con el guard de B19 y, dentro de
// Postgres, `crear_encuesta()`. Quien invoque el `fetch` desde la consola se
// encontrará el mismo `sin_permiso`.
//
// ── LOS LÍMITES SE IMPORTAN, NO SE TECLEAN ────────────────────────────────
// `maxLength` sale de `lib/polls/limites.ts`, que es el espejo de los CHECK de
// Postgres. Un `maxLength={200}` escrito a mano aquí es el tercer sitio donde
// vive el mismo número y el primero que alguien olvidará actualizar.
//
// ── POR QUÉ LA RESPUESTA DE CRISIS SE PINTA AQUÍ ──────────────────────────
// CONTRATOS §9.1: los recursos se muestran EN LA MISMA RESPUESTA, no en un
// correo diferido ni en la pantalla siguiente. Quien escribe una encuesta con
// señales de crisis puede estar hablando de sí mismo, tenga el rol que tenga.
// ============================================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Boton } from '@/components/ui'
// El traductor de CLIENTE. El proveedor lo monta `app/layout.tsx`; aquí solo se
// consume. `obtenerTraductor()` de `@/i18n` necesita el locale de la petición y
// no lo hay en el navegador.
import { useTraductor } from '@/i18n/Proveedor'
import {
  OPCIONES_MIN,
  OPCION_MAX,
  PREGUNTA_MAX,
  MIN_REVELACION_POR_DEFECTO,
} from '@/lib/polls/limites'
// De `limites.ts` y NUNCA de `dominio.ts`: ese módulo importa el guard de roles
// y, tras él, el cliente `service_role`. Un `'use client'` que lo importara
// metería la llave maestra del anonimato en el bundle del navegador. La
// cabecera de `app/api/polls/crear/limites.ts` explica por qué existe ese
// archivo y qué se puede poner dentro.
import {
  CASILLAS_FORMULARIO as CASILLAS,
  MIN_REVELACION_SUELO,
  MIN_REVELACION_TECHO,
} from '@/app/api/polls/crear/limites'

interface RecursoAyuda {
  nombre: string
  telefono?: string
  url?: string
  horario: string
}

interface Creada {
  id: string
  publicada: boolean
  ayuda?: { mensaje: string; recursos: RecursoAyuda[] }
}

type Resultado = { tipo: 'ok'; datos: Creada } | { tipo: 'error'; mensaje: string } | null

export function FormularioEncuesta() {
  const t = useTraductor()
  const [pregunta, setPregunta] = useState('')
  const [opciones, setOpciones] = useState<string[]>(Array(CASILLAS).fill(''))
  const [idioma, setIdioma] = useState<'es' | 'en'>('es')
  const [umbral, setUmbral] = useState(MIN_REVELACION_POR_DEFECTO)
  const [resultado, setResultado] = useState<Resultado>(null)
  const [pendiente, iniciar] = useTransition()
  const router = useRouter()

  const rellenas = opciones.map((o) => o.trim()).filter((o) => o.length > 0)
  const listo = pregunta.trim().length >= 5 && rellenas.length >= OPCIONES_MIN

  function cambiarOpcion(indice: number, valor: string) {
    setOpciones((previas) => previas.map((o, i) => (i === indice ? valor : o)))
  }

  function enviar() {
    iniciar(async () => {
      setResultado(null)
      try {
        const respuesta = await fetch('/api/polls/crear', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Se envía EXACTAMENTE lo que el esquema `.strict()` acepta. Mandar
          // un campo de más aquí sería un 422 en el mejor caso.
          body: JSON.stringify({
            pregunta: pregunta.trim(),
            opciones: rellenas,
            idioma,
            minRevelacion: umbral,
          }),
        })
        const cuerpo: unknown = await respuesta.json()
        const sobre = cuerpo as { ok?: boolean; data?: Creada; message?: string }

        if (respuesta.ok && sobre.ok === true && sobre.data) {
          setResultado({ tipo: 'ok', datos: sobre.data })
          setPregunta('')
          setOpciones(Array(CASILLAS).fill(''))
          router.refresh()
          return
        }
        // El `message` del servidor ya viene redactado para el público: no
        // lleva stack, ni SQL, ni nombre de tabla (CONTRATOS §4).
        setResultado({
          tipo: 'error',
          mensaje: sobre.message ?? t('admin.encuestas.formulario.errorCrear'),
        })
      } catch {
        setResultado({
          tipo: 'error',
          mensaje: t('admin.encuestas.formulario.errorConexion'),
        })
      }
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        enviar()
      }}
    >
      <p>
        <label htmlFor="pregunta">{t('admin.encuestas.formulario.pregunta')}</label>
        <br />
        <textarea
          id="pregunta"
          value={pregunta}
          maxLength={PREGUNTA_MAX}
          rows={2}
          required
          onChange={(e) => setPregunta(e.target.value)}
          placeholder={t('admin.encuestas.formulario.preguntaEjemplo')}
        />
        <br />
        <small>
          {pregunta.trim().length} / {PREGUNTA_MAX}.{' '}
          {t('admin.encuestas.formulario.ayudaPregunta')}
        </small>
      </p>

      <fieldset>
        <legend>
          {t('admin.encuestas.formulario.opcionesLeyenda', {
            min: OPCIONES_MIN,
            max: CASILLAS,
          })}
        </legend>
        {opciones.map((valor, i) => (
          <p key={i}>
            <label htmlFor={`opcion-${i}`}>
              {i < OPCIONES_MIN
                ? t('admin.encuestas.formulario.opcion', { n: i + 1 })
                : t('admin.encuestas.formulario.opcionOpcional', { n: i + 1 })}
            </label>
            <br />
            <input
              id={`opcion-${i}`}
              value={valor}
              maxLength={OPCION_MAX}
              onChange={(e) => cambiarOpcion(i, e.target.value)}
            />
          </p>
        ))}
        <small>{t('admin.encuestas.formulario.ayudaOpciones')}</small>
      </fieldset>

      <p>
        <label htmlFor="idioma">{t('comun.idioma')}</label>
        <br />
        <select
          id="idioma"
          value={idioma}
          onChange={(e) => setIdioma(e.target.value === 'en' ? 'en' : 'es')}
        >
          <option value="es">{t('comun.idiomaEspanol')}</option>
          <option value="en">{t('comun.idiomaIngles')}</option>
        </select>
        <br />
        <small>{t('admin.encuestas.formulario.ayudaIdioma')}</small>
      </p>

      <p>
        <label htmlFor="umbral">{t('admin.encuestas.formulario.umbral')}</label>
        <br />
        <input
          id="umbral"
          type="number"
          value={umbral}
          min={MIN_REVELACION_SUELO}
          max={MIN_REVELACION_TECHO}
          onChange={(e) => setUmbral(Number(e.target.value))}
        />
        <br />
        <small>{t('admin.encuestas.formulario.ayudaUmbral')}</small>
      </p>

      {/* `type="submit"` explícito: `Boton` pone `type="button"` por defecto a
          propósito, así que sin esto el formulario no se envía nunca. */}
      <Boton variante="primario" type="submit" cargando={pendiente} disabled={!listo}>
        {t('admin.encuestas.formulario.publicar')}
      </Boton>

      {resultado?.tipo === 'error' && <p role="alert">{resultado.mensaje}</p>}

      {resultado?.tipo === 'ok' && (
        <div role="status">
          {resultado.datos.publicada ? (
            <p>{t('admin.encuestas.formulario.okPublicada')}</p>
          ) : (
            <p>
              {t('admin.encuestas.formulario.okGuardada1')}{' '}
              <strong>{t('admin.encuestas.formulario.okGuardada2')}</strong>
              {t('admin.encuestas.formulario.okGuardada3')}
            </p>
          )}

          {resultado.datos.ayuda && (
            <aside>
              <p>{resultado.datos.ayuda.mensaje}</p>
              <ul>
                {resultado.datos.ayuda.recursos.map((r) => (
                  <li key={r.nombre}>
                    <strong>{r.nombre}</strong>
                    {r.telefono ? ` · ${r.telefono}` : ''}
                    {r.url ? (
                      <>
                        {' · '}
                        <a href={r.url} rel="noreferrer noopener" target="_blank">
                          {r.url}
                        </a>
                      </>
                    ) : null}
                    {` · ${r.horario}`}
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}
    </form>
  )
}
