import { clsx } from 'clsx'

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { progressToNextLevel } from '@/lib/karma'
import { modeloMedidor } from './modelos.ts'
import { Insignia } from './Insignia.tsx'
import estilos from './MedidorKarma.module.css'

export interface MedidorKarmaProps {
  /**
   * SOLO reputación.
   *
   * `karmaSpendable` y `crystals` NO caben aquí a propósito, y no es una
   * omisión que se pueda «arreglar» luego: son campos PRIVADOS (CONTRATOS.md
   * §2), solo salen en `/api/me` y solo los ve su dueño. Si el componente no
   * puede recibirlos, ningún bloque puede filtrarlos por descuido en un perfil
   * ajeno. El medidor del saldo propio lo hace B05, en su bloque, con su tipo.
   */
  karmaReputacion: number
  compacto?: boolean
  mostrarSiguienteNivel?: boolean
}

/**
 * Progreso de nivel. Server Component ASÍNCRONO desde la migración a i18n: el
 * texto sale del catálogo y el locale se resuelve por petición. Las props NO
 * han cambiado — sigue aceptando `karmaReputacion` y nada más, que es lo que
 * impide que el saldo gastable o los cristales lleguen aquí (CONTRATOS §2).
 *
 * `aria-valuetext` se compone aquí y ya no se lee de `modeloMedidor()`: aquel
 * texto lo construye `components/ui/modelos.ts`, que es lógica pura sin acceso
 * al catálogo. El resto del modelo (porcentaje, restante, karma visible) sigue
 * saliendo de allí sin tocar.
 *
 * El progreso lo calcula `progressToNextLevel()` de `lib/karma.ts`; aquí no se
 * recalcula nada. Si algún día cambian los umbrales, cambian en un sitio.
 *
 * La barra mide el TRAMO ACTUAL, no el total: con 2 400 de karma muestra
 * 400/3 000 = 13 %, no 2 400/5 000 = 48 %. La segunda se vería casi llena justo
 * cuando faltan 2 600 puntos, y una barra que miente sobre el esfuerzo restante
 * es peor que no tener barra.
 *
 * Copy: nada de «puntos», «racha» ni «nivel desbloqueado» (Trampa #5). Esto
 * puede aparecer en la pantalla de alguien que está mal; el progreso se cuenta,
 * no se celebra.
 */
export async function MedidorKarma({
  karmaReputacion,
  compacto = false,
  mostrarSiguienteNivel = true,
}: MedidorKarmaProps) {
  const t = obtenerTraductor(await resolverLocale())
  const m = modeloMedidor(karmaReputacion)

  // Solo para la CLAVE del nivel siguiente: `modeloMedidor` devuelve su
  // etiqueta ya escrita en español (`levelLabel`), y aquí hace falta el
  // identificador para poder pedir `perfil.nivel.<clave>`. Es la misma función
  // pura que ya usa el modelo, así que no hay dos cálculos distintos que
  // puedan divergir.
  const siguienteNivel = progressToNextLevel(karmaReputacion).nextLevel

  const etiquetaNivel = t(`perfil.nivel.${m.nivel}`)
  const etiquetaSiguiente = siguienteNivel ? t(`perfil.nivel.${siguienteNivel}`) : null

  return (
    <div className={clsx(estilos.medidor, compacto && estilos.compacto)} data-nivel={m.nivel}>
      <div className={estilos.cabecera}>
        <Insignia nivel={m.nivel} conEtiqueta={!compacto} />
        {compacto ? <span className={estilos.etiqueta}>{etiquetaNivel}</span> : null}
        <span className={estilos.karma}>
          {m.karmaVisible}
          <span className={estilos.unidad}> {t('karma.unidad')}</span>
        </span>
      </div>

      {/* `role="progressbar"` con `aria-valuetext`: un «73» suelto leído en voz
          alta no significa nada. El texto dice de qué nivel a cuál. */}
      <div
        className={estilos.carril}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={m.porcentaje}
        aria-valuetext={
          etiquetaSiguiente
            ? t('karma.progresoAccesible', {
                nivel: etiquetaNivel,
                porcentaje: m.porcentaje,
                siguiente: etiquetaSiguiente,
              })
            : t('karma.progresoAccesibleUltimo', { nivel: etiquetaNivel })
        }
      >
        <span className={estilos.relleno} data-porcentaje={m.porcentaje} />
      </div>

      {mostrarSiguienteNivel && etiquetaSiguiente ? (
        <p className={estilos.pista}>
          {t('karma.faltaParaNivel', { n: m.restante, nivel: etiquetaSiguiente })}
        </p>
      ) : null}
      {mostrarSiguienteNivel && !etiquetaSiguiente ? (
        <p className={estilos.pista}>{t('karma.ultimoNivel')}</p>
      ) : null}
    </div>
  )
}
