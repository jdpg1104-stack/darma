// Fixture del guard de claves: TIENE claves rotas a propósito.
//
// No lo arregles. Este archivo existe para demostrar que `guardClaves` se pone
// rojo, y un guard que no puede fallar no vale nada. Vive bajo `scripts/`, que
// NO es uno de los árboles que el guard recorre en el repositorio real.

import { obtenerTraductor } from '@/i18n'

export default function Pagina() {
  const t = obtenerTraductor('es')
  const inventada = true

  return (
    <section>
      <h1>{t('comun.aceptar')}</h1>
      <p>{t('inventada.del.todo')}</p>
      {/* Comentado: no debe contar. t('tampoco.esta') */}
      <p>{t(inventada ? 'otra.inventada' : 'comun.cancelar')}</p>
    </section>
  )
}
