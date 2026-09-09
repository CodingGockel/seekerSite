#!/usr/bin/env node
/**
 * Erzeugt die Stationsliste aus der kuratierten Versteck-Liste.
 *
 * Quelle ist data/artt_verstecke.geojson: alle Halte, die mit dem Amsterdam &
 * Region Travel Ticket erreichbar sind — Bahn, Metro und Fähre vollständig,
 * Bus und Tram auf 650 m Abstand ausgedünnt. Jeder Halt ist ein gültiges
 * Versteck (Spielerklärung: Zentrum der Zone ist die Haltestelle, 800 m Radius).
 *
 * Vorher zog scripts/fetch-stations.mjs die Liste aus OpenStreetMap. Die
 * kuratierte Datei ist genauer (sie kennt das Ticketgebiet und die Linien),
 * deshalb ist das Overpass-Skript entfallen.
 *
 *   node scripts/import-stations.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { distance, slug } from './lib/overpass.mjs'

const SRC = new URL('../data/artt_verstecke.geojson', import.meta.url)
const OUT = new URL('../public/data/stations.json', import.meta.url)

/** Spalte in der GeoJSON -> Verkehrsmittel. `rail` heisst bei uns `train`. */
const LINE_COLUMNS = { rail: 'train', metro: 'metro', tram: 'tram', bus: 'bus', ferry: 'ferry' }

/**
 * Bahnhöfe stehen doppelt in der Liste: einmal unter dem NS-Namen ("Amsterdam
 * Centraal"), einmal unter dem GVB-Namen ("Centraal Station"). Die Paare liegen
 * alle unter 100 m auseinander, das nächste echte Bahnhofspaar über 800 m —
 * 300 m trennt also sauber. Bewusst nur zwischen Bahnhöfen: eine Bushaltestelle
 * vor dem Bahnhof ist ein eigener Halt und darf nicht verschluckt werden.
 */
const MERGE_RADIUS = 300

/** "12, 25" -> ["12", "25"] */
function splitLines(value) {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Der aussagekräftigere der beiden Namen. Das führende "Station " der
 * GVB-Schreibweise trägt nichts bei, danach gewinnt der längere Name — das ist
 * für alle Paare der offizielle NS-Name.
 */
function pickName(names) {
  const bare = (n) => n.replace(/^Station /, '')
  // Längster Name ohne das Präfix; bei Gleichstand ("Duivendrecht" vs. "Station
  // Duivendrecht") der kürzere, also der ohne Präfix.
  return [...names].sort((a, b) => bare(b).length - bare(a).length || a.length - b.length)[0]
}

const geo = JSON.parse(await readFile(SRC, 'utf8'))

const points = geo.features.map((f) => {
  const p = f.properties
  const [lon, lat] = f.geometry.coordinates
  const lines = {}
  for (const [column, mode] of Object.entries(LINE_COLUMNS)) {
    const values = splitLines(p[column])
    if (values.length) lines[mode] = values
  }
  return {
    name: p.name,
    lat,
    lon,
    mode: p.mode,
    lines,
    isStation: p.is_station === 1,
    extraCost: p.extra_kosten === 1,
  }
})

// Doppelte Bahnhöfe zusammenführen.
const clusters = []
let mergedCount = 0

for (const point of points) {
  const hit = point.isStation
    ? clusters.find((c) => c.isStation && distance(c, point) < MERGE_RADIUS)
    : null

  if (!hit) {
    clusters.push({ ...point, names: [point.name] })
    continue
  }

  mergedCount++
  hit.names.push(point.name)
  hit.extraCost = hit.extraCost || point.extraCost
  for (const [mode, values] of Object.entries(point.lines)) {
    hit.lines[mode] = [...new Set([...(hit.lines[mode] ?? []), ...values])]
  }
}

const merged = clusters.map((c) => {
  const name = pickName(c.names)
  return {
    ...c,
    name,
    aliases: c.names.filter((n) => n !== name),
  }
})

// Gleiche Namen an verschiedenen Orten gibt es wirklich: Zaandam ist Bahnhof und
// Fähranleger, Postjesweg Metro- und Tramhaltestelle. Der Modus trennt sie, und
// die ID bleibt unabhängig von der Reihenfolge der Datei stabil.
const slugCounts = new Map()
for (const m of merged) slugCounts.set(slug(m.name), (slugCounts.get(slug(m.name)) ?? 0) + 1)

const usedIds = new Set()
function idFor(station) {
  const base = slug(station.name)
  let id = slugCounts.get(base) > 1 ? `${base}-${station.mode}` : base
  if (usedIds.has(id)) {
    let n = 2
    while (usedIds.has(`${id}-${n}`)) n++
    id = `${id}-${n}`
  }
  usedIds.add(id)
  return id
}

// Vorhandene Kuratierung einlesen, damit sie einen erneuten Lauf überlebt.
let curated = new Map()
try {
  const prev = JSON.parse(await readFile(OUT, 'utf8'))
  curated = new Map(prev.stations.map((s) => [s.id, s]))
  process.stderr.write(`${curated.size} vorhandene Einträge werden auf Kuratierung geprüft\n`)
} catch {
  process.stderr.write('keine vorhandene stations.json — Neuanlage\n')
}

const stations = merged.map((m) => {
  const id = idFor(m)
  const prev = curated.get(id)
  return {
    id,
    name: m.name,
    aliases: m.aliases,
    lat: Number(m.lat.toFixed(6)),
    lon: Number(m.lon.toFixed(6)),
    mode: m.mode,
    lines: m.lines,
    isStation: m.isStation,
    // Ausserhalb des Ticketgebiets: erreichbar, aber gegen Aufpreis.
    extraCost: m.extraCost,
    // false schliesst einen Halt vom Spiel aus; Standard ist bespielbar.
    ticketValid: prev?.ticketValid ?? true,
    notes: prev?.notes ?? '',
  }
})

stations.sort((a, b) => a.name.localeCompare(b.name, 'nl'))

await writeFile(
  OUT,
  JSON.stringify(
    {
      version: 2,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: 'data/artt_verstecke.geojson (kuratierte ARTT-Versteckliste)',
      stations,
    },
    null,
    2,
  ) + '\n',
)

const byMode = stations.reduce((acc, s) => ({ ...acc, [s.mode]: (acc[s.mode] ?? 0) + 1 }), {})

process.stderr.write(`\n${stations.length} Halte geschrieben (${mergedCount} zusammengeführt)\n`)
process.stderr.write(`  nach Modus: ${JSON.stringify(byMode)}\n`)
process.stderr.write(`  mit Aufpreis: ${stations.filter((s) => s.extraCost).length}\n`)
process.stderr.write(`  Bahnhöfe: ${stations.filter((s) => s.isStation).length}\n`)
process.stderr.write(`  ausgeschlossen (ticketValid: false): ${stations.filter((s) => s.ticketValid === false).length}\n`)
