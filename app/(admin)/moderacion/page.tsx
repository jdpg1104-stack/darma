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
import { exigirModerador } from '@/lib/ai/guardia'
import { leerColaCrisis, leerColaModeracion, type ItemCola, type ItemCrisis } from '@/lib/ai/cola'
import { recursosVerificados } from '@/lib/ai/recursos'
import { AccionesCrisis, AccionesFlag } from './Acciones'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Moderación · Darma',
  // Un panel de moderación indexado sería un mapa del sistema para cualquiera.
  robots: { index: false, follow: false },
}

function fecha(iso: string): string {
  // Formato fijo e independiente de la zona del navegador: dos moderadores
  // hablando del mismo caso tienen que ver la misma hora.
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function TarjetaCrisis({ item }: { item: ItemCrisis }) {
  return (
    <Tarjeta como="article" acento="crisis">
      <header>
        <Chip tono={item.risk === 'critical' ? 'peligro' : 'aviso'}>
          {item.risk === 'critical' ? 'Crítico' : 'Alto'}
        </Chip>{' '}
        <span>{fecha(item.createdAt)}</span>
      </header>
      <p>
        Persona <code>{item.userId}</code>
        {item.refType ? ` · ${item.refType}` : ''}
        {item.refId ? ` · ${item.refId}` : ''}
      </p>
      <AccionesCrisis eventoId={item.id} />
    </Tarjeta>
  )
}

function TarjetaFlag({ item }: { item: ItemCola }) {
  return (
    <Tarjeta como="article">
      <header>
        <Chip tono={item.severity >= 4 ? 'peligro' : 'neutro'}>Severidad {item.severity}</Chip>{' '}
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

  // Las dos colas en paralelo: son independientes y así el panel abre en el
  // tiempo de la más lenta, no en la suma.
  const [crisis, moderacion] = await Promise.all([
    leerColaCrisis(admin, { limite: 20 }),
    leerColaModeracion(admin, { limite: 20 }),
  ])

  return (
    <main>
      <h1>Moderación</h1>

      {!recursosVerificados() && (
        <Tarjeta como="section" acento="crisis">
          <strong>Los teléfonos de crisis siguen sin verificar por una persona.</strong>{' '}
          Se muestran igualmente (una tarjeta de crisis vacía es un callejón sin salida),
          pero hasta que alguien los confirme contra su fuente oficial no se pueden dar
          por buenos. Lista pendiente en <code>i18n/recursosCrisis.ts</code>.
        </Tarjeta>
      )}

      {/* ── PRIMERO LA CRISIS. Siempre. ─────────────────────────────────── */}
      <section aria-labelledby="cola-crisis">
        <h2 id="cola-crisis">Crisis sin atender ({crisis.items.length})</h2>
        {crisis.items.length === 0 ? (
          <EstadoVacio
            titulo="Nadie espera ahora mismo"
            descripcion="No hay eventos de riesgo alto o crítico pendientes de atender."
            tono="cuidado"
          />
        ) : (
          crisis.items.map((item) => <TarjetaCrisis key={item.id} item={item} />)
        )}
      </section>

      <section aria-labelledby="cola-moderacion">
        <h2 id="cola-moderacion">Cola de moderación ({moderacion.items.length})</h2>
        {moderacion.items.length === 0 ? (
          <EstadoVacio titulo="Sin señales pendientes" />
        ) : (
          moderacion.items.map((item) => <TarjetaFlag key={item.id} item={item} />)
        )}
      </section>
    </main>
  )
}
