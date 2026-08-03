'use client'

// ============================================================================
// Onboarding en 3 pasos — la única hoja de cliente de /onboarding
//
// ── POR QUÉ LOS CANDIDATOS VIENEN DEL SERVIDOR ─────────────────────────────
// El botón «otro» tiene que regenerar el alias SIN ir al servidor: es el gesto
// que la gente repite cinco o seis veces hasta que uno le gusta, y una ida y
// vuelta por cada pulsación lo convierte en algo lento y en una ruta más que
// limitar. Pero `lib/anonymity.ts` importa `node:crypto` (la semilla se genera
// con un CSPRNG, no con Math.random), así que no puede entrar en el bundle.
//
// La salida es que el Server Component genere una tanda de candidatos y este
// componente vaya pasando por ellos en memoria. Cero peticiones, y las
// semillas siguen saliendo de un generador criptográfico.
//
// ── entry_level NO ES UN PERMISO ───────────────────────────────────────────
// El paso 2 elige por dónde empezar, no lo que se puede hacer. Quien elija
// «Ánimo» y mañana quiera publicar podrá, sin rehacer nada: el único gate real
// de publicación es el trigger de reciprocidad en Postgres. El texto de la
// pantalla está escrito para que eso se note y nadie se sienta encasillado.
// ============================================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Respuesta } from '@/lib/auth/respuestas'
import { AvatarSemilla } from './AvatarSemilla'

export interface Candidato {
  alias: string
  avatarSeed: string
}

type NivelEntrada = 'animo' | 'escucha' | 'apoyo'

const NIVELES: readonly { valor: NivelEntrada; titulo: string; descripcion: string }[] = [
  {
    valor: 'animo',
    titulo: 'Ánimo',
    descripcion: 'Solo quiero ver contenido que me siente bien. Sin escribir nada todavía.',
  },
  {
    valor: 'escucha',
    titulo: 'Escucha',
    descripcion: 'Quiero leer a otras personas y acompañarlas en los comentarios.',
  },
  {
    valor: 'apoyo',
    titulo: 'Apoyo',
    descripcion: 'Vengo a contar lo que me pasa. Aquí se publica después de haber escuchado.',
  },
]

const TOTAL_PASOS = 3

export function AsistenteOnboarding({ candidatos }: { candidatos: readonly Candidato[] }) {
  const router = useRouter()

  const [paso, setPaso] = useState(1)
  const [indice, setIndice] = useState(0)
  const [alias, setAlias] = useState(candidatos[0]?.alias ?? '')
  const [nivel, setNivel] = useState<NivelEntrada>('escucha')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const semilla = candidatos[indice]?.avatarSeed ?? ''

  function otroAlias() {
    const siguiente = (indice + 1) % Math.max(candidatos.length, 1)
    setIndice(siguiente)
    setAlias(candidatos[siguiente]?.alias ?? '')
    setError(null)
  }

  async function comprobarYAvanzar() {
    setError(null)
    setOcupado(true)
    try {
      const respuesta = await fetch(`/api/auth/alias-libre?alias=${encodeURIComponent(alias.trim())}`)
      const cuerpo = (await respuesta.json()) as Respuesta<{ libre: boolean }>

      if (!cuerpo.ok) {
        setError(cuerpo.message)
        return
      }
      if (!cuerpo.data.libre) {
        setError('Ese alias ya está cogido. Pulsa «otro» y te proponemos uno libre.')
        return
      }
      setPaso(2)
    } catch {
      setError('No hemos podido comprobarlo. Revisa tu conexión.')
    } finally {
      setOcupado(false)
    }
  }

  async function crearPerfil() {
    setError(null)
    setOcupado(true)
    try {
      const respuesta = await fetch('/api/auth/perfil', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alias: alias.trim(), avatarSeed: semilla, entryLevel: nivel }),
      })
      const cuerpo = (await respuesta.json()) as Respuesta<unknown>

      if (!cuerpo.ok) {
        setError(cuerpo.message)
        // Una colisión de alias devuelve al paso 1, que es donde se arregla.
        if (cuerpo.code === 'entrada_invalida') setPaso(1)
        return
      }

      router.refresh()
      router.push('/feed')
    } catch {
      setError('No hemos podido crear tu identidad. Revisa tu conexión.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="card fade-in" style={{ display: 'grid', gap: 20 }}>
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="chip" style={{ justifySelf: 'start' }}>
          Paso {paso} de {TOTAL_PASOS}
        </span>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_PASOS}
          aria-valuenow={paso}
          aria-label="Progreso del onboarding"
          style={{ height: 4, borderRadius: 999, background: 'var(--panel2)' }}
        >
          <div
            style={{
              width: `${(paso / TOTAL_PASOS) * 100}%`,
              height: '100%',
              borderRadius: 999,
              background: 'var(--accent)',
            }}
          />
        </div>
      </header>

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--line)',
            background: 'var(--panel2)',
            lineHeight: 1.45,
          }}
        >
          {error}
        </p>
      )}

      {paso === 1 && (
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ fontSize: 24, margin: 0, lineHeight: 1.25 }}>Elige cómo te llamamos</h1>
            <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              Este seudónimo y este avatar son lo único que verán los demás. No hay fotos en
              Darma, ni las habrá.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <AvatarSemilla semilla={semilla} tamano={72} />
            <div style={{ display: 'grid', gap: 8, flex: 1 }}>
              <label htmlFor="alias" className="sr-only">
                Tu alias
              </label>
              <input
                id="alias"
                value={alias}
                maxLength={24}
                autoComplete="off"
                onChange={(evento) => setAlias(evento.target.value)}
                style={{
                  minHeight: 'var(--touch)',
                  padding: '0 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--line)',
                  background: 'var(--panel2)',
                  color: 'var(--ink)',
                  font: 'inherit',
                  fontWeight: 700,
                }}
              />
              <button type="button" className="btn btn--ghost" onClick={otroAlias}>
                Otro
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn--primary"
            onClick={comprobarYAvanzar}
            disabled={ocupado || alias.trim().length < 3}
          >
            {ocupado ? 'Comprobando…' : 'Continuar'}
          </button>
        </section>
      )}

      {paso === 2 && (
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ fontSize: 24, margin: 0, lineHeight: 1.25 }}>¿Por dónde empezamos?</h1>
            <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              Solo es el punto de partida. Puedes cambiarlo cuando quieras y nada te queda
              cerrado por elegir una cosa u otra.
            </p>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            <legend className="sr-only">Cómo quieres empezar</legend>
            {NIVELES.map((opcion) => (
              <label
                key={opcion.valor}
                style={{
                  display: 'grid',
                  gap: 4,
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${nivel === opcion.valor ? 'var(--accent)' : 'var(--line)'}`,
                  background: 'var(--panel2)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
                  <input
                    type="radio"
                    name="nivel"
                    value={opcion.valor}
                    checked={nivel === opcion.valor}
                    onChange={() => setNivel(opcion.valor)}
                  />
                  {opcion.titulo}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.45 }}>
                  {opcion.descripcion}
                </span>
              </label>
            ))}
          </fieldset>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn--ghost" onClick={() => setPaso(1)}>
              Atrás
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setPaso(3)}
              style={{ flex: 1 }}
            >
              Continuar
            </button>
          </div>
        </section>
      )}

      {paso === 3 && (
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ fontSize: 24, margin: 0, lineHeight: 1.25 }}>Esto es todo lo que verán</h1>
            <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              Ni tu nombre, ni tu correo, ni tu ciudad. Solo esto.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 14,
              alignItems: 'center',
              padding: 16,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--line)',
              background: 'var(--panel2)',
            }}
          >
            <AvatarSemilla semilla={semilla} tamano={56} />
            <div style={{ display: 'grid', gap: 2 }}>
              <strong style={{ fontSize: 17 }}>{alias.trim()}</strong>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>
                Semilla · empiezas por {NIVELES.find((n) => n.valor === nivel)?.titulo}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn--ghost" onClick={() => setPaso(2)} disabled={ocupado}>
              Atrás
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={crearPerfil}
              disabled={ocupado}
              style={{ flex: 1 }}
            >
              {ocupado ? 'Creando…' : 'Entrar en Darma'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
