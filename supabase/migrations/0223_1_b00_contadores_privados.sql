-- ============================================================================
-- B00 · `listens_given` y `posts_published` son PRIVADOS. Decidido, no heredado.
--
-- ── LA DISCREPANCIA QUE SE CIERRA ──────────────────────────────────────────
-- `HANDOFF/B05.md` §Contrato decía, literal: «Contadores públicos permitidos:
-- `listens_given` y `posts_published` (son el reflejo de la reciprocidad y por
-- eso son públicos)». El esquema decía lo contrario desde el endurecimiento:
-- 0001 revoca el SELECT de `profiles` entero y vuelve a conceder una lista
-- cerrada de columnas en la que estas dos no están.
--
-- Ganó el esquema, en silencio: el perfil ajeno devolvía `42501 permission
-- denied` y B05 acabó quitando los campos de su tipo público. Quedaba escrito
-- como un pedido a B00 con dos salidas —(a) son públicos y hay que arreglar el
-- esquema, (b) no lo son y hay que arreglar los documentos— y sin decidir.
--
-- Se decide (b), y esta migración existe para que la decisión esté en el sitio
-- donde alguien la va a buscar. Hasta hoy la exclusión era por CONSTRUCCIÓN
-- —no aparecen en la lista del `grant`— y eso se lee igual que un olvido. Un
-- `revoke` explícito y un `comment on column` hacen que un `grant` futuro se lea
-- como lo que sería: revertir una decisión, no reparar un descuido.
--
-- ── POR QUÉ `posts_published` NO PUEDE SER PÚBLICO ─────────────────────────
-- Es cuántas veces has pedido ayuda. En una red de salud mental, publicar ese
-- número convierte «esta persona lo está pasando mal a menudo» en un dato de un
-- vistazo, junto al seudónimo, para cualquiera. Los desahogos ya son públicos
-- uno a uno; el agregado es otra cosa — es un perfil de frecuencia, y no hay
-- ninguna función del producto que lo necesite.
--
-- ── POR QUÉ `listens_given` TAMPOCO, QUE ES EL MENOS OBVIO ─────────────────
-- Este sí es la moneda buena de Darma: a cuánta gente has acompañado. La
-- tentación de publicarlo es fuerte y por eso conviene el argumento entero.
--
-- La reciprocidad YA tiene su señal pública, y es el tablero de B06. Pero el
-- tablero no publica este contador: publica `ranking_snapshots.listens`, que es
-- por PERIODO y con TECHO DIARIO (`LISTENS_DIA_MAX` = 12, `lib/ranking/techo.ts`).
-- Ese techo existe para que acompañar a mucha gente deprisa no rente más que
-- acompañar bien. `profiles.listens_given` es el mismo hecho SIN techo y
-- vitalicio: publicarlo pondría al lado del tablero un segundo número, más
-- grande y sin límite, que premia exactamente lo que el techo frena. El techo
-- dejaría de acotar nada porque habría una vía de reputación que lo rodea.
--
-- `lib/ranking/movimiento.test.ts` ya afirma que `listens_given` no sale en la
-- respuesta del ranking. Esto es la misma regla en el otro extremo del sistema.
--
-- ── LO QUE NO CAMBIA ───────────────────────────────────────────────────────
-- Cada quien sigue viendo LOS SUYOS: salen por `mi_perfil_privado()`, que
-- filtra por `auth.uid()`, y se pintan en `PanelPrivado`. Las insignias
-- derivadas siguen funcionando en el perfil propio
-- (`components/perfil/insignias.ts` ya documenta cuáles son privadas).
-- ============================================================================

-- No cambia el estado actual: es una AFIRMACIÓN. Las dos columnas nunca
-- estuvieron en la lista del `grant` de 0001, así que esto revoca algo que no
-- estaba concedido — y ese es justo el punto, dejar el «no» por escrito en vez
-- de que se deduzca de una ausencia.
revoke select (listens_given, posts_published) on public.profiles from anon, authenticated;

comment on column public.profiles.listens_given is
  'PRIVADO. Contador vitalicio y SIN techo de escuchas dadas. La senal publica de reciprocidad es ranking_snapshots.listens, que va por periodo y con techo diario (LISTENS_DIA_MAX): publicar este pondria al lado un numero mas grande y sin limite que premia justo lo que el techo frena. Solo por mi_perfil_privado(). Decidido en 0223.';

comment on column public.profiles.posts_published is
  'PRIVADO. Cuantas veces esta persona ha pedido ayuda. Publicarlo convierte «lo esta pasando mal a menudo» en un dato de un vistazo junto al seudonimo; los desahogos son publicos uno a uno, el agregado es un perfil de frecuencia y ninguna funcion del producto lo necesita. Solo por mi_perfil_privado(). Decidido en 0223.';
