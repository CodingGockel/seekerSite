/**
 * Die Rahmen, in denen Daten beschafft werden.
 *
 * Sie werden aus dem Spielgebiet gerechnet, nicht von Hand gesetzt: `public/data/area.geojson`
 * gepuffert. Damit wandern sie mit, wenn sich die Stationsliste ändert — vorher standen hier
 * feste Zahlen, die der Zone hinterherliefen.
 *
 * Drei Rahmen, weil ein einziger Abstand nicht für alles reicht:
 *
 * - NEAR (+25 km): für alles, wonach „am nächsten" gefragt wird. Ein Museum knapp ausserhalb
 *   der Gebietsgrenze zählt für eine Randstation sehr wohl. Gemessen liegt der weiteste
 *   „nächste" dieser Kategorien bei 11,4 km (Kino), 25 km ist also gut das Doppelte.
 *   Zusätzlich als Polygon (NEAR_RING) ausgegeben: `fetch-pois.mjs` wirft damit hinterher
 *   weg, was zwar im Rechteck, aber nicht im 25-km-Ring um das Gebiet liegt.
 *
 * - FAR (+100 km): für die seltenen Kategorien — Aquarium, Flughafen, Zoo, Freizeitpark,
 *   Konsulat. Bei ihnen bestimmt die Dichte die nötige Weite, nicht die Zone: im 25-km-Ring
 *   liegen ganze drei Aquarien, das nächste ist für die meisten Halte weiter weg als der
 *   Rand. Es sind zusammen rund 370 Datensätze, der weite Rahmen kostet also fast nichts.
 *
 * - INNER (+5 km): für Ebenen, nach denen nur „dieselbe wie meine?" gefragt wird — welche
 *   Wijk 20 km ausserhalb liegt, entscheidet keine Antwort. Auf Buurt-Ebene spart das ein
 *   Drittel der Datei.
 *
 * Alle Rechtecke S, W, N, O — die Reihenfolge, die Overpass und der PDOK-WFS erwarten.
 */
import { readFileSync } from 'node:fs'
import buffer from '@turf/buffer'
import { bboxOf } from './geojson.mjs'

export const NEAR_KM = 25
export const FAR_KM = 100
export const INNER_KM = 5

const areaUrl = new URL('../../public/data/area.geojson', import.meta.url)

let area
try {
  area = JSON.parse(readFileSync(areaUrl, 'utf8'))
} catch (err) {
  throw new Error(
    `public/data/area.geojson nicht lesbar (${err.message}) — erst "npm run data:area" laufen lassen.`,
  )
}

/** Das Spielgebiet als Feature: konvexe Hülle über die spielbaren Halte plus 2 km. */
export const AREA = area.features?.[0]
if (!AREA?.geometry) throw new Error('public/data/area.geojson enthält kein Feature mit Geometrie')

const ring = (km) => buffer(AREA, km, { units: 'kilometers' })

/** Auf 5 Nachkommastellen — gut 1 m, und die Zahl steht so in jeder erzeugten Datei. */
const rounded = (geometry) => bboxOf(geometry).map((v) => Number(v.toFixed(5)))

/** Der 25-km-Ring als Polygon — für den Punkt-in-Fläche-Test nach der Abfrage. */
export const NEAR_RING = ring(NEAR_KM).geometry

export const BBOX = rounded(NEAR_RING)
export const FAR_BBOX = rounded(ring(FAR_KM).geometry)
export const INNER_BBOX = rounded(ring(INNER_KM).geometry)
