// ============================================================================
// /perfil — el perfil PROPIO. Server Component.
//
// ── PRESUPUESTO DE CONSULTAS: CUATRO, Y LA CUARTA TIENE NOMBRE ─────────────
//   1. `profiles` por PK → columnas públicas.
//   2. `mi_perfil_privado()` → saldos y contadores.
//   3. `mi_resumen_karma()` → racha + tope diario + desglose de 30 días.
//   4. primera página del ledger, por `idx_karma_events_user_keyset`.
//
// La ficha pedía tres. La cuarta aparece porque el endurecimiento del esquema
// partió en dos lo que antes era un `select`: `authenticated` ya no tiene
// privilegio de SELECT sobre `karma_spendable`, `crystals`, `listen_credits`,
// `listens_given`, `posts_published`, `daily_karma_earned` ni sobre las columnas
// de racha — ni siquiera sobre su propia fila. Comprobado contra Postgres: el
// intento devuelve `42501 permission denied`.
//
// Insignias y progreso de nivel siguen costando CERO consultas: son funciones
// puras sobre datos ya cargados.
//
// ── JS DE CLIENTE ──────────────────────────────────────────────────────────
// `HistorialKarma` (el botón de "cargar más"), `BotonCrisis` (que se oculta a
// sí mismo en /ayuda) y dos hojas diminutas de B13/B01: `BotonInstalar` (solo
// se pinta si el navegador ofrece instalar la PWA) y `BotonSalir` (cierra
// sesión y avisa al service worker). Cabecera, panel privado, medidor, racha y
// rejilla de insignias son Server Components y envían 0 bytes.
// ============================================================================

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { requireSesion } from '@/lib/auth/session'
import { BotonInstalar } from '@/components/pwa'
import { BotonSalir } from '@/components/perfil/BotonSalir'
import { CabeceraPerfil } from '@/components/perfil/CabeceraPerfil'
import { PanelPrivado } from '@/components/perfil/PanelPrivado'
import { ProgresoNivel } from '@/components/perfil/ProgresoNivel'
import { RachaDias } from '@/components/perfil/RachaDias'
import { RejillaInsignias } from '@/components/perfil/RejillaInsignias'
import { HistorialKarma } from '@/components/perfil/HistorialKarma'
import { leerHistorial, leerPerfilPropio } from '@/components/perfil/consultas'
import estilos from '@/components/perfil/perfil.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('perfil.metaTitulo'),
    // El perfil no se indexa: es de una persona, aunque sea anónima, y una
    // pantalla con su nivel y su actividad no tiene por qué salir en un
    // buscador.
    robots: { index: false, follow: false },
  }
}

export default async function PaginaPerfilPropio() {
  // `requireSesion()` y NO `requirePerfil()`: en una página, el `sin_permiso`
  // que lanza `requirePerfil()` no se convierte en redirección sino en un 500.
  // Una cuenta anónima recién creada, sin onboarding, se manda a terminarlo —
  // el mismo idioma que /publicar.
  const sesion = await requireSesion()
  if (!sesion.perfilCompleto) redirect('/onboarding')
  const t = obtenerTraductor(await resolverLocale())

  const [propio, historial] = await Promise.all([
    leerPerfilPropio(sesion.userId),
    leerHistorial({ limite: 20 }),
  ])

  return (
    <div className={estilos.pagina}>
      <CabeceraPerfil perfil={propio.perfil} bio={propio.bio} />

      {/* Un `<Link>`, no un `<Boton>` con `onClick`: navegar es lo que hace un
          enlace, y así funciona con el clic central, con «abrir en pestaña
          nueva» y sin JavaScript. `Boton` renderiza un `<button>` y envolverlo
          en un Link exigiría el `legacyBehavior` que Next 16 ya no acepta. */}
      <div className={estilos.acciones}>
        <Link className={estilos.enlaceAccion} href="/perfil/editar">
          {t('perfil.editarPerfil')}
        </Link>
        {/* B13: la instalación pertenece al perfil, no a un flotante global
            (components/pwa/index.ts). Se pinta solo cuando el navegador dispara
            `beforeinstallprompt`; en Safari y en la app ya instalada no ocupa
            ni un píxel. */}
        <BotonInstalar />
        {/* Cierra sesión avisando ANTES al service worker para que borre las
            cachés (móvil compartido). Ver la cabecera de BotonSalir. */}
        <BotonSalir />
      </div>

      <RachaDias racha={propio.resumen.racha} />

      <ProgresoNivel resumen={propio.resumen} conDetallePrivado />

      <PanelPrivado privado={propio.privado} />

      <RejillaInsignias insignias={propio.insignias} titulo={t('perfil.insigniasTituloPropio')} />

      <HistorialKarma inicial={historial} />
    </div>
  )
}
