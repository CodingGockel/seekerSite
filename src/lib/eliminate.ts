import type {
  AnsweredQuestion,
  BorderSegment,
  DivisionArea,
  LatLon,
  Poi,
  Station,
} from '../types/game'
import { containsPoint, distanceMeters, nearest, nearestPointOnEdges } from './geo.ts'

/**
 * Aus einer beantworteten Frage wird ein Prädikat über den Halten.
 *
 * Der Kern der Sucher-App. Verstecke sind ausschliesslich Haltestellen (Spielregel), die
 * Kandidatenmenge ist damit endlich und klein — 459 Halte. Jede Antwort ist eine Aussage
 * darüber, welche davon noch in Frage kommen, und das verbleibende Suchgebiet ist die
 * Vereinigung der Versteck-Radien um die übrig gebliebenen.
 *
 * Das ist exakter als Polygone zu verschneiden und kostet keine Bibliothek: die vier
 * Bausteine — Entfernung, nächster Ort, Punkt-in-Fläche, Abstand zum Rand — stehen alle
 * schon in `geo.ts`.
 *
 * Gebaut wird nicht eine Funktion pro Halt, sondern **eine Funktion pro Antwort**: alles,
 * was nur vom Fragepunkt abhängt (sein nächster Ort, seine Verwaltungsfläche, sein
 * Abstand zur Grenze), wird dabei einmal ausgerechnet statt 459-mal.
 */

export interface EliminationCtx {
  /** Orte je Kategorie, so wie sie im Fragen-Store liegen. */
  poisByCategory: Map<string, Poi[]>
  /** Für „Rail Station" — die Karte meint Bahnhöfe, nicht jede Bushaltestelle. */
  railStations: Station[]
  divisionsFor(level: string | null | undefined): DivisionArea[]
  borderSegmentsFor(id: string | null | undefined): BorderSegment[]
}

/** Antwort steht fest, schliesst aber nichts aus (Foto, Veto, Karte ohne Daten). */
export const ANSWER_UNKNOWN = 'unknown'
/** Tentacles: der Verstecker war ausserhalb des Kreises. */
export const ANSWER_OUT_OF_RANGE = 'out-of-range'

type Predicate = (station: Station) => boolean

const ALL: Predicate = () => true

/** „Rail Station" steht nicht in poi.json, wohl aber in der Stationsliste. */
function poisOf(ctx: EliminationCtx, category: string | null | undefined): Poi[] {
  if (!category) return []
  if (category === 'station') {
    return ctx.railStations.map((s) => ({
      id: s.id,
      name: s.name,
      category: 'station',
      lat: s.lat,
      lon: s.lon,
    }))
  }
  return ctx.poisByCategory.get(category) ?? []
}

/**
 * Flächen mit vorgerechnetem Umschliessungsrechteck.
 *
 * Die Buurt-Ebene hat rund 3800 Flächen; sie alle für jeden der 459 Halte mit einem
 * Strahlenschnitt zu prüfen wären knapp zwei Millionen Polygondurchläufe. Das Rechteck
 * wirft die allermeisten mit vier Vergleichen weg.
 */
interface BoxedArea {
  area: DivisionArea
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

function boxed(areas: DivisionArea[]): BoxedArea[] {
  return areas.map((area) => {
    let minLat = Infinity
    let maxLat = -Infinity
    let minLon = Infinity
    let maxLon = -Infinity
    const polygons =
      area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates
    for (const rings of polygons) {
      for (const [lon, lat] of rings[0] ?? []) {
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
      }
    }
    return { area, minLat, maxLat, minLon, maxLon }
  })
}

function areaAt(boxes: BoxedArea[], point: LatLon): DivisionArea | null {
  for (const box of boxes) {
    if (point.lat < box.minLat || point.lat > box.maxLat) continue
    if (point.lon < box.minLon || point.lon > box.maxLon) continue
    if (containsPoint(box.area.geometry, point)) return box.area
  }
  return null
}

/** Abstand zur nächsten Grenzlinie über alle Abschnitte hinweg. */
function distanceToBorder(segments: BorderSegment[], point: LatLon): number | null {
  let best: number | null = null
  for (const segment of segments) {
    const hit = nearestPointOnEdges(point, segment.geometry)
    if (hit && (best === null || hit.distance < best)) best = hit.distance
  }
  return best
}

export function predicateFor(entry: AnsweredQuestion, ctx: EliminationCtx): Predicate {
  if (entry.answer === ANSWER_UNKNOWN) return ALL

  const origin = entry.origin

  switch (entry.viz) {
    // „Bist du im Umkreis von X?" — der einfachste Fall und der verlässlichste: reine
    // Geometrie, unabhängig von jeder Datenquelle.
    case 'radius': {
      const radius = entry.radiusMeters
      if (!radius) return ALL
      const inside = entry.answer === 'yes'
      return (s) => distanceMeters(origin, s) <= radius === inside
    }

    /*
     * „Nach X Fahrt — wärmer oder kälter?"
     *
     * Wärmer heisst näher am Zielpunkt als am Start, und die Menge dieser Punkte ist
     * genau die Halbebene jenseits der Mittelsenkrechten. Die liegt auf der halben
     * Strecke — deshalb schneidet eine *kurze* Distanz am schärfsten: bei 1 km läuft
     * die Trennlinie 500 m neben den Suchern durch und halbiert das Feld, bei 15 km
     * liegt sie 7,5 km weg und nimmt nur noch eine Ecke mit.
     */
    case 'thermometer': {
      const destination = entry.destination
      if (!destination) return ALL
      const hotter = entry.answer === 'hotter'
      return (s) => distanceMeters(destination, s) < distanceMeters(origin, s) === hotter
    }

    // „Ist dein nächstes X dasselbe wie meins?"
    case 'poi-nearest': {
      const pois = poisOf(ctx, entry.poiCategory)
      const mine = nearest(origin, pois)
      if (!mine) return ALL
      const same = entry.answer === 'yes'
      return (s) => (nearest(s, pois)?.item.id === mine.item.id) === same
    }

    // „Bist du näher an X oder weiter weg als ich?" — verglichen wird der Abstand zum
    // jeweils eigenen nächsten Ort der Kategorie.
    case 'poi-isodistance': {
      const pois = poisOf(ctx, entry.poiCategory)
      const mine = nearest(origin, pois)
      if (!mine) return ALL
      const closer = entry.answer === 'closer'
      return (s) => {
        const theirs = nearest(s, pois)
        if (!theirs) return true
        return theirs.distance < mine.distance === closer
      }
    }

    // „Liegst du in derselben Verwaltungseinheit wie ich?"
    case 'division': {
      const boxes = boxed(ctx.divisionsFor(entry.divisionLevel))
      if (!boxes.length) return ALL
      const mine = areaAt(boxes, origin)
      if (!mine) return ALL
      const same = entry.answer === 'yes'
      return (s) => (areaAt(boxes, s)?.code === mine.code) === same
    }

    /*
     * „Bist du näher an der Grenze deiner Einheit als ich an meiner?"
     *
     * Weil die Flächen einer Ebene lückenlos kacheln, ist der Rand der eigenen Fläche
     * zugleich die nächste Grenze überhaupt — es muss keine zweite geprüft werden.
     */
    case 'division-border': {
      const boxes = boxed(ctx.divisionsFor(entry.divisionLevel))
      if (!boxes.length) return ALL
      const mine = areaAt(boxes, origin)
      if (!mine) return ALL
      const mineDistance = nearestPointOnEdges(origin, mine.geometry)?.distance
      if (mineDistance === undefined) return ALL
      const closer = entry.answer === 'closer'
      return (s) => {
        const area = areaAt(boxes, s)
        if (!area) return true
        const hit = nearestPointOnEdges(s, area.geometry)
        if (!hit) return true
        return hit.distance < mineDistance === closer
      }
    }

    // „Bist du näher an der Landesgrenze als ich?" Vom Spielgebiet aus ist der nächste
    // Punkt fast überall derselbe — die Frage läuft auf „liegst du südöstlicher?" hinaus
    // und teilt das Feld sauber.
    case 'border': {
      const segments = ctx.borderSegmentsFor(entry.borderId)
      if (!segments.length) return ALL
      const mineDistance = distanceToBorder(segments, origin)
      if (mineDistance === null) return ALL
      const closer = entry.answer === 'closer'
      return (s) => {
        const distance = distanceToBorder(segments, s)
        if (distance === null) return true
        return distance < mineDistance === closer
      }
    }

    /*
     * Tentacles: „Welchem X im Umkreis bist du am nächsten?"
     *
     * Nennt der Verstecker einen Ort, sagt er damit zweierlei — er ist im Kreis, und
     * von allen Orten *im Kreis* ist ihm dieser der nächste. Das ist die schärfste
     * Einschränkung im Spiel. „Ausser Reichweite" ist die Umkehrung des Radars.
     */
    case 'poi-within': {
      const radius = entry.radiusMeters
      if (!radius) return ALL
      if (entry.answer === ANSWER_OUT_OF_RANGE) {
        return (s) => distanceMeters(origin, s) > radius
      }
      const inside = poisOf(ctx, entry.poiCategory).filter(
        (poi) => distanceMeters(origin, poi) <= radius,
      )
      if (!inside.length) return ALL
      return (s) =>
        distanceMeters(origin, s) <= radius && nearest(s, inside)?.item.id === entry.answer
    }

    // Photos und die Karten, für die es keine Daten gibt (Küstenlinie, Meereshöhe,
    // Transitlinie …). Sie werden mit ihrer Antwort protokolliert, schliessen aber nichts
    // aus — was sie aussagen, weiss nur der Kopf der Sucher.
    default:
      return ALL
  }
}

/** Bleibt der Halt nach allen eingetragenen Antworten möglich? */
export function filterCandidates(
  stations: Station[],
  answers: AnsweredQuestion[],
  ctx: EliminationCtx,
): Station[] {
  if (!answers.length) return stations
  const predicates = answers.map((entry) => predicateFor(entry, ctx))
  return stations.filter((station) => predicates.every((match) => match(station)))
}
