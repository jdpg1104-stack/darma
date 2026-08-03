# Protección de `main`

## Estado: parcial, y conviene saber por qué

La protección de rama **del servidor** no está activa. No es un olvido: GitHub
Free no la ofrece en repositorios privados. Al intentar configurarla, tanto la
API clásica como la de reglas responden lo mismo:

> Upgrade to GitHub Pro or make this repository public to enable this feature.

Las dos salidas cuestan algo y ninguna es obviamente correcta:

| Salida | Qué cuesta |
|---|---|
| **Hacer el repo público** | `HANDOFF/` documenta con precisión dónde estuvieron los catorce agujeros de seguridad y cómo se cerraron. Es una guía excelente para quien construya sobre esto, y también para quien quiera atacarlo. |
| **GitHub Pro** | Unos 4 $/mes. Desbloquea la protección real y las reglas, y el repo sigue privado. |

Mientras tanto, lo que hay es una barandilla local.

## Lo que sí está activo

`.githooks/pre-push` se ejecuta antes de cada `git push` y, **solo cuando el
destino es `main`**:

1. Rechaza el borrado de la rama.
2. Rechaza cualquier push que reescriba la historia (`--force` y equivalentes).
3. Exige que pasen, en este orden:
   - los guards de invariantes (economía TypeScript ≡ SQL, y que el cliente
     `service_role` no llegue al navegador),
   - `tsc --noEmit`,
   - la suite de pruebas.

El orden no es casual: primero lo que tarda segundos y protege una invariante,
después lo que tarda minutos. Un fallo de la economía no debe esperar a que
termine la suite entera.

## Activarlo

Una vez por clon:

```bash
git config core.hooksPath .githooks
```

Comprobar que quedó puesto:

```bash
git config core.hooksPath
```

## Sus límites, dichos claramente

Un hook de cliente **detiene el accidente, no a alguien decidido**:

- Se salta con `git push --no-verify`.
- No se aplica a quien clone el repositorio y no ejecute el `git config`.
- No se ejecuta en el servidor, así que un push desde otra máquina, desde la
  web de GitHub o desde una acción no pasa por aquí.

Es una barandilla. La puerta blindada es la protección del servidor, y para eso
hay que elegir una de las dos salidas de la tabla de arriba.
