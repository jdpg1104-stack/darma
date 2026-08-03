import type { Metadata } from 'next'

import { resolverPais } from '@/i18n/pais'
import {
  recursosParaPais,
  tablaListaParaProduccion,
  type RecursoCrisis,
} from '@/i18n/recursosCrisis'

import estilos from './ayuda.module.css'

// ============================================================================
// /ayuda — la pantalla a la que lleva el botón de crisis.
//
// Es la página más importante de Darma y la que más restricciones tiene, todas
// por el mismo motivo: quien llega aquí puede estar en el peor momento de su
// vida, con prisa, con el móvil casi sin batería, con mala cobertura o con las
// manos temblando.
//
// De ahí las cinco decisiones que la gobiernan:
//
//  1. **Server Component sin una línea de JavaScript de cliente.** Nada que
//     hidratar, nada que pueda fallar. Los teléfonos son enlaces `tel:` y
//     funcionan aunque el bundle no llegue nunca.
//  2. **Pública en el proxy.** Nadie en riesgo debe toparse con un muro de
//     login. Esta ruta se declara en `PUBLIC_ROUTES` por razones que no son
//     técnicas.
//  3. **Los números primero.** Sin cabecera de marca, sin navegación, sin
//     tarjeta de bienvenida. Lo primero que se ve al abrir es un número al que
//     llamar. Todo lo demás va debajo.
//  4. **Nunca una pantalla vacía.** `recursosParaPais()` jamás devuelve una
//     lista vacía: si el país es desconocido cae al bloque internacional. Un
//     callejón sin salida aquí es inaceptable, y el número de otro país es
//     peor que ninguno.
//  5. **Se dice la verdad sobre la fiabilidad del dato.** Mientras
//     `tablaListaParaProduccion()` sea falso, la página avisa de que los
//     números no están confirmados uno a uno y de que si uno no responde hay
//     que probar el siguiente. Ocultarlo sería peor: alguien podría llamar,
//     encontrarse un número muerto y concluir que no hay nadie al otro lado.
//
// Esta página existía en el diseño desde el principio, pero no era de ningún
// bloque, así que no la escribió nadie: durante toda la construcción el botón
// de crisis llevó a un 404. Lo destapó el recorrido E2E. Si algún día se
// reparte de nuevo el trabajo, que esta ruta tenga dueño explícito.
// ============================================================================

export const metadata: Metadata = {
  title: 'Ayuda ahora · Darma',
  description: 'Teléfonos y recursos de ayuda si estás pasando por un momento difícil.',
  robots: { index: true, follow: true },
}

// Sin caché: el país sale de la petición, y una respuesta cacheada podría
// enseñarle a alguien los teléfonos de otro país.
export const dynamic = 'force-dynamic'

function esTelefono(r: RecursoCrisis): boolean {
  return r.tipo === 'telefono' || r.tipo === 'emergencias' || r.tipo === 'sms'
}

/** `tel:` para lo marcable, `sms:` para los de texto, la URL tal cual para el resto. */
function enlaceDe(r: RecursoCrisis): string {
  if (r.tipo === 'sms') return `sms:${r.valor}`
  if (esTelefono(r)) return `tel:${r.valor}`
  return r.valor
}

export default async function PaginaAyuda() {
  const pais = await resolverPais()
  const { pais: paisMostrado, recursos } = recursosParaPais(pais)
  const verificados = tablaListaParaProduccion()

  // Emergencias primero, siempre: si alguien está en peligro inmediato, el
  // número que necesita no es el de una línea de escucha.
  const ordenados = [...recursos].sort((a, b) => {
    if (a.tipo === 'emergencias' && b.tipo !== 'emergencias') return -1
    if (b.tipo === 'emergencias' && a.tipo !== 'emergencias') return 1
    return 0
  })

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Si lo estás pasando mal, habla con alguien ahora</h1>
      <p className={estilos.entrada}>
        Estas líneas están atendidas por personas preparadas para escucharte. Son
        gratuitas y confidenciales. No hace falta que sepas explicar lo que te pasa
        para llamar.
      </p>

      <ul className={estilos.lista}>
        {ordenados.map((r) => (
          <li key={`${r.tipo}-${r.valor}`} className={estilos.recurso}>
            <a
              className={r.tipo === 'emergencias' ? estilos.enlaceUrgente : estilos.enlace}
              href={enlaceDe(r)}
              {...(esTelefono(r) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            >
              <span className={estilos.valor}>{r.valor}</span>
              <span className={estilos.nombre}>{r.nombre}</span>
            </a>
            <p className={estilos.detalle}>
              {r.horario === '24/7' ? 'Disponible 24 horas, todos los días' : r.horario}
              {r.gratuito ? ' · Llamada gratuita' : ''}
              {r.idiomasAtencion.length > 0 ? ` · Atienden en ${r.idiomasAtencion.join(', ')}` : ''}
            </p>
          </li>
        ))}
      </ul>

      {paisMostrado === 'INTERNACIONAL' ? (
        <p className={estilos.nota}>
          No hemos podido saber desde qué país escribes, así que estos son recursos
          internacionales. <b>Si estás en peligro ahora mismo, llama al número de
          emergencias de tu país.</b>
        </p>
      ) : null}

      {!verificados ? (
        <p className={estilos.aviso}>
          Estamos terminando de confirmar uno a uno estos números con cada
          organización. Si alguno no responde, prueba con el siguiente de la lista
          o con el número de emergencias de tu país.
        </p>
      ) : null}

      <hr className={estilos.separador} />

      <section className={estilos.limite}>
        <h2 className={estilos.subtitulo}>Darma no sustituye a la terapia</h2>
        <p>
          Aquí te escuchan personas que han pasado por cosas parecidas, y eso vale
          mucho. Pero no somos profesionales de la salud mental y no podemos
          atender una urgencia. Si estás en riesgo, llama a uno de los números de
          arriba: al otro lado hay alguien formado para ayudarte, ahora.
        </p>
      </section>

      <a className={estilos.volver} href="/feed">
        Volver
      </a>
    </main>
  )
}
