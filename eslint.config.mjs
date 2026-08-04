import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

// ESLint 9 "flat config". `eslint-config-next` 16 ya exporta arrays de flat
// config nativos, así que NO hace falta el puente `FlatCompat`/eslintrc: se
// importan y se esparcen directamente.
const eslintConfig = [
  {
    // Nada de linting sobre artefactos de build ni sobre el esquema SQL.
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'supabase/**',
      // Los worktrees de sesiones en paralelo (HANDOFF/PARALELO.md §1) son
      // COPIAS COMPLETAS del repo. Sin esta línea, eslint las recorre y cada
      // sesión abierta multiplica los avisos: con cuatro worktrees vivos, los 16
      // avisos conocidos del proyecto salían 48. Un recuento que crece con el
      // número de sesiones abiertas no informa de nada y entrena a ignorarlo.
      // Git no tiene este problema porque conoce sus propios worktrees.
      '.claude/worktrees/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      // Las variables sin usar son un error, no un aviso: un aviso que nadie
      // arregla es ruido que acaba tapando el aviso que sí importa. El prefijo
      // `_` sigue siendo la vía explícita para "esto no se usa a propósito".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // `any` desactiva el compilador justo donde más falta hace. Aviso (no
      // error) para no bloquear la integración de librerías sin tipos.
      '@typescript-eslint/no-explicit-any': 'warn',
      // En una app anónima, un console.log despistado en el servidor puede
      // acabar volcando el cuerpo de un desahogo a los logs de Vercel. warn y
      // error sí se permiten: son para fallos, no para datos de usuario.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Comparación estricta siempre, salvo `== null` (cubre null y undefined
      // de una vez y es idiomático).
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
]

export default eslintConfig
