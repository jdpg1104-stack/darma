// FIXTURE de prueba: componente sin nada prohibido. Una URL con `//` dentro
// de una cadena no debe abrir un comentario en el escáner del guard.
const AYUDA = 'https://ejemplo.invalid/ayuda'

export function Nota() {
  return <aside>{AYUDA}</aside>
}
