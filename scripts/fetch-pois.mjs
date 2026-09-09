#!/usr/bin/env node
/**
 * Zieht die Orte aus OpenStreetMap, auf die sich die Fragekarten beziehen —
 * Museen, Bibliotheken, Kinos und so weiter.
 *
 * Der Rahmen ist bewusst grösser als das Spielgebiet: für „welches Museum ist dir
 * am nächsten?" muss auch ein Museum knapp ausserhalb der Gebietsgrenze zählen,
 * sonst bekommen die Randstationen ein falsches Ergebnis.
 *
 * Wie viel grösser, hängt an der Dichte der Kategorie, nicht am Gebiet — deshalb zwei
 * Rahmen (`scope`, s. scripts/lib/region.mjs): der 25-km-Ring für alles Dichte, und für
 * die fünf seltenen Kategorien 100 km, weil dort das nächste Exemplar sonst ausserhalb
 * liegt. Am Ende prüft das Skript nach, dass für jeden Halt jede Antwort in den Daten
 * steht, und bricht ab, wenn nicht.
 *
 *   node scripts/fetch-pois.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { distance, overpass, slug } from './lib/overpass.mjs'
import { containsPoint } from './lib/geojson.mjs'
import { BBOX, FAR_BBOX, FAR_KM, NEAR_KM, NEAR_RING } from './lib/region.mjs'

const OUT = new URL('../public/data/poi.json', import.meta.url)
const STATIONS = new URL('../public/data/stations.json', import.meta.url)

/**
 * Die Kategorien, auf die sich Matching-, Measuring- und Tentacles-Karten beziehen.
 *
 * `reject` filtert Treffer, die zwar das Tag tragen, aber nicht gemeint sind.
 * `scope: 'far'` zieht die Kategorie aus dem weiten statt aus dem nahen Rahmen — gesetzt
 * bei allem, wovon es zu wenige gibt, um den nächsten verlässlich im 25-km-Ring zu finden.
 *
 * Einen Namen braucht jeder Ort: die Karten fragen „welches X ist dir am nächsten?", und
 * was niemand benannt hat, ist meist auch kein X — ein Grünstreifen statt eines Parks, ein
 * Gehege statt eines Zoos.
 */
const CATEGORIES = [
  { id: 'museum', label: 'Museum', selector: '["tourism"="museum"]' },
  { id: 'library', label: 'Bibliothek', selector: '["amenity"="library"]' },
  { id: 'cinema', label: 'Kino', selector: '["amenity"="cinema"]' },
  { id: 'hospital', label: 'Krankenhaus', selector: '["amenity"="hospital"]' },
  { id: 'golf_course', label: 'Golfplatz', selector: '["leisure"="golf_course"]' },
  { id: 'theme_park', label: 'Freizeitpark', selector: '["tourism"="theme_park"]', scope: 'far' },
  { id: 'aquarium', label: 'Aquarium', selector: '["tourism"="aquarium"]', scope: 'far' },
  { id: 'consulate', label: 'Konsulat', selector: '["diplomatic"="consulate"]', scope: 'far' },
  {
    id: 'airport',
    label: 'Flughafen',
    selector: '["aeroway"="aerodrome"]',
    scope: 'far',
    // Die Karte fragt nach einem *Commercial* Airport. `aeroway=aerodrome` trifft
    // auch Segelflug- und Sportplätze, und ein ICAO-Code reicht als Merkmal nicht
    // (den hat auch ein Zweefvliegveld). Nur ein IATA-Code steht für Linienverkehr.
    reject: (tags) => !tags.iata,
  },
  {
    id: 'zoo',
    label: 'Zoo',
    selector: '["tourism"="zoo"]',
    scope: 'far',
    // In den Niederlanden sind die allermeisten `tourism=zoo` Kinderbauernhöfe
    // (kinderboerderij). Von 193 Treffern sind 163 Streichelzoos — ungefiltert
    // wäre die Zoo-Frage wertlos.
    //
    // `enclosure` und `aviary` sind aus demselben Grund draussen: ein Gehege ist ein Teil
    // eines Zoos, kein Zoo. Im weiten Rahmen sind das 35 benannte Treffer, und sie heissen
    // Hertenkamp, Dierenweide oder Wildgehege — auf „welcher Zoo ist näher?" antwortet
    // damit niemand.
    reject: (tags) => ['petting_zoo', 'enclosure', 'aviary'].includes(tags.zoo),
  },
  { id: 'park', label: 'Park', selector: '["leisure"="park"]' },
]

const FRAMES = {
  near: { bbox: BBOX, offsetKm: NEAR_KM },
  far: { bbox: FAR_BBOX, offsetKm: FAR_KM },
}

const frameOf = (category) => FRAMES[category.scope ?? 'near']

const query = `
[out:json][timeout:300];
(
${CATEGORIES.map((c) => `  nwr${c.selector}(${frameOf(c).bbox.join(',')});`).join('\n')}
);
out center tags;
`

/** Ordnet ein OSM-Objekt einer Kategorie zu — die erste passende gewinnt. */
function categoryOf(tags) {
  if (tags.tourism === 'museum') return 'museum'
  if (tags.amenity === 'library') return 'library'
  if (tags.amenity === 'cinema') return 'cinema'
  if (tags.amenity === 'hospital') return 'hospital'
  if (tags.leisure === 'golf_course') return 'golf_course'
  if (tags.tourism === 'theme_park') return 'theme_park'
  if (tags.tourism === 'aquarium') return 'aquarium'
  if (tags.diplomatic === 'consulate') return 'consulate'
  if (tags.aeroway === 'aerodrome') return 'airport'
  if (tags.tourism === 'zoo') return 'zoo'
  if (tags.leisure === 'park') return 'park'
  return null
}

const raw = await overpass(query)
process.stderr.write(`${raw.elements.length} Elemente von Overpass\n`)

const byCategory = new Map(CATEGORIES.map((c) => [c.id, c]))
const pois = []
const usedIds = new Set()
const skipped = { unnamed: 0, rejected: 0, noCategory: 0, noPosition: 0, outsideRing: 0 }

for (const el of raw.elements) {
  const tags = el.tags ?? {}

  const categoryId = categoryOf(tags)
  if (!categoryId) {
    skipped.noCategory++
    continue
  }
  const category = byCategory.get(categoryId)

  if (category.reject?.(tags)) {
    skipped.rejected++
    continue
  }

  const name = tags.name ?? tags['name:nl'] ?? tags['name:en']
  if (!name) {
    skipped.unnamed++
    continue
  }

  // Ways und Relations liefern über `out center` einen Mittelpunkt.
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (lat == null || lon == null) {
    skipped.noPosition++
    continue
  }

  // Abgefragt wird ein Rechteck, gemeint ist ein gleichmässiger Abstand rings um das
  // Gebiet. Was nur in den Ecken des Rechtecks liegt (Rotterdam, Den Haag), fliegt hier
  // wieder raus — sonst hinge die Dateigrösse an der Form des Gebiets.
  if ((category.scope ?? 'near') === 'near' && !containsPoint(NEAR_RING, lon, lat)) {
    skipped.outsideRing++
    continue
  }

  let id = `${categoryId}:${slug(name)}`
  if (usedIds.has(id)) {
    let n = 2
    while (usedIds.has(`${id}-${n}`)) n++
    id = `${id}-${n}`
  }
  usedIds.add(id)

  pois.push({
    id,
    name,
    category: categoryId,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  })
}

pois.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'nl'))

await writeFile(
  OUT,
  JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: 'OpenStreetMap via Overpass (ODbL)',
      // `bbox` ist der nahe Rahmen und bleibt für Leser, die nur einen kennen; welche
      // Kategorie aus welchem Rahmen stammt, steht in `frames` und je Kategorie in `scope`.
      bbox: BBOX,
      frames: {
        near: { bbox: BBOX, offsetKm: NEAR_KM },
        far: { bbox: FAR_BBOX, offsetKm: FAR_KM },
      },
      categories: CATEGORIES.map(({ id, label, scope }) => ({ id, label, scope: scope ?? 'near' })),
      pois,
    },
    // Kompakt: die Datei wird erzeugt, nie von Hand bearbeitet. Eingerückt wäre
    // sie ohne Nutzen ein Drittel grösser.
  ) + '\n',
)

const counts = pois.reduce((acc, p) => ({ ...acc, [p.category]: (acc[p.category] ?? 0) + 1 }), {})
process.stderr.write(`\n${pois.length} Orte geschrieben\n`)
for (const { id, label } of CATEGORIES) {
  process.stderr.write(`  ${label.padEnd(14)} ${String(counts[id] ?? 0).padStart(5)}\n`)
}
process.stderr.write(
  `  übersprungen: ${skipped.rejected} gefiltert, ${skipped.unnamed} ohne Namen, ` +
    `${skipped.noPosition} ohne Position, ${skipped.outsideRing} ausserhalb des Rings\n`,
)

/**
 * Nachrechnen, ob die Rahmen gereicht haben.
 *
 * Ein Halt liegt im Gebiet, also liegt alles im Umkreis des Offsets um ihn herum auch im
 * Rahmen. Die Antwort „welches X ist mir am nächsten?" steht damit genau dann sicher in
 * den Daten, wenn das nächste X näher ist als der Offset seiner Kategorie. Ist es das
 * irgendwo nicht, ist die Datei still falsch — genau das war der Fehler, der zu den zwei
 * Rahmen geführt hat, und deshalb bricht das Skript hier ab statt zu warnen.
 */
const { stations } = JSON.parse(await readFile(STATIONS, 'utf8'))
const playable = stations.filter((s) => s.ticketValid !== false)

process.stderr.write(`\nPrüfung an ${playable.length} Halten (weitester nächster Ort):\n`)
let unsafe = 0

for (const category of CATEGORIES) {
  const inCategory = pois.filter((p) => p.category === category.id)
  const { offsetKm } = frameOf(category)

  let worstKm = -Infinity
  let worstAt = null
  for (const station of playable) {
    let nearestKm = Infinity
    for (const poi of inCategory) {
      const km = distance(station, poi) / 1000
      if (km < nearestKm) nearestKm = km
    }
    if (nearestKm > worstKm) {
      worstKm = nearestKm
      worstAt = station.name
    }
  }

  const ok = worstKm < offsetKm
  if (!ok) unsafe++
  process.stderr.write(
    `  ${ok ? '✓' : '✗'} ${category.label.padEnd(14)} ${worstKm.toFixed(1).padStart(6)} km ` +
      `von ${offsetKm} km  (${worstAt})\n`,
  )
}

if (unsafe > 0) {
  process.stderr.write(
    `\n${unsafe} Kategorie(n) reichen nicht bis zum nächsten Ort — Rahmen in ` +
      `scripts/lib/region.mjs vergrössern und neu laufen lassen.\n`,
  )
  process.exit(1)
}
