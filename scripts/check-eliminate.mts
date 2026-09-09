/*
 * Gegenprobe für `src/lib/eliminate.ts` — das Herz der Sucher-App.
 *
 * Die erwarteten Zahlen sind unabhängig ausgerechnet: einmal die Kandidatenmenge vom
 * Amsterdam Centraal aus, je Fragetyp. Verrutscht eine Formel — etwa die
 * Mittelsenkrechte des Thermometers von der halben auf die ganze Strecke —, fällt es
 * hier sofort auf und nicht erst beim Spielen.
 *
 * Läuft ohne Build: `npm run check` (Node streift die Typen selbst ab).
 */
import fs from 'node:fs'
import { predicateFor, filterCandidates } from '../src/lib/eliminate.ts'
import { destinationFrom } from '../src/lib/geo.ts'

const D = new URL('../public/data/', import.meta.url).pathname
const J = (p: string) => JSON.parse(fs.readFileSync(`${D}/${p}`, 'utf8'))
const stations = J('stations.json').stations.filter((s: any) => s.ticketValid !== false)
const poiFile = J('poi.json')
const poisByCategory = new Map<string, any[]>()
for (const p of poiFile.pois) {
  const list = poisByCategory.get(p.category)
  if (list) list.push(p); else poisByCategory.set(p.category, [p])
}
const divisions: Record<string, any> = {}
for (const l of ['corop', 'gemeente', 'wijk', 'buurt']) divisions[l] = J(`divisions/${l}.json`).areas
const borders: Record<string, any> = { international: J('borders/international.json').segments }

const ctx = {
  poisByCategory,
  railStations: stations.filter((s: any) => s.isStation),
  divisionsFor: (l: any) => (l ? divisions[l] ?? [] : []),
  borderSegmentsFor: (id: any) => (id ? borders[id] ?? [] : []),
}
const CS = stations.find((s: any) => s.id === 'amsterdam-centraal')
const origin = { lat: CS.lat, lon: CS.lon }
const base = { id: 'x', questionId: 'q', categoryId: 'c', label: 'l', origin, askedAt: 0 }

let fails = 0
const check = (name: string, got: number, want: number) => {
  const ok = got === want
  if (!ok) fails++
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(52)} ${String(got).padStart(4)}  (erwartet ${want})`)
}
const n = (entries: any[]) => filterCandidates(stations, entries, ctx as any).length

console.log(`Halte gesamt: ${stations.length}\n`)

const radar10 = { ...base, viz: 'radius', radiusMeters: 10000, answer: 'yes' }
const borderCloser = { ...base, viz: 'border', borderId: 'international', answer: 'closer' }
check('Radar 10 km → ja', n([radar10]), 186)
check('Radar 10 km → nein', n([{ ...radar10, answer: 'no' }]), 273)
check('Landesgrenze → näher', n([borderCloser]), 249)
check('Radar 10 km ja + Landesgrenze näher', n([radar10, borderCloser]), 109)

for (const [deg, want] of [[270, 235], [0, 191], [225, 227], [90, 210], [180, 241]] as [number, number][]) {
  const dest = destinationFrom(origin, 1000, deg)
  check(`Thermometer 1 km, ${deg}° → wärmer`, n([{ ...base, viz: 'thermometer', radiusMeters: 1000, bearing: deg, destination: dest, answer: 'hotter' }]), want)
}
const dest5 = destinationFrom(origin, 5000, 180)
check('Thermometer 5 km, 180° (S) → wärmer', n([{ ...base, viz: 'thermometer', radiusMeters: 5000, bearing: 180, destination: dest5, answer: 'hotter' }]), 194)

check('Matching COROP → ja', n([{ ...base, viz: 'division', divisionLevel: 'corop', answer: 'yes' }]), 271)
check('Matching Gemeente → ja', n([{ ...base, viz: 'division', divisionLevel: 'gemeente', answer: 'yes' }]), 151)
check('Matching Wijk → ja', n([{ ...base, viz: 'division', divisionLevel: 'wijk', answer: 'yes' }]), 1)
check('Matching nächstes Zoo → ja', n([{ ...base, viz: 'poi-nearest', poiCategory: 'zoo', answer: 'yes' }]), 227)
check('Matching nächstes Krankenhaus → ja', n([{ ...base, viz: 'poi-nearest', poiCategory: 'hospital', answer: 'yes' }]), 51)
check('Measuring Park → näher', n([{ ...base, viz: 'poi-isodistance', poiCategory: 'park', answer: 'closer' }]), 200)
check('Measuring Flughafen → näher', n([{ ...base, viz: 'poi-isodistance', poiCategory: 'airport', answer: 'closer' }]), 149)
check('Measuring COROP-Grenze → näher', n([{ ...base, viz: 'division-border', divisionLevel: 'corop', answer: 'closer' }]), 343)
check('Measuring Bahnhof → weiter (am CS immer)', n([{ ...base, viz: 'poi-isodistance', poiCategory: 'station', answer: 'further' }]), 459)
check('Photos (unknown) schliesst nichts aus', n([{ ...base, viz: 'none', answer: 'unknown' }]), 459)
check('keine Antworten', n([]), 459)

console.time('  filterCandidates ×100 (4 Antworten, inkl. buurt)')
const buurt = { ...base, viz: 'division', divisionLevel: 'buurt', answer: 'no' }
for (let i = 0; i < 100; i++) n([radar10, borderCloser, buurt, { ...base, viz: 'poi-nearest', poiCategory: 'museum', answer: 'no' }])
console.timeEnd('  filterCandidates ×100 (4 Antworten, inkl. buurt)')

console.log(fails ? `\n${fails} Abweichung(en)` : '\nAlle Prüfungen bestanden')
process.exit(fails ? 1 : 0)
