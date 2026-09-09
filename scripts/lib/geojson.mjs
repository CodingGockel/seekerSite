/**
 * Was die Beschaffungsskripte an GeoJSON gemeinsam haben.
 *
 * Die Quellen liefern Koordinaten mit fünfzehn Nachkommastellen und mehr Stützpunkten,
 * als eine Karte auf einem Handy je auflöst. Beides kostet nur Bytes.
 */
import simplify from '@turf/simplify'

/** Meter in Grad — die Toleranz von @turf/simplify rechnet in Koordinateneinheiten. */
const METERS_PER_DEGREE = 111_320

/**
 * Koordinaten auf 5 Nachkommastellen — gut 1 m, dieselbe Genauigkeit wie im
 * Link-Schema (`COORD_DIGITS` in src/lib/share.ts).
 */
export function roundCoords(coords) {
  if (typeof coords[0] === 'number') {
    return [Number(coords[0].toFixed(5)), Number(coords[1].toFixed(5))]
  }
  return coords.map(roundCoords)
}

/** Zählt die Stützpunkte — für die Zusammenfassung, die jedes Skript am Ende ausgibt. */
export function countPoints(coords) {
  if (typeof coords[0] === 'number') return 1
  return coords.reduce((sum, c) => sum + countPoints(c), 0)
}

/**
 * Ausdünnen und runden in einem Schritt.
 *
 * `mutate` ist erlaubt: die Eingabe kommt frisch aus der Antwort und wird danach
 * nicht mehr gebraucht.
 */
export function thin(geometry, toleranceMeters) {
  const simplified = simplify(
    { type: 'Feature', properties: {}, geometry },
    { tolerance: toleranceMeters / METERS_PER_DEGREE, highQuality: false, mutate: true },
  )
  return { type: simplified.geometry.type, coordinates: roundCoords(simplified.geometry.coordinates) }
}

/**
 * Umschliessendes Rechteck einer Geometrie als [S, W, N, O] — die Reihenfolge, die
 * Overpass und der PDOK-WFS erwarten, nicht die von GeoJSON.
 */
export function bboxOf(geometry) {
  let s = Infinity
  let w = Infinity
  let n = -Infinity
  let o = -Infinity
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords
      if (lat < s) s = lat
      if (lat > n) n = lat
      if (lon < w) w = lon
      if (lon > o) o = lon
      return
    }
    coords.forEach(walk)
  }
  walk(geometry.coordinates)
  return [s, w, n, o]
}

/**
 * Liegt der Punkt in der Fläche? Strahlverfahren, Löcher zählen als aussen.
 *
 * Dasselbe steht als `containsPoint` in src/lib/geo.ts. Das ist TypeScript und aus einem
 * Skript nicht zu importieren; die zwanzig Zeilen zu spiegeln ist billiger als eine
 * Abhängigkeit für sie.
 */
export function containsPoint(geometry, lon, lat) {
  const polygons =
    geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  return polygons.some((rings) => {
    // Der erste Ring ist die Aussenkante, alle weiteren sind Löcher.
    if (!inRing(rings[0], lon, lat)) return false
    return !rings.slice(1).some((hole) => inRing(hole, lon, lat))
  })
}

function inRing(ring, lon, lat) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}
