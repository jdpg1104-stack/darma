/**
 * Tailwind CSS v4. Ya no hay `tailwind.config.js` ni las directivas
 * `@tailwind base/components/utilities`: toda la configuración vive en el CSS
 * (`@import "tailwindcss"` en app/globals.css) y el único plugin de PostCSS que
 * hace falta es `@tailwindcss/postcss`.
 *
 * `autoprefixer` tampoco está: Tailwind v4 aplica los prefijos internamente con
 * Lightning CSS. Añadirlo sería trabajo duplicado.
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
