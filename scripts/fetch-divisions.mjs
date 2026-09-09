#!/usr/bin/env node
/**
 * Zieht die Verwaltungs- und Statistikgebiete, auf die sich die „Administrative
 * Division"-Karten beziehen.
 *
 * Quelle ist der WFS der CBS Gebiedsindelingen bei PDOK: eine Adresse, aus der alle
 * vier Ebenen als fertiges GeoJSON in WGS84 fallen — kein Zusammensetzen von
 * Relationen wie bei Overpass, und amtlich statt kartiert.
 *
 * Die Zuordnung der Ebenen steht in scripts/build-questions.mjs; hier wird nur
 * geholt, was dort gebraucht wird.
 *
 *   node scripts/fetch-divisions.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { countPoints, thin } from './lib/geojson.mjs'
import { BBOX, INNER_BBOX } from './lib/region.mjs'

const WFS = 'https://service.pdok.nl/cbs/gebiedsindelingen/2025/wfs/v1_0'
const OUT_DIR = new URL('../public/data/divisions/', import.meta.url)

/** Steht in jeder erzeugten Datei — die GetCapabilities nennt CC BY 4.0. */
const SOURCE = 'CBS Gebiedsindelingen 2025 via PDOK WFS (CC BY 4.0)'

/**
 * Der Server gibt rund 1000 Objekte je Antwort heraus, unabhängig vom angeforderten
 * `count` — und mal 999, mal 995. Buurt hat im Rahmen über 2300, es muss also gepagt
 * werden, und zwar um die tatsächliche Seitenlänge weiter. `numberMatched` hilft
 * dabei nicht: das Feld zählt hier mit, was bis dahin ausgeliefert wurde, es ist
 * nicht die Gesamtzahl.
 */
const PAGE = 1000

/**
 * Die vier Ebenen, in der Reihenfolge, in der die Karten sie durchzählen.
 *
 * `bbox`: COROP und Gemeente tragen auch eine „…Border"-Karte — für „wie weit ist
 * die nächste Grenze?" darf am Feldrand keine fehlen, deshalb der weite Rahmen.
 * Wijk und Buurt beantworten nur „dieselbe wie meine?"; dort reicht der enge.
 *
 * `tolerance`: die CBS-Geometrien sind schon generalisiert. Ausgedünnt wird nur noch
 * das, was bei rund 20 m Kartengenauigkeit ohnehin niemand sieht — auf feineren
 * Ebenen etwas beherzter, weil dort die Menge der Flächen das Gewicht macht.
 */
const LEVELS = [
  { id: 'corop', label: 'COROP-Regio', layer: 'coropgebied', bbox: BBOX, tolerance: 20 },
  { id: 'gemeente', label: 'Gemeente', layer: 'gemeente', bbox: BBOX, tolerance: 20 },
  { id: 'wijk', label: 'Wijk', layer: 'wijk', bbox: INNER_BBOX, tolerance: 25 },
  { id: 'buurt', label: 'Buurt', layer: 'buurt', bbox: INNER_BBOX, tolerance: 30 },
]

/**
 * Eine Seite Objekte einer Ebene.
 *
 * Zwei Eigenheiten des Dienstes: `bbox` steht in EPSG:4326 als lat,lon,lat,lon, die
 * Koordinaten kommen aber in GeoJSON-Ordnung lon,lat zurück. Und `bbox` filtert, es
 * schneidet nicht — zurück kommt die ganze Fläche jedes Treffers. Das ist erwünscht:
 * eine am Rahmen abgeschnittene Gemeente ergäbe für die Border-Karte eine
 * schnurgerade Grenze, die es nicht gibt.
 */
async function fetchPage(level, startIndex) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: `gebiedsindelingen:${level.layer}_gegeneraliseerd`,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    bbox: `${level.bbox.join(',')},EPSG:4326`,
    count: String(PAGE),
    startIndex: String(startIndex),
  })

  const res = await fetch(`${WFS}?${params}`)
  const body = await res.text()
  if (!res.ok) throw new Error(`${level.id}: HTTP ${res.status}`)
  // Bei einem Fehler antwortet der Dienst mit einem XML-Report, nicht mit JSON.
  if (!body.trimStart().startsWith('{')) {
    const hint = body.match(/<ows:ExceptionText>([^<]+)/)?.[1] ?? 'keine JSON-Antwort'
    throw new Error(`${level.id}: ${hint.trim()}`)
  }
  return JSON.parse(body).features ?? []
}

async function fetchLevel(level) {
  // Über den Code entdoppelt: eine kurze Seite darf die Zählung nicht verschieben,
  // und zweimal dieselbe Fläche wäre zweimal derselbe Umriss auf der Karte.
  const byCode = new Map()
  for (let start = 0; ; ) {
    const page = await fetchPage(level, start)
    if (!page.length) break
    for (const feature of page) byCode.set(feature.properties.statcode, feature)
    start += page.length
    process.stderr.write(`  ${level.id}: ${byCode.size} Flächen\n`)
  }
  return [...byCode.values()]
}

await mkdir(OUT_DIR, { recursive: true })

const summary = []

for (const level of LEVELS) {
  process.stderr.write(`→ ${level.label}\n`)
  const features = await fetchLevel(level)

  let before = 0
  let after = 0

  const areas = features.map((feature) => {
    before += countPoints(feature.geometry.coordinates)
    // Von den mitgelieferten Properties bleiben zwei: jrstatcode, rubriek, id, gmCode
    // und das Feature-eigene bbox braucht die App nicht.
    const geometry = thin(feature.geometry, level.tolerance)
    after += countPoints(geometry.coordinates)

    return { code: feature.properties.statcode, name: feature.properties.statnaam, geometry }
  })

  areas.sort((a, b) => a.name.localeCompare(b.name, 'nl'))

  const json =
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: SOURCE,
      level: level.id,
      label: level.label,
      bbox: level.bbox,
      areas,
      // Kompakt: die Datei wird erzeugt, nie von Hand bearbeitet.
    }) + '\n'

  await writeFile(new URL(`${level.id}.json`, OUT_DIR), json)
  summary.push({ level, count: areas.length, before, after, bytes: json.length, gzip: gzipSync(json).length })
}

const kb = (n) => `${(n / 1024).toFixed(0)} kB`
process.stderr.write('\n')
for (const s of summary) {
  process.stderr.write(
    `  ${s.level.label.padEnd(12)} ${String(s.count).padStart(5)} Flächen · ` +
      `${String(s.before).padStart(7)} → ${String(s.after).padStart(6)} Punkte · ` +
      `${kb(s.bytes).padStart(7)} (${kb(s.gzip)} gzip)\n`,
  )
}
