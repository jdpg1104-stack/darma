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
import { traducirCodigoError } from '@/i18n/traductor'
import { useTraductor } from '@/i18n/Proveedor'
import { AvatarSemilla } from './AvatarSemilla'

export interface Candidato {
  alias: string
  avatarSeed: string
}

type NivelEntrada = 'animo' | 'escucha' | 'apoyo'

/** Solo el valor que viaja a la API. El título y la descripción de cada opción
 *  salen del catálogo (`auth.onboarding.niveles.<valor>`): son texto de
 *  pantalla y no pueden vivir en una constante del módulo. */
const NIVELES: readonly NivelEntrada[] = ['animo', 'escucha', 'apoyo']

const TOTAL_PASOS = 3

export function AsistenteOnboarding({ candidatos }: { candidatos: readonly Candidato[] }) {
  const router = useRouter()
  const t = useTraductor()

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
        // Por CÓDIGO, no por `message`: el mensaje del servidor viene en un solo
        // idioma (CONTRATOS §4 e `i18n/index.ts`).
        setError(traducirCodigoError(cuerpo.code, t, cuerpo.retryAfter ? { retryAfter: cuerpo.retryAfter } : {}))
        return
      }
      if (!cuerpo.data.libre) {
        setError(t('auth.onboarding.aliasCogido'))
        return
      }
      setPaso(2)
    } catch {
      setError(t('auth.onboarding.errorComprobar'))
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
        setError(traducirCodigoError(cuerpo.code, t, cuerpo.retryAfter ? { retryAfter: cuerpo.retryAfter } : {}))
        // Una colisión de alias devuelve al paso 1, que es donde se arregla.
        if (cuerpo.code === 'entrada_invalida') setPaso(1)
        return
      }

      router.refresh()
      router.push('/feed')
    } catch {
      setError(t('auth.onboarding.errorCrear'))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="card fade-in" style={{ display: 'grid', gap: 20 }}>
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="chip" style={{ justifySelf: 'start' }}>
          {t('auth.onboarding.paso', { n: paso, total: TOTAL_PASOS })}
        </span>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_PASOS}
          aria-valuenow={paso}
          aria-label={t('auth.onboarding.progreso')}
          data-testid="auth-progreso-onboarding"
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
          data-testid="auth-error"
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
            <h1 style={{ fontSize: 24, margin: 0, lineHeight: 1.25 }}>
              {t('auth.onboarding.paso1Titulo')}
            </h1>
            <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              {t('auth.onboarding.paso1Texto')}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <AvatarSemilla semilla={semilla} tamano={72} />
            <div style={{ display: 'grid', gap: 8, flex: 1 }}>
              <label htmlFor="alias" className="sr-only">
                {t('auth.onboarding.etiquetaAlias')}
              </label>
              <input
                id="alias"
                data-testid="auth-campo-alias"
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
              <button
                type="button"
                className="btn btn--ghost"
                onClick={otroAlias}
                data-testid="auth-boton-otro-alias"
              >
                {t('auth.onboarding.otroAlias')}
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn--primary"
            onClick={comprobarYAvanzar}
            disabled={ocupado || alias.trim().length < 3}
            data-testid="auth-boton-continuar"
          >
            {ocupado ? t('auth.onboarding.comprobando') : t('auth.continuar')}
          </button>
        </section>
      )}

      {paso === 2 && (
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ fontSize: 24, margin: 0, lineHeight: 1.25 }}>
              {t('auth.onboarding.paso2Titulo')}
            </h1>
            <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              {t('auth.onboarding.paso2Texto')}
            </p>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            <legend className="sr-only">{t('auth.onboarding.leyendaNivel')}</legend>
            {NIVELES.map((opcion) => (
              <label
                key={opcion}
                style={{
                  display: 'grid',
                  gap: 4,
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${nivel === opcion ? 'var(--accent)' : 'var(--line)'}`,
                  background: 'var(--panel2)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
                  <input
                    type="radio"
                    name="nivel"
                    value={opcion}
                    checked={nivel === opcion}
                    onChange={() => setNivel(opcion)}
                  />
                  {t(`auth.onboarding.niveles.${opcion}.titulo`)}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.45 }}>
                  {t(`auth.onboarding.niveles.${opcion}.descripcion`)}
                </span>
              </label>
            ))}
          </fieldset>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn--ghost" onClick={() => setPaso(1)}>
              {t('auth.onboarding.atras')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setPaso(3)}
              data-testid="auth-boton-continuar"
              style={{ flex: 1 }}
            >
              {t('auth.continuar')}
            </button>
          </div>
        </section>
      )}

      {paso === 3 && (
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ fontSize: 24, margin: 0, lineHeight: 1.25 }}>
              {t('auth.onboarding.paso3Titulo')}
            </h1>
            <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              {t('auth.onboarding.paso3Texto')}
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
                {t('auth.onboarding.resumen', {
                  nivel: t(`auth.onboarding.niveles.${nivel}.titulo`),
                })}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn--ghost" onClick={() => setPaso(2)} disabled={ocupado}>
              {t('auth.onboarding.atras')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={crearPerfil}
              disabled={ocupado}
              data-testid="auth-boton-entrar-darma"
              style={{ flex: 1 }}
            >
              {ocupado ? t('auth.onboarding.creando') : t('auth.entrarEnDarma')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
