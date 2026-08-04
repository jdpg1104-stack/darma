// ============================================================================
// B21 · UNA sola llamada a `videos.list` para las DOS guardas
//
// ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
// `canalesPermitidos.ts` necesita el `channelId` del vídeo. `idiomaAudio.ts`
// necesita su `defaultAudioLanguage`. Los dos campos viven en el MISMO
// `snippet` de la MISMA llamada `videos.list?part=snippet`, que cuesta 1 unidad
// de cuota. Pedirlos por separado cuesta 2 y devuelve exactamente lo mismo.
//
// Lo detectó la sesión de la allowlist leyendo el trabajo de la sesión del
// idioma: ninguna de las dos podía verlo desde dentro de su propio alcance.
//
// ── POR QUÉ NO SE METIÓ DENTRO DE NINGUNO DE LOS DOS MÓDULOS ───────────────
// Porque entonces uno dependería del otro y dejarían de ser probables por
// separado. Aquí la dependencia va en la dirección correcta: este módulo no sabe
// nada de allowlists ni de idiomas — solo trae los campos crudos — y son las
// guardas las que los interpretan.
//
// ── EL CACHÉ ES POR CORRIDA, NO GLOBAL ─────────────────────────────────────
// `crearConsultaMetadatos()` devuelve una función con su propio mapa. No hay
// estado de módulo: dos ingestas simultáneas no se pisan, y nada sobrevive al
// final de la corrida. Un caché global aquí sería una fuga de memoria lenta y,
// peor, serviría datos viejos sobre vídeos que pudieron cambiar de estado.
//
// NUNCA LANZA. Ante cualquier fallo devuelve `null`, y las dos guardas ya saben
// leer eso como «no lo sé» — que en ninguna de las dos es «no».
// ============================================================================

const ENDPOINT_VIDEOS = 'https://www.googleapis.com/youtube/v3/videos'

/** Mismo techo que el resto de sondas del pipeline. */
export const TIMEOUT_METADATOS_MS = 5_000

/** Los campos crudos que interesan de `snippet`. Sin interpretar. */
export interface MetadatosVideo {
  channelId: string | null
  defaultAudioLanguage: string | null
  defaultLanguage: string | null
}

export interface OpcionesMetadatos {
  apiKey?: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Firma de la consulta ya memoizada. `null` = no se pudo saber. */
export type ConsultaMetadatos = (videoId: string) => Promise<MetadatosVideo | null>

interface RespuestaVideos {
  items?: Array<{
    snippet?: {
      channelId?: string
      defaultAudioLanguage?: string
      defaultLanguage?: string
    }
  }>
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim().length > 0 ? valor.trim() : null
}

/**
 * Crea una consulta memoizada POR CORRIDA.
 *
 * Sin `apiKey` devuelve siempre `null` sin tocar la red: es un estado de
 * configuración, no un fallo, y quien llama ya distingue los dos.
 */
export function crearConsultaMetadatos(opciones: OpcionesMetadatos = {}): ConsultaMetadatos {
  const apiKey = opciones.apiKey ?? process.env.YOUTUBE_API_KEY ?? null
  const fetchFn = opciones.fetchImpl ?? globalThis.fetch
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_METADATOS_MS

  // El caché guarda también los `null`: si un vídeo no se pudo resolver, no se
  // vuelve a preguntar en la misma corrida. Reintentar dentro del mismo minuto
  // gasta cuota para obtener el mismo fallo.
  const cache = new Map<string, MetadatosVideo | null>()

  return async function consultar(videoId: string): Promise<MetadatosVideo | null> {
    if (typeof videoId !== 'string' || videoId.trim().length === 0) return null
    if (cache.has(videoId)) return cache.get(videoId) ?? null
    if (apiKey === null || apiKey.trim().length === 0) return null

    const control = new AbortController()
    const reloj = setTimeout(() => control.abort(), timeoutMs)

    let salida: MetadatosVideo | null = null
    try {
      const destino = `${ENDPOINT_VIDEOS}?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`
      const res = await fetchFn(destino, { signal: control.signal })
      if (res?.ok === true) {
        const json = (await res.json()) as RespuestaVideos
        const snippet = json.items?.[0]?.snippet
        if (snippet) {
          salida = {
            channelId: texto(snippet.channelId),
            defaultAudioLanguage: texto(snippet.defaultAudioLanguage),
            defaultLanguage: texto(snippet.defaultLanguage),
          }
        }
      }
    } catch {
      // Silencio deliberado: el mensaje de un error de fetch arrastra la URL, y
      // la URL lleva la clave de API en el query string.
      salida = null
    } finally {
      clearTimeout(reloj)
    }

    cache.set(videoId, salida)
    return salida
  }
}
