// FIXTURE de prueba, no es código de producción.
// Un test colocado que habla de <Suspense> en un regex — como hace de verdad
// app/offline/pagina.test.ts — NO debe contar: los tests no entran en ningún
// bundle y no pueden matar la hidratación.
//
// Se llama `.spec.ts` y no `.test.ts` a propósito: el guard salta los dos,
// pero el glob de `npm test` (`scripts/**/*.test.ts`) solo recoge el segundo,
// y un fixture no debe colarse en la suite real.
export const PROHIBIDO = /<Suspense/
