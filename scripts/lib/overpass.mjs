/**
 * Overpass-Anbindung für die Datenskripte.
 *
 * Zwei Eigenheiten, über die man sonst stolpert:
 * - Ohne echten User-Agent antwortet overpass-api.de mit HTTP 406. Node schickt
 *   von sich aus keinen.
 * - Bei Überlast kommt HTTP 200 mit einer HTML-Fehlerseite statt JSON. Das muss
 *   als Fehler behandelt werden, sonst scheitert erst das JSON.parse.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

const USER_AGENT = 'hideAndSeek/1.0 (Jet-Lag-style game map; contact via repo)'
const ROUNDS = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Führt eine Overpass-QL-Abfrage aus und liefert die geparste Antwort. */
export async function overpass(query) {
  let lastError
  for (let round = 1; round <= ROUNDS; round++) {
    for (const url of ENDPOINTS) {
      try {
        process.stderr.write(`→ [${round}/${ROUNDS}] ${url}\n`)
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
          body: new URLSearchParams({ data: query }),
        })
        const body = await res.text()
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        if (!body.trimStart().startsWith('{')) {
          const hint = body.match(/Error<\/strong>: ([^<\n]+)/)?.[1] ?? 'keine JSON-Antwort'
          throw new Error(hint.trim())
        }
        return JSON.parse(body)
      } catch (err) {
        lastError = err
        process.stderr.write(`  fehlgeschlagen: ${err.message}\n`)
      }
    }
    if (round < ROUNDS) {
      const wait = round * 15
      process.stderr.write(`  alle Endpunkte belegt, warte ${wait}s\n`)
      await sleep(wait * 1000)
    }
  }
  throw lastError
}

/** Luftlinie zwischen zwei Punkten in Metern (Haversine). */
export function distance(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Kleinbuchstaben, ohne Akzente, für stabile IDs. */
export function slug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
