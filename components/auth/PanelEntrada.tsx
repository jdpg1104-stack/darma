'use client'

// ============================================================================
// Panel de entrada — la hoja interactiva de /entrar
//
// Dos caminos y un orden que es una decisión de producto:
//
//   1. ENTRAR SIN NADA, arriba, como acción primaria. Es la promesa de Darma y
//      quien llega mal no debería tener que rellenar nada. Un formulario en
//      esta pantalla es gente que se va.
//   2. RECUPERAR CON UN ENLACE, abajo y plegado. Solo lo necesita quien ya
//      estuvo aquí y perdió el dispositivo.
//
// El texto de confirmación del enlace se pinta con lo que la persona acaba de
// teclear, EN MEMORIA. El correo no se guarda en ningún sitio: ni en estado
// persistente, ni en una cookie, ni en `profiles`. Cuando esta pantalla se
// desmonta, desaparece.
// ============================================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Respuesta } from '@/lib/auth/respuestas'
import { traducirCodigoError } from '@/i18n'
import { useTraductor } from '@/i18n/Proveedor'

type Estado = 'inicial' | 'enviando' | 'enlaceEnviado'

/** Enmascara en el cliente para el mensaje de confirmación. Duplica a
 *  `enmascararContacto` del servidor a propósito: aquel es solo-servidor
 *  (lee IDENTITY_PEPPER en el mismo módulo) y no puede entrar en el bundle. */
function enmascarar(valor: string): string {
  const arroba = valor.lastIndexOf('@')
  if (arroba <= 0) return '***'
  return `${valor.slice(0, 1)}${'*'.repeat(Math.max(3, arroba - 1))}${valor.slice(arroba)}`
}

async function pedir<T>(url: string, opciones?: RequestInit): Promise<Respuesta<T>> {
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...opciones,
  })
  return (await respuesta.json()) as Respuesta<T>
}

export function PanelEntrada({ errorInicial }: { errorInicial?: string }) {
  const router = useRouter()
  const t = useTraductor()
  const [estado, setEstado] = useState<Estado>('inicial')
  const [correo, setCorreo] = useState('')
  const [enmascarado, setEnmascarado] = useState('')
  const [error, setError] = useState<string | null>(
    errorInicial === 'enlace' ? t('auth.entrada.enlaceCaducado') : null,
  )

  const ocupado = estado === 'enviando'

  async function entrarAnonimo() {
    setError(null)
    setEstado('enviando')
    try {
      const cuerpo = await pedir<{ userId: string }>('/api/auth/anonimo')
      if (!cuerpo.ok) {
        // Por CÓDIGO, no por `message`: el mensaje del servidor viene en un solo
        // idioma (CONTRATOS §4 e `i18n/index.ts`).
        setError(traducirCodigoError(cuerpo.code, t, cuerpo.retryAfter ? { retryAfter: cuerpo.retryAfter } : {}))
        setEstado('inicial')
        return
      }
      // `refresh()` antes de navegar: el layout del servidor debe ver ya la
      // cookie nueva, si no el onboarding se renderiza sin sesión y rebota.
      router.refresh()
      router.push('/onboarding')
    } catch {
      setError(t('auth.entrada.errorConexion'))
      setEstado('inicial')
    }
  }

  async function pedirEnlace(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    setEstado('enviando')

    const valor = correo.trim()
    try {
      const cuerpo = await pedir<{ enviado: true }>('/api/auth/magic-link', {
        body: JSON.stringify({ email: valor }),
      })
      if (!cuerpo.ok) {
        setError(traducirCodigoError(cuerpo.code, t, cuerpo.retryAfter ? { retryAfter: cuerpo.retryAfter } : {}))
        setEstado('inicial')
        return
      }
      setEnmascarado(enmascarar(valor))
      // Se vacía el campo en cuanto deja de hacer falta.
      setCorreo('')
      setEstado('enlaceEnviado')
    } catch {
      setError(t('auth.entrada.errorEnvio'))
      setEstado('inicial')
    }
  }

  return (
    <div className="card fade-in" style={{ display: 'grid', gap: 20 }}>
      <header style={{ display: 'grid', gap: 8 }}>
        <span className="chip" style={{ justifySelf: 'start' }}>{t('auth.entrada.chip')}</span>
        <h1 style={{ fontSize: 26, lineHeight: 1.2, margin: 0 }}>{t('auth.entrada.titulo')}</h1>
        <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
          {t('auth.entrada.subtitulo')}
        </p>
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
            color: 'var(--ink)',
            lineHeight: 1.45,
          }}
        >
          {error}
        </p>
      )}

      <button
        type="button"
        className="btn btn--primary"
        onClick={entrarAnonimo}
        disabled={ocupado}
        style={{ width: '100%' }}
      >
        {ocupado ? t('auth.entrada.enviando') : t('auth.entrada.botonAnonimo')}
      </button>

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: 0 }} />

      {estado === 'enlaceEnviado' ? (
        <p role="status" style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
          {t('auth.entrada.enlaceEnviadoInicio')}{' '}
          <strong style={{ color: 'var(--ink)' }}>{enmascarado}</strong>
          {t('auth.entrada.enlaceEnviadoFin')}
        </p>
      ) : (
        <form onSubmit={pedirEnlace} style={{ display: 'grid', gap: 10 }}>
          <label htmlFor="correo" style={{ color: 'var(--muted)', fontSize: 14 }}>
            {t('auth.entrada.etiquetaCorreo')}
          </label>
          <input
            id="correo"
            name="correo"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            value={correo}
            onChange={(evento) => setCorreo(evento.target.value)}
            placeholder={t('auth.entrada.marcadorCorreo')}
            style={{
              minHeight: 'var(--touch)',
              padding: '0 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--line)',
              background: 'var(--panel2)',
              color: 'var(--ink)',
              font: 'inherit',
            }}
          />
          <button type="submit" className="btn btn--ghost" disabled={ocupado}>
            {t('auth.entrada.botonEnlace')}
          </button>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            {t('auth.entrada.notaCorreo')}
          </p>
        </form>
      )}
    </div>
  )
}
