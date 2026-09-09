#!/usr/bin/env node
/**
 * Zieht die Landesgrenze für die Karte „International Border".
 *
 * Anders als bei den Verwaltungsebenen ist die Grenze eine **Linie**, keine Fläche —
 * gefragt ist nur der Abstand zu ihr. Damit entfällt das Zusammensetzen von
 * OSM-Relationen zu Ringen: die Wege selbst sind schon die Antwort.
 *
 * Der Kniff steckt in der Abfrage. Ein Weg, der zugleich Mitglied der Grenzrelation
 * der Niederlande *und* der eines Nachbarlands ist, liegt auf der gemeinsamen Grenze.
 * Overpass kann Mengen schneiden (`way.nl.de`), und damit fällt die Küste von selbst
 * heraus — sie gehört nur zu einer der beiden Relationen.
 *
 *   node scripts/fetch-borders.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { countPoints, thin } from './lib/geojson.mjs'
import { overpass } from './lib/overpass.mjs'

const OUT_DIR = new URL('../public/data/borders/', import.meta.url)

/**
 * Die Nachbarn. Je Nachbar eine eigene Abfrage: aus einer gemeinsamen liesse sich nicht
 * mehr ablesen, welcher Weg zu welcher Grenze gehört — die sieben Wege ohne `name`-Tag
 * wären dann gar nicht zuzuordnen.
 */
const NEIGHBOURS = [
  { iso: 'DE', name: 'Deutschland' },
  { iso: 'BE', name: 'België' },
]

/**
 * 25 m, wie bei den Verwaltungsebenen. Die Grenze folgt Bächen und Parzellen und ist
 * entsprechend zappelig; auf die Frage „näher oder weiter?" über rund hundert Kilometer
 * hat das keinen Einfluss, auf die Dateigrösse sehr wohl.
 */
const TOLERANCE_METERS = 25

const NL = `rel["type"="boundary"]["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="NL"]`

function queryFor(iso) {
  return `
[out:json][timeout:900];
${NL}; way(r)->.nl;
rel["type"="boundary"]["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="${iso}"]; way(r)->.other;
way.nl.other;
out geom;
`
}

await mkdir(OUT_DIR, { recursive: true })

const segments = []
let before = 0
let after = 0

for (const neighbour of NEIGHBOURS) {
  process.stderr.write(`→ Grenze zu ${neighbour.name}\n`)
  const raw = await overpass(queryFor(neighbour.iso))

  const lines = raw.elements
    .filter((el) => el.type === 'way' && el.geometry?.length > 1)
    .map((el) => el.geometry.map((p) => [p.lon, p.lat]))

  if (!lines.length) {
    process.stderr.write(`  keine Wege gefunden — übersprungen\n`)
    continue
  }

  const rohPunkte = lines.reduce((sum, l) => sum + l.length, 0)
  before += rohPunkte

  // Die Wege bleiben einzeln: aneinandergesetzt wären sie ein Kunstgebilde, und für
  // den Abstand zu einer Linie spielt es keine Rolle, wie sie zerteilt ist.
  const geometry = thin({ type: 'MultiLineString', coordinates: lines }, TOLERANCE_METERS)
  after += countPoints(geometry.coordinates)

  process.stderr.write(`  ${lines.length} Wege, ${rohPunkte} Stützpunkte\n`)
  segments.push({ with: neighbour.name, geometry })
}

const json =
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap via Overpass (ODbL)',
    id: 'international',
    label: 'Landesgrenze',
    segments,
  }) + '\n'

await writeFile(new URL('international.json', OUT_DIR), json)

process.stderr.write(
  `\n  Landesgrenze  ${segments.length} Abschnitte · ${before} → ${after} Punkte · ` +
    `${(json.length / 1024).toFixed(0)} kB (${(gzipSync(json).length / 1024).toFixed(0)} kB gzip)\n`,
)
