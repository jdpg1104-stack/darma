// ============================================================================
// PanelPrivado — los saldos. Solo aparece en el perfil propio.
//
// ── POR QUÉ EL AVISO «SOLO TÚ VES ESTO» ES FUNCIONAL ───────────────────────
// La gente comparte capturas de su perfil. Sin una marca visible, quien
// comparte no sabe que en la imagen van su saldo gastable, sus cristales y sus
// créditos de escucha — y quien la recibe no sabe que está viendo algo que la
// app no le habría enseñado. El borde punteado y la etiqueta viajan DENTRO de
// la captura, que es donde tienen que estar.
//
// ── POR QUÉ ESTE COMPONENTE NO PUEDE APARECER EN UN PERFIL AJENO ───────────
// Sus props son los saldos. Para pintarlo en el perfil de otra persona haría
// falta tener sus saldos, y no se pueden tener: `mi_perfil_privado()` filtra por
// `auth.uid()` y el `select` directo devuelve `42501 permission denied`. La
// barrera está en Postgres; este componente solo la refleja.
// ============================================================================

import type { PerfilPropio } from './tipos.ts'
import estilos from './perfil.module.css'

export interface PanelPrivadoProps {
  privado: PerfilPropio['privado']
}

export function PanelPrivado({ privado }: PanelPrivadoProps) {
  const saldos: ReadonlyArray<{ etiqueta: string; valor: number }> = [
    { etiqueta: 'Karma gastable', valor: privado.karmaGastable },
    { etiqueta: 'Cristales', valor: privado.cristales },
    { etiqueta: 'Escuchas por canjear', valor: privado.creditosEscucha },
    { etiqueta: 'Personas acompañadas', valor: privado.escuchasDadas },
    { etiqueta: 'Veces que has escrito', valor: privado.publicaciones },
  ]

  return (
    <section className={estilos.panelPrivado} aria-labelledby="titulo-panel-privado">
      <p className={estilos.avisoPrivado} id="titulo-panel-privado">
        {/* Candado decorativo: el texto de al lado ya dice lo mismo, así que
            anunciarlo dos veces al lector de pantalla sería ruido. */}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M6 10V8a6 6 0 1 1 12 0v2h1v11H5V10h1Zm2 0h8V8a4 4 0 0 0-8 0v2Z"
            fill="currentColor"
          />
        </svg>
        Solo tú ves esto
      </p>

      <dl className={estilos.saldos}>
        {saldos.map((s) => (
          <div className={estilos.saldo} key={s.etiqueta}>
            <dd className={estilos.saldoValor}>{s.valor}</dd>
            <dt className={estilos.saldoEtiqueta}>{s.etiqueta}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}
