import {
  comprobarFusible,
  ErrorFusibleProduccion,
  expect,
  refDeProyecto,
  test,
} from '../fixtures'

// ============================================================================
// Prueba nº 13 · el fusible anti-producción.
//
// Esta suite crea y BORRA usuarios con service_role. Apuntada a producción,
// borra gente de verdad — gente que escribió aquí lo que no le cuenta a nadie.
// El fusible es lo primero que se escribió del bloque y esto es lo que impide
// que se quede sin efecto en el primer refactor.
//
// No necesita navegador, ni base de datos, ni credenciales: por eso es la única
// parte de la suite que se ejecuta SIEMPRE, incluso hoy con la clave vacía.
// ============================================================================

test.describe('Fusible anti-producción del cliente service_role', () => {
  test('deja pasar Supabase local', () => {
    expect(() => comprobarFusible('http://localhost:54321')).not.toThrow()
    expect(() => comprobarFusible('http://127.0.0.1:54321')).not.toThrow()
  })

  test('LANZA si la URL es remota y no hay proyecto declarado', () => {
    // Sin declaración explícita no se puede distinguir el proyecto de pruebas
    // del de producción, y ante la duda esta suite no toca nada.
    expect(() => comprobarFusible('https://vulgobhjxkapxlgotkqg.supabase.co')).toThrow(
      ErrorFusibleProduccion,
    )
  })

  test('LANZA si la URL remota NO coincide con el proyecto declarado', () => {
    // El caso real que esto previene: `nldvflhlimnmctyvzzxm` es producción de
    // otra app, con datos personales de personas reales.
    expect(() =>
      comprobarFusible('https://nldvflhlimnmctyvzzxm.supabase.co', 'vulgobhjxkapxlgotkqg'),
    ).toThrow(ErrorFusibleProduccion)
  })

  test('deja pasar la URL remota que SÍ coincide con el proyecto declarado', () => {
    expect(() =>
      comprobarFusible('https://vulgobhjxkapxlgotkqg.supabase.co', 'vulgobhjxkapxlgotkqg'),
    ).not.toThrow()
  })

  test('LANZA si no hay URL de Supabase en absoluto', () => {
    // Sin URL no se sabe contra qué base se está ejecutando, que es peor que
    // saber que es la equivocada.
    expect(() => comprobarFusible(undefined)).toThrow(ErrorFusibleProduccion)
    expect(() => comprobarFusible('')).toThrow(ErrorFusibleProduccion)
  })

  test('extrae la referencia del proyecto de una URL de Supabase', () => {
    expect(refDeProyecto('https://vulgobhjxkapxlgotkqg.supabase.co')).toBe(
      'vulgobhjxkapxlgotkqg',
    )
    expect(refDeProyecto('http://localhost:54321')).toBeNull()
    // Un dominio parecido pero ajeno no debe colarse como si fuera Supabase.
    expect(refDeProyecto('https://vulgobhjxkapxlgotkqg.supabase.co.malo.example')).toBeNull()
  })

  test('el entorno de ESTA ejecución pasa el fusible', () => {
    // Control positivo: si esto falla, la suite entera está mal configurada y
    // más vale enterarse aquí que a mitad de un teardown que borra usuarios.
    expect(() =>
      comprobarFusible(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.E2E_SUPABASE_PROJECT_REF,
      ),
    ).not.toThrow()
  })
})
