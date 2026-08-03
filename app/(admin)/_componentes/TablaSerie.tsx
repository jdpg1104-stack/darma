// ============================================================================
// B19 · Tabla de la serie diaria. SERVER COMPONENT.
//
// Es la versión en texto de lo que el sparkline dibuja. No es redundancia: una
// tendencia que solo existe como forma no existe para quien usa lector de
// pantalla, ni se puede copiar y pegar en un canal de incidentes.
//
// Cero `count(*)` para el total de filas: la serie viene ya acotada por la
// ventana (90 días como mucho) y no hay más páginas que pedir. Cuando una
// página necesite paginar eventos individuales, será por keyset sobre
// `(created_at, id)` — nunca `OFFSET`, tampoco aquí (CONTRATOS §5).
// ============================================================================

export interface ColumnaSerie {
  clave: string
  etiqueta: string
}

export interface TablaSerieProps {
  titulo: string
  columnas: readonly ColumnaSerie[]
  /** Ya formateadas: esta tabla no calcula ni redondea nada. */
  filas: ReadonlyArray<Readonly<Record<string, string>>>
}

export function TablaSerie({ titulo, columnas, filas }: TablaSerieProps) {
  if (filas.length === 0) {
    return <p>Todavía no hay ningún día calculado en esta ventana.</p>
  }

  return (
    <table>
      <caption>{titulo}</caption>
      <thead>
        <tr>
          {columnas.map((c) => (
            <th key={c.clave} scope="col">
              {c.etiqueta}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => (
          <tr key={fila[columnas[0].clave]}>
            {columnas.map((c, i) =>
              i === 0 ? (
                <th key={c.clave} scope="row">
                  {fila[c.clave]}
                </th>
              ) : (
                <td key={c.clave}>{fila[c.clave]}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
