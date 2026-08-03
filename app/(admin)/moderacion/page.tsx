// ============================================================================
// /moderacion — el panel de revisión humana. SERVER COMPONENT.
//
// ── LA CRISIS PRIMERO, SIEMPRE ─────────────────────────────────────────────
// La cola de crisis va antes que la de moderación en el orden visual Y en el
// orden de los datos. No es una preferencia de maquetación: es CONTRATOS §9.
// Nadie puede reordenar esto por razones de diseño.
//
// ── PRESUPUESTO DE PANTALLA ────────────────────────────────────────────────
// Dos consultas por render (una por cola), las dos por índice parcial y las
// dos con keyset. Cero `count(*)`, cero OFFSET. Solo el diálogo de acción
// lleva `'use client'`: la lista entera son 0 bytes de JS.
//
// ── ANONIMATO ──────────────────────────────────────────────────────────────
// Aquí se ven `subject_id` y `user_id` porque sin ellos no se puede moderar,
// y esta pantalla exige rol comprobado en el servidor. Lo que NO se ve, ni
// aquí ni en ningún sitio: el país, el `reporter_id` y el cuerpo del texto.
// Para leer un contenido hay que ir a su hilo, con su política.
// ============================================================================

import { Chip, EstadoVacio, Tarjeta } from '@/components/ui'
import { obtenerTraductor, resolverLocale, type Traductor } from '@/i18n'
import { exigirModerador } from '@/lib/ai/guardia'
import { leerColaCrisis, leerColaModeracion, type ItemCola, type ItemCrisis } from '@/lib/ai/cola'
import { recursosVerificados } from '@/lib/ai/recursos'
import { AccionesCrisis, AccionesFlag } from './Acciones'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata() {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('moderacion.meta.titulo'),
    // Un panel de moderación indexado sería un mapa del sistema para cualquiera.
    robots: { index: false, follow: false },
  }
}

function fecha(iso: string): string {
  // Formato fijo e independiente de la zona del navegador: dos moderadores
  // hablando del mismo caso tienen que ver la misma hora.
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function TarjetaCrisis({ item, t }: { item: ItemCrisis; t: Traductor }) {
  return (
    <Tarjeta como="article" acento="crisis">
      <header>
        <Chip tono={item.risk === 'critical' ? 'peligro' : 'aviso'}>
          {item.risk === 'critical' ? t('moderacion.chip.critico') : t('moderacion.chip.alto')}
        </Chip>{' '}
        <span>{fecha(item.createdAt)}</span>
      </header>
      <p>
        {t('moderacion.persona')} <code>{item.userId}</code>
        {item.refType ? ` · ${item.refType}` : ''}
        {item.refId ? ` · ${item.refId}` : ''}
      </p>
      <AccionesCrisis eventoId={item.id} />
    </Tarjeta>
  )
}

function TarjetaFlag({ item, t }: { item: ItemCola; t: Traductor }) {
  return (
    <Tarjeta como="article">
      <header>
        <Chip tono={item.severity >= 4 ? 'peligro' : 'neutro'}>
          {t('moderacion.chip.severidad', { n: item.severity })}
        </Chip>{' '}
        <Chip>{item.signal}</Chip> <span>{fecha(item.createdAt)}</span>
      </header>
      <p>
        {item.refType}
        {item.refId ? ` · ${item.refId}` : ''}
        {item.refBigint !== null ? ` · #${item.refBigint}` : ''}
      </p>
      <AccionesFlag flagId={item.id} sujetoId={item.subjectId} />
    </Tarjeta>
  )
}

export default async function PaginaModeracion() {
  // Lanza `sin_permiso` si quien mira no es moderador. La comprobación es del
  // servidor; no hay ninguna versión de esta página que se pinte sin pasarla.
  const { admin } = await exigirModerador()
  const t = obtenerTraductor(await resolverLocale())

  // Las dos colas en paralelo: son independientes y así el panel abre en el
  // tiempo de la más lenta, no en la suma.
  const [crisis, moderacion] = await Promise.all([
    leerColaCrisis(admin, { limite: 20 }),
    leerColaModeracion(admin, { limite: 20 }),
  ])

  return (
    <main>
      <h1>{t('moderacion.titulo')}</h1>

      {!recursosVerificados() && (
        <Tarjeta como="section" acento="crisis">
          <strong>{t('moderacion.avisoTelefonosFuerte')}</strong>{' '}
          {t('moderacion.avisoTelefonosResto')} <code>i18n/recursosCrisis.ts</code>.
        </Tarjeta>
      )}

      {/* ── PRIMERO LA CRISIS. Siempre. ─────────────────────────────────── */}
      <section aria-labelledby="cola-crisis">
        <h2 id="cola-crisis">{t('moderacion.colaCrisis', { n: crisis.items.length })}</h2>
        {crisis.items.length === 0 ? (
          <EstadoVacio
            titulo={t('moderacion.vacioCrisisTitulo')}
            descripcion={t('moderacion.vacioCrisisDescripcion')}
            tono="cuidado"
          />
        ) : (
          crisis.items.map((item) => <TarjetaCrisis key={item.id} item={item} t={t} />)
        )}
      </section>

      <section aria-labelledby="cola-moderacion">
        <h2 id="cola-moderacion">
          {t('moderacion.colaModeracion', { n: moderacion.items.length })}
        </h2>
        {moderacion.items.length === 0 ? (
          <EstadoVacio titulo={t('moderacion.vacioFlags')} />
        ) : (
          moderacion.items.map((item) => <TarjetaFlag key={item.id} item={item} t={t} />)
        )}
      </section>
    </main>
  )
}
