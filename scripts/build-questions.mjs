#!/usr/bin/env node
/**
 * Reichert die Fragekarten um das an, was die App zum Zeichnen braucht.
 *
 * Aus jetlag_questions_medium.json (nur Fragetexte) wird public/data/questions.json
 * mit stabiler ID je Frage, Visualisierungstyp und POI-Bezug.
 *
 *   node scripts/build-questions.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { slug } from './lib/overpass.mjs'

const SRC = new URL('../jetlag_questions_medium.json', import.meta.url)
const POIS = new URL('../public/data/poi.json', import.meta.url)
const STATIONS = new URL('../public/data/stations.json', import.meta.url)
const AREA = new URL('../public/data/area.geojson', import.meta.url)
const DIVISIONS = new URL('../public/data/divisions/', import.meta.url)
const BORDERS = new URL('../public/data/borders/', import.meta.url)
const OUT = new URL('../public/data/questions.json', import.meta.url)

/**
 * Radar und Thermometer bekommen metrische Werte statt der Original-Meilen.
 * Das Spielgebiet misst rund 45 x 40 km — die Originalkarten reichen bis 100 Meilen
 * (161 km) und schliessen damit nichts mehr aus.
 */
const RADAR_RADII = [500, 1000, 2000, 5000, 10000, 20000, 40000]
const THERMOMETER_DISTANCES = [1000, 5000, 15000]

/**
 * Fragetext -> POI-Kategorie. Matching und Measuring benutzen dieselben
 * Bezeichnungen, Tentacles hängt eine Entfernung an ("Museums (1 mi)").
 */
const POI_BY_LABEL = {
  'Commercial Airport': 'airport',
  Museum: 'museum',
  Museums: 'museum',
  Library: 'library',
  Libraries: 'library',
  'Movie Theater': 'cinema',
  'Movie Theaters': 'cinema',
  Hospital: 'hospital',
  Hospitals: 'hospital',
  Zoo: 'zoo',
  Aquarium: 'aquarium',
  'Golf Course': 'golf_course',
  'Amusement Park': 'theme_park',
  Park: 'park',
  'Foreign Consulate': 'consulate',
  // Bahnhöfe stehen nicht in poi.json — dafür gibt es stations.json.
  'Rail Station': 'station',
}

/**
 * Fragetext -> Verwaltungsebene, aus scripts/fetch-divisions.mjs.
 *
 * Die Niederlande kennen formal nur zwei Ebenen, Provincie -> Gemeente. Als 1. Ebene
 * ist die Provinz hier trotzdem unbrauchbar: im Spielfeld liegen drei, rund vier
 * Fünftel davon Noord-Holland — „gleiche Provinz?" antwortet fast immer „ja" und
 * verschenkt einen Zug. Die COROP-Gebiete (NUTS-3, amtlich, flächendeckend) bringen
 * an derselben Stelle neun Regionen ins Feld und teilen es sauber auf.
 *
 * Darunter geht es mit den offiziellen CBS-Rastern weiter: Gemeente, dann Wijk, dann
 * Buurt. Alle vier kommen aus derselben Quelle, und ihre Grenzen sind unterwegs
 * nachschlagbar — Gemeentegrenzen zeigt zur Not Google Maps, Wijk und Buurt die
 * CBS-Wijk- und Buurtkarte.
 */
/**
 * Fragetext -> Grenzlinie, aus scripts/fetch-borders.mjs.
 *
 * Die Landesgrenze ist die einzige Grenze im Spiel, die keine Fläche umschliesst, in der
 * jemand stehen könnte — gefragt ist nur der Abstand zu ihr. Sie liegt rund hundert
 * Kilometer östlich des Spielfelds; die Frage läuft damit praktisch auf „stehst du
 * weiter östlich als ich?" hinaus und sagt über die Breite des Felds sehr wohl etwas aus.
 */
const BORDER_BY_LABEL = {
  'International Border': 'international',
}

const DIVISION_BY_LABEL = {
  '1st Administrative Division': 'corop',
  '2nd Administrative Division': 'gemeente',
  '3rd Administrative Division': 'wijk',
  '4th Administrative Division': 'buurt',
  '1st Administrative Division Border': 'corop',
  '2nd Administrative Division Border': 'gemeente',
}

function formatMeters(m) {
  if (m < 1000) return `${m} m`
  const km = m / 1000
  // 1609 m (eine Meile) soll "1,6 km" heissen, nicht "1.609 km".
  return `${Number.isInteger(km) ? km : km.toFixed(1).replace('.', ',')} km`
}

/** Trennt "Museums (1 mi)" in Bezeichnung und Radius. */
function parseTentacle(text) {
  const match = text.match(/^(.*?)\s*\(([\d.]+)\s*mi\)$/)
  if (!match) return { label: text, radiusMeters: 1609 }
  return { label: match[1], radiusMeters: Math.round(Number(match[2]) * 1609.34) }
}

const source = JSON.parse(await readFile(SRC, 'utf8'))
const poiFile = JSON.parse(await readFile(POIS, 'utf8'))
const stationFile = JSON.parse(await readFile(STATIONS, 'utf8'))
const areaFile = JSON.parse(await readFile(AREA, 'utf8'))

const borderFiles = Object.fromEntries(
  await Promise.all(
    [...new Set(Object.values(BORDER_BY_LABEL))].map(async (id) => [
      id,
      JSON.parse(await readFile(new URL(`${id}.json`, BORDERS), 'utf8')),
    ]),
  ),
)

const divisionLevels = [...new Set(Object.values(DIVISION_BY_LABEL))]
const divisionFiles = Object.fromEntries(
  await Promise.all(
    divisionLevels.map(async (id) => [
      id,
      JSON.parse(await readFile(new URL(`${id}.json`, DIVISIONS), 'utf8')),
    ]),
  ),
)

const poiCounts = poiFile.pois.reduce((acc, p) => ({ ...acc, [p.category]: (acc[p.category] ?? 0) + 1 }), {})
// „Rail Station" meint Bahnhöfe — die Liste enthält auch Tram- und Bushaltestellen.
poiCounts.station = stationFile.stations.filter(
  (s) => s.ticketValid !== false && s.isStation,
).length

/** Umschliessendes Rechteck einer GeoJSON-Geometrie als [west, süd, ost, nord]. */
function boundsOf(coords, box = [180, 90, -180, -90]) {
  if (typeof coords[0] === 'number') {
    const [lon, lat] = coords
    return [Math.min(box[0], lon), Math.min(box[1], lat), Math.max(box[2], lon), Math.max(box[3], lat)]
  }
  return coords.reduce((acc, c) => boundsOf(c, acc), box)
}

/** Liegt der Punkt im Ring? Strahlenschnitt, [lon, lat]. */
function inRing(ring, [lon, lat]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Das Spielgebiet ist die konvexe Hülle über alle bespielbaren Halte (build-area.mjs),
// ein einzelnes Polygon ohne Löcher.
const areaRing = areaFile.features[0].geometry.coordinates[0]

/**
 * Wie viele Flächen einer Ebene liegen im Spielgebiet?
 *
 * Die Dateien reichen bewusst über das Gebiet hinaus — für „wie weit ist die nächste
 * Grenze?" muss auch die Nachbargemeente dabei sein. Für die Frage, ob eine Karte
 * etwas aussagt, zählt dagegen nur, worin die Spieler überhaupt stehen können.
 *
 * Geprüft wird der Mittelpunkt des umschliessenden Rechtecks gegen die Hülle, nicht
 * das Rechteck gegen das Rechteck der Hülle: die Hülle ist ein schräges Vieleck, ihr
 * Rechteck nimmt an den Ecken ganze Landstriche mit. Auf Wijk-Ebene macht das den
 * Unterschied zwischen „schwach" und „brauchbar", also darf es nicht danebenliegen.
 */
const divisionCounts = Object.fromEntries(
  Object.entries(divisionFiles).map(([id, file]) => [
    id,
    file.areas.filter((a) => {
      const [west, south, east, north] = boundsOf(a.geometry.coordinates)
      return inRing(areaRing, [(west + east) / 2, (south + north) / 2])
    }).length,
  ]),
)

/**
 * Wie aussagekräftig ist die Frage mit den tatsächlich vorhandenen Daten?
 * Gibt es nur einen Flughafen in der Region, lautet die Antwort auf "ist dein
 * nächster Flughafen meiner?" immer ja — die Frage verschenkt einen Zug.
 *
 * "Rail Station" galt früher als schwach, weil der Hider per Regel an einem
 * Bahnhof stand. Seit auch Tram- und Bushaltestellen Verstecke sind, sagt die
 * Frage wieder etwas aus.
 */
function weaknessOf(viz, poiCategory, divisionLevel) {
  if (divisionLevel) {
    const count = divisionCounts[divisionLevel] ?? 0
    // Nur die Matching-Karte lebt von der Identität der Fläche. „Wie weit ist die
    // nächste Grenze?" sagt auch bei tausend Buurten etwas aus.
    if (viz !== 'division') return null
    return null
  }
  if (!poiCategory) return null
  const count = poiCounts[poiCategory] ?? 0
  if (count === 0) return 'keine Daten in der Region'
  if (viz === 'poi-nearest') {
  }
  if (viz === 'poi-within' && count < 3) return `nur ${count} in der Region`
  return null
}

const usedIds = new Set()
function makeId(categoryId, label) {
  let id = `${categoryId}:${slug(label)}`
  if (usedIds.has(id)) {
    let n = 2
    while (usedIds.has(`${id}-${n}`)) n++
    id = `${id}-${n}`
  }
  usedIds.add(id)
  return id
}

function buildQuestion(categoryId, text) {
  // Radar und Thermometer werden nicht aus der Vorlage übernommen, sondern unten
  // aus den metrischen Werten erzeugt.
  if (categoryId === 'tentacles') {
    const { label, radiusMeters } = parseTentacle(text)
    const poiCategory = POI_BY_LABEL[label] ?? null
    const viz = poiCategory ? 'poi-within' : 'none'
    return {
      id: makeId(categoryId, label),
      label: `${label} (${formatMeters(radiusMeters)})`,
      viz,
      poiCategory,
      radiusMeters,
      weak: weaknessOf(viz, poiCategory),
    }
  }

  if (categoryId === 'photos') {
    return { id: makeId(categoryId, text), label: text, viz: 'none', poiCategory: null, weak: null }
  }

  // Die Landesgrenze ist eine Linie: kein Ort, keine Fläche, nur ein Abstand.
  const borderId = BORDER_BY_LABEL[text] ?? null
  if (borderId) {
    return {
      id: makeId(categoryId, text),
      label: text,
      viz: 'border',
      poiCategory: null,
      borderId,
      borderLabel: borderFiles[borderId].label,
      weak: null,
    }
  }

  // Verwaltungsebenen zuerst: sie zeichnen Flächen, nicht Punkte, und tragen deshalb
  // keine POI-Kategorie.
  const divisionLevel = DIVISION_BY_LABEL[text] ?? null
  if (divisionLevel) {
    // Matching fragt nach der Fläche selbst, Measuring nach dem Abstand zu ihrer Grenze.
    const viz = categoryId === 'matching' ? 'division' : 'division-border'
    return {
      id: makeId(categoryId, text),
      label: text,
      viz,
      poiCategory: null,
      divisionLevel,
      divisionLabel: divisionFiles[divisionLevel].label,
      weak: weaknessOf(viz, null, divisionLevel),
    }
  }

  const poiCategory = POI_BY_LABEL[text] ?? null
  // Matching fragt nach dem nächstgelegenen Objekt, Measuring vergleicht Abstände.
  const viz = poiCategory ? (categoryId === 'matching' ? 'poi-nearest' : 'poi-isodistance') : 'none'
  return {
    id: makeId(categoryId, text),
    label: text,
    viz,
    poiCategory,
    weak: weaknessOf(viz, poiCategory),
  }
}

const categories = source.categories.map((category) => {
  let questions

  if (category.id === 'radar') {
    questions = [
      ...RADAR_RADII.map((radiusMeters) => ({
        id: makeId('radar', formatMeters(radiusMeters)),
        label: formatMeters(radiusMeters),
        viz: 'radius',
        poiCategory: null,
        radiusMeters,
        weak: null,
      })),
      {
        id: makeId('radar', 'frei waehlbar'),
        label: 'Frei wählbar',
        viz: 'radius',
        poiCategory: null,
        radiusMeters: null,
        weak: null,
      },
    ]
  } else if (category.id === 'thermometer') {
    // Zeichenbar, seit die Sucher-App Antworten entgegennimmt: Start ist der eigene
    // Standort, das Ziel liegt `radiusMeters` in der gewählten Richtung. „wärmer/kälter"
    // trennt an der Mittelsenkrechten — die liegt auf der halben Strecke.
    questions = THERMOMETER_DISTANCES.map((radiusMeters) => ({
      id: makeId('thermometer', formatMeters(radiusMeters)),
      label: `nach ${formatMeters(radiusMeters)} Fahrt`,
      viz: 'thermometer',
      poiCategory: null,
      radiusMeters,
      weak: null,
    }))
  } else {
    questions = category.questions.map((text) => buildQuestion(category.id, text))
  }

  return {
    id: category.id,
    name: category.name,
    prompt: category.prompt,
    answers: category.answers,
    timeLimitMin: category.timeLimitMin,
    cards: category.cards,
    questions,
  }
})

const all = categories.flatMap((c) => c.questions)

await writeFile(
  OUT,
  JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: 'jetlag_questions_medium.json',
      game: source.game,
      size: source.size,
      note: 'Radar- und Thermometer-Werte sind metrisch und auf das Spielgebiet zugeschnitten.',
      categories,
    },
    null,
    2,
  ) + '\n',
)

const drawable = all.filter((q) => q.viz !== 'none')
process.stderr.write(`${all.length} Fragen geschrieben\n`)
process.stderr.write(`  auf der Karte zeigbar: ${drawable.length}\n`)
process.stderr.write(`  nur abhakbar:          ${all.length - drawable.length}\n`)
process.stderr.write(`  davon schwach:         ${all.filter((q) => q.weak).length}\n\n`)
for (const c of categories) {
  const d = c.questions.filter((q) => q.viz !== 'none').length
  process.stderr.write(`  ${c.name.padEnd(13)} ${String(c.questions.length).padStart(3)} Fragen, ${d} zeigbar\n`)
}
process.stderr.write('\nAls schwach markiert:\n')
for (const q of all.filter((q) => q.weak)) {
  process.stderr.write(`  ${q.id.padEnd(28)} ${q.weak}\n`)
}
