// ============================================================================
// components/economia — barril. Única vía de import para el resto de la app.
//
// Once componentes; solo CUATRO llevan `'use client'`, y los cuatro son
// botones: comprar, impulsar, regalar y comprar cosmético. Todo lo demás es
// texto y se sirve con cero bytes de JavaScript, que es lo que deja la tienda
// dentro del presupuesto de 120 KB por ruta de CONTRATOS §11.
//
// 🔴 Ningún componente de este directorio acepta una prop con un importe que
// venga del cliente, ni una cantidad de cristales a acreditar. Los botones
// mandan un SKU o un tipo de regalo; la cantidad la decide el servidor.
// ============================================================================

export { TiendaCristales } from './TiendaCristales'
export type { TiendaCristalesProps } from './TiendaCristales'

export { BotonComprar } from './BotonComprar'
export type { BotonComprarProps } from './BotonComprar'

export { DialogoBoost } from './DialogoBoost'
export type { DialogoBoostProps } from './DialogoBoost'

export { BotonImpulsar } from './BotonImpulsar'
export type { BotonImpulsarProps } from './BotonImpulsar'

export { SelectorRegalo } from './SelectorRegalo'
export type { SelectorRegaloProps } from './SelectorRegalo'

export { BotonRegalar } from './BotonRegalar'
export type { BotonRegalarProps } from './BotonRegalar'

export { TiendaCosmeticos } from './TiendaCosmeticos'
export type { TiendaCosmeticosProps } from './TiendaCosmeticos'

export { BotonCosmetico } from './BotonCosmetico'
export type { BotonCosmeticoProps } from './BotonCosmetico'

export { SaldoCristales } from './SaldoCristales'
export type { SaldoCristalesProps } from './SaldoCristales'

export { HistorialCompras } from './HistorialCompras'
export type { HistorialComprasProps } from './HistorialCompras'

export { FraseLineaRoja } from './FraseLineaRoja'
export type { FraseLineaRojaProps } from './FraseLineaRoja'
