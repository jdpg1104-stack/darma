# Pedidos entre bloques

Aquí se anota lo que necesitas **de otro bloque** en vez de editarlo tú. Añade
líneas al final; no reescribas las de otros. Quien sea dueño del bloque destino
las recoge y las cierra.

Formato: `- [ ] **De B0X → B0Y** · qué necesitas · por qué · quién lo pidió`

## Abiertos

- [ ] **De B07 → B00** · la RPC de latidos de reproducción es ahora la ÚNICA vía
      de escritura en `content_views`: la migración `0002` ya no concede UPDATE
      al cliente ni deja insertar filas con `completed = true`. Sin esa RPC, el
      karma de `content_completed` no se otorga nunca · 2026-08-03
- [ ] **De B01 → B00** · `/api/me` debe leer los campos privados con la función
      `mi_perfil_privado()` de `0001_core.sql`, no con un `select` sobre
      `profiles`: `authenticated` ya no tiene privilegio de columna sobre
      `karma_spendable`, `crystals` ni `listen_credits`, ni siquiera sobre su
      propia fila · 2026-08-03
- [ ] **De B11 → B19** · nadie escribe `crisis_events.human_reviewed` todavía;
      la métrica de cobertura del 100 % del panel depende de que B11 lo marque
      al cerrar cada caso · 2026-08-03

## Cerrados

- [x] **B00** · Definir contratos compartidos antes de abrir las olas · sin esto
      dos bloques declaran el mismo tipo con formas distintas · 2026-08-03

---

## Bugs vistos fuera de tu bloque

No los arregles: el arreglo de otro es un conflicto de merge garantizado. Anótalos.

- _(vacío)_
