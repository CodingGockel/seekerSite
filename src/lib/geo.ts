import type L from 'leaflet'

/** Luftlinie zwischen zwei Punkten in Metern (Haversine). */
export function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** "240 m" bzw. "3,4 km" — auf dem Handy will niemand 3417,82 m lesen. */
export function formatDistance(meters: number | null): string {
  if (meters == null) return '–'
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`
}

/** Der nächstgelegene Eintrag samt Entfernung, oder null bei leerer Liste. */
export function nearest<T extends { lat: number; lon: number }>(
  from: { lat: number; lon: number },
  candidates: T[],
): { item: T; distance: number } | null {
  let best: { item: T; distance: number } | null = null
  for (const item of candidates) {
    const distance = distanceMeters(from, item)
    if (!best || distance < best.distance) best = { item, distance }
  }
  return best
}

// ---------------------------------------------------------------------------
// Flächen
// ---------------------------------------------------------------------------
//
// Die Verwaltungsebenen sind Polygone, keine Punkte. Was sie brauchen, sind zwei
// Fragen: „liege ich darin?" und „wie weit ist der Rand?". Beides steht hier von
// Hand, wie die Haversine-Formel oben — Turf läuft in diesem Projekt nur in den
// Build-Skripten, und für zwei Funktionen lohnt es sich im Bundle nicht.

/** GeoJSON ist [lon, lat], Leaflet will [lat, lon]. Ringe wie Linienzüge. */
export function toLatLngRings(geometry: GeoJSON.Geometry): L.LatLngExpression[][] {
  return edgesOf(geometry).map((edge) => edge.map(([lon, lat]) => [lat, lon] as L.LatLngExpression))
}

/** Die Ringe einer Geometrie, nach Polygonen gruppiert: erster Ring aussen, Rest Löcher. */
function polygonsOf(geometry: GeoJSON.Geometry): GeoJSON.Position[][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

/**
 * Alle Kantenzüge einer Geometrie — die Ringe einer Fläche wie die Züge einer Linie.
 *
 * Für „wie weit ist der Rand?" ist beides dasselbe: eine Folge von Strecken. Nur so
 * kann die Landesgrenze, die keine Fläche umschliesst, denselben Weg gehen wie eine
 * Gemeentegrenze.
 */
function edgesOf(geometry: GeoJSON.Geometry): GeoJSON.Position[][] {
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  return polygonsOf(geometry).flat()
}

/** Strahlenschnitt gegen einen einzelnen Ring. */
function inRing(ring: GeoJSON.Position[], point: { lat: number; lon: number }): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (
      yi > point.lat !== yj > point.lat &&
      point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Liegt der Punkt in der Fläche?
 *
 * Löcher zählen: der Punkt muss im äusseren Ring liegen und in keinem inneren. Der
 * Amsterdamer Stadtteil, in dem ein See ausgespart ist, wäre sonst falsch beantwortet.
 */
export function containsPoint(
  geometry: GeoJSON.Geometry,
  point: { lat: number; lon: number },
): boolean {
  for (const rings of polygonsOf(geometry)) {
    const [outer, ...holes] = rings
    if (!outer || !inRing(outer, point)) continue
    if (holes.some((hole) => inRing(hole, point))) continue
    return true
  }
  return false
}

/**
 * Der nächstgelegene Punkt auf dem Rand einer Fläche oder auf einer Linie, samt
 * Entfernung.
 *
 * Gerechnet wird in einer flachen Ebene um `from`: ein Grad Breite ist überall gleich
 * lang, ein Grad Länge um den Faktor cos(Breite) kürzer. Über die paar Kilometer, um
 * die es hier geht, ist das von der Kugel nicht zu unterscheiden — und es macht aus
 * dem Abstand Punkt-zu-Strecke eine Zeile statt einer Fallunterscheidung.
 *
 * Die zurückgegebene Entfernung kommt trotzdem aus `distanceMeters`, damit auf der
 * Karte dieselbe Zahl steht wie überall sonst.
 */
export function nearestPointOnEdges(
  from: { lat: number; lon: number },
  geometry: GeoJSON.Geometry,
): { lat: number; lon: number; distance: number } | null {
  const scale = Math.cos((from.lat * Math.PI) / 180)
  const x = (lon: number) => (lon - from.lon) * scale
  const y = (lat: number) => lat - from.lat

  let best: { lat: number; lon: number } | null = null
  let bestSq = Infinity

  for (const edge of edgesOf(geometry)) {
    for (let i = 1; i < edge.length; i++) {
      const [alon, alat] = edge[i - 1]
      const [blon, blat] = edge[i]
      const ax = x(alon)
      const ay = y(alat)
      const dx = x(blon) - ax
      const dy = y(blat) - ay

      // t ist die Position des Fusspunkts auf der Strecke, auf [0, 1] geklemmt:
      // liegt er hinter einem Ende, ist dieses Ende der nächste Punkt.
      const lenSq = dx * dx + dy * dy
      const t = lenSq > 0 ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lenSq)) : 0

      const px = ax + t * dx
      const py = ay + t * dy
      const distSq = px * px + py * py
      if (distSq >= bestSq) continue

      bestSq = distSq
      best = { lat: alat + t * (blat - alat), lon: alon + t * (blon - alon) }
    }
  }

  return best ? { ...best, distance: distanceMeters(from, best) } : null
}

/**
 * Der Punkt, der `meters` in Richtung `bearingDeg` von `origin` liegt — 0° ist Nord,
 * gezählt im Uhrzeigersinn.
 *
 * Für das Thermometer: die Sucher fahren nicht wirklich, sie wählen eine Richtung. Aus
 * Start und diesem Zielpunkt ergibt sich die Mittelsenkrechte, an der „wärmer/kälter"
 * die Karte trennt.
 *
 * Gerechnet in derselben flachen Ebene wie `nearestPointOnEdges`: über die paar
 * Kilometer, um die es geht, ist der Unterschied zur Kugel kleiner als die Genauigkeit
 * der Ortung.
 */
export function destinationFrom(
  origin: { lat: number; lon: number },
  meters: number,
  bearingDeg: number,
): { lat: number; lon: number } {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const theta = toRad(bearingDeg)
  const dLat = (meters * Math.cos(theta)) / R
  const dLon = (meters * Math.sin(theta)) / (R * Math.cos(toRad(origin.lat)))
  return {
    lat: origin.lat + (dLat * 180) / Math.PI,
    lon: origin.lon + (dLon * 180) / Math.PI,
  }
}

/** „NNO", „SW" … — 16 Kompasspunkte für die Anzeige einer Richtung. */
const COMPASS = [
  'N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]

export function formatBearing(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}
