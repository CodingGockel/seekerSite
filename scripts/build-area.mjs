#!/usr/bin/env node
/**
 * Erzeugt das Spielgebiet-Polygon aus der Stationsliste.
 *
 * Konvexe Hülle über alle spielbaren Stationen, danach ein Puffer, damit die
 * Randstationen nicht exakt auf der Gebietsgrenze liegen. Das Polygon ist rein
 * visuell — verbindlich ist immer die Stationsliste.
 *
 * Nach jeder Änderung an stations.json neu laufen lassen:
 *   node scripts/build-area.mjs
 *
 * Ein von Hand gezeichnetes area.geojson kann stattdessen abgelegt werden; dann
 * dieses Skript einfach nicht mehr aufrufen.
 */
import { readFile, writeFile } from 'node:fs/promises'
import convex from '@turf/convex'
import buffer from '@turf/buffer'
import { featureCollection, point } from '@turf/helpers'

const PADDING_KM = 2

const stationsUrl = new URL('../public/data/stations.json', import.meta.url)
const outUrl = new URL('../public/data/area.geojson', import.meta.url)

const { stations } = JSON.parse(await readFile(stationsUrl, 'utf8'))

// Ausdrücklich ausgeschlossene Halte dürfen das Gebiet nicht aufblähen. Die
// Aufpreis-Bahnhöfe zählen dagegen mit: sie sind bespielbar, also gehören sie ins
// Gebiet — auch wenn die Hülle dadurch bis Utrecht und Alkmaar reicht.
const playable = stations.filter((s) => s.ticketValid !== false)
if (playable.length < 3) {
  throw new Error(`Zu wenige spielbare Stationen für eine Hülle: ${playable.length}`)
}

const hull = convex(featureCollection(playable.map((s) => point([s.lon, s.lat]))))
if (!hull) throw new Error('Konvexe Hülle konnte nicht berechnet werden')

const padded = buffer(hull, PADDING_KM, { units: 'kilometers' })

padded.properties = {
  name: 'Spielgebiet',
  generatedBy: 'scripts/build-area.mjs',
  generatedAt: new Date().toISOString().slice(0, 10),
  stationCount: playable.length,
  paddingKm: PADDING_KM,
}

await writeFile(outUrl, JSON.stringify(featureCollection([padded])) + '\n')

const ring = padded.geometry.coordinates[0]
process.stderr.write(
  `Spielgebiet aus ${playable.length} Stationen geschrieben (${ring.length} Stützpunkte)\n`,
)
