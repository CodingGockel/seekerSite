/**
 * Zeichnet die Frage, über die gerade geredet wird.
 *
 * Es liegt immer höchstens eine Geometrie auf der Karte, und sie behauptet nichts:
 * gezeigt wird, worüber die Frage redet — der Umkreis, die Orte, der nächstgelegene.
 * Die Antwort zieht der Spieler und schickt sie über den Chat; in der App bleibt davon
 * nur das Häkchen „genutzt".
 *
 * Deshalb gibt es auch nur zwei Farben: alles Neutrale in `--preview`, und in `--accent`
 * genau das, was die Frage entscheidet — der nächstgelegene Ort und die Linie dorthin.
 */

import { watch, type Ref } from 'vue'
import L from 'leaflet'
import { useQuestionStore } from '../stores/questions'
import { useGameStore } from '../stores/game'
import {
  containsPoint,
  destinationFrom,
  distanceMeters,
  formatDistance,
  nearest,
  nearestPointOnEdges,
  toLatLngRings,
} from '../lib/geo'
import { SHEET_HALF_RATIO } from '../lib/layout'
import { poiPin } from '../lib/poiPin'
import { cssColor } from '../lib/theme'
import type { BorderSegment, DivisionArea, LatLon, MapPreview } from '../types/game'

/**
 * Eigene Ebene für den Ankerpunkt, über dem Standortpunkt (z-index 650). Der Fragepunkt
 * liegt in der Regel genau auf der eigenen Position — ohne das verschwindet er darunter.
 */
const ANCHOR_PANE = 'preview-anchor'

/**
 * Wie viele Nachbarflächen einer Ebene höchstens umrissen werden. Auf Buurt-Ebene
 * liegen im Spielgebiet fast viertausend — gezeichnet wäre das ein Filz, in dem die
 * eigene Fläche untergeht, und für die Frage zählt ohnehin nur die Umgebung.
 */
const MAX_DIVISION_OUTLINES = 40

export function usePreviewLayers(map: Ref<L.Map | null>, renderer: Ref<L.Canvas | null>) {
  const store = useQuestionStore()
  const game = useGameStore()

  let group: L.LayerGroup | null = null

  /** Alles Neutrale — Kreis, Orte, Ankerpunkt. Folgt dem Farbschema. */
  function neutral() {
    return cssColor('--preview', '#1e293b')
  }

  /** Was die Frage entscheidet: der nächstgelegene Ort und die Linie dorthin. */
  function accent() {
    return cssColor('--accent', '#2563eb')
  }

  /**
   * Der Punkt, von dem aus gefragt wird — der Standort der Sucher.
   *
   * Fest, nicht verschiebbar: die Vorschau wird nicht gespeichert, ein verschobener Punkt
   * hielte nur bis zum nächsten Neuzeichnen.
   */
  function anchorMarker(preview: MapPreview) {
    return L.marker([preview.origin.lat, preview.origin.lon], {
      pane: ANCHOR_PANE,
      keyboard: false,
      icon: L.divIcon({
        className: 'preview-anchor-host',
        html: `<span class="preview-anchor" style="--c:${neutral()}"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).bindTooltip(`${preview.label} — Fragepunkt`, { direction: 'top', offset: [0, -9] })
  }

  /**
   * Thermometer: die Fahrt als Pfeil, die Mittelsenkrechte als Trennlinie.
   *
   * Die Sucher fahren dabei nicht wirklich — sie wählen eine Richtung, und der Zielpunkt
   * liegt die Kartendistanz davon entfernt. „Wärmer" heisst näher am Ziel als am Start,
   * und die Menge dieser Punkte ist genau die Halbebene jenseits der Mittelsenkrechten.
   *
   * Die liegt auf der **halben** Strecke. Deshalb schneidet die kürzeste Karte am
   * schärfsten: bei 1 km läuft die Linie 500 m neben den Suchern durch und halbiert das
   * Feld, bei 15 km liegt sie 7,5 km weg und nimmt nur noch eine Ecke mit. Genau das
   * soll man hier sehen, bevor man die Karte ausgibt.
   */
  function drawThermometer(preview: MapPreview, layers: L.Layer[]) {
    const distance = preview.radiusMeters
    if (!distance || preview.bearing == null) {
      layers.push(anchorMarker(preview))
      return
    }

    const target = destinationFrom(preview.origin, distance, preview.bearing)
    const middle = destinationFrom(preview.origin, distance / 2, preview.bearing)

    // Die Trennlinie steht senkrecht auf der Fahrtrichtung. 80 km nach beiden Seiten:
    // das Spielgebiet misst rund 45 × 40 km, damit reicht sie in jeder Lage darüber hinaus.
    const REACH_METERS = 80000
    const left = destinationFrom(middle, REACH_METERS, preview.bearing - 90)
    const right = destinationFrom(middle, REACH_METERS, preview.bearing + 90)

    layers.push(
      L.polyline(
        [
          [left.lat, left.lon],
          [right.lat, right.lon],
        ],
        {
          renderer: renderer.value ?? undefined,
          color: accent(),
          weight: 3,
          opacity: 0.95,
          interactive: false,
        },
      ),
    )

    // Die Strecke zum Zielpunkt sagt, welche Seite „wärmer" ist — ohne sie ist die
    // Trennlinie zweideutig. Beschriftet wie jede andere Vergleichslinie auch.
    layers.push(
      L.polyline(
        [
          [preview.origin.lat, preview.origin.lon],
          [target.lat, target.lon],
        ],
        {
          renderer: renderer.value ?? undefined,
          color: neutral(),
          weight: 2,
          opacity: 0.9,
          dashArray: '6,6',
          interactive: false,
        },
      ).bindTooltip(`wärmer · ${formatDistance(distance)}`, {
        permanent: true,
        direction: 'center',
        className: 'distance-label',
      }),
    )

    layers.push(anchorMarker(preview))
  }

  function drawRadius(preview: MapPreview, layers: L.Layer[]) {
    const radius = preview.radiusMeters
    if (!radius) return

    const color = neutral()
    layers.push(
      L.circle([preview.origin.lat, preview.origin.lon], {
        renderer: renderer.value ?? undefined,
        radius,
        color,
        weight: 3,
        opacity: 0.95,
        // Gestrichelt und nur leicht gefüllt: der Kreis zeigt die Grösse des Umkreises,
        // nicht das Ergebnis — das steht im Chat.
        dashArray: '7,5',
        fillColor: color,
        fillOpacity: 0.16,
        interactive: false,
      }),
    )
    layers.push(anchorMarker(preview))
  }

  /**
   * Die Orte, auf die sich eine Frage bezieht. „Rail Station" steht nicht in
   * poi.json — dafür gibt es die Stationsliste, die ohnehin geladen ist. Gemeint
   * sind dabei nur Bahnhöfe, nicht jede Bushaltestelle, und unabhängig davon,
   * welche Verkehrsmittel gerade eingeblendet sind.
   */
  function poisFor(preview: MapPreview) {
    if (!preview.poiCategory) return []
    if (preview.poiCategory === 'station') {
      return game.railStations.map((s) => ({
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        category: 'station',
      }))
    }
    return store.poisByCategory.get(preview.poiCategory) ?? []
  }

  /**
   * Gestrichelte Linie vom Fragepunkt zu dem Ort, der von dort der nächste ist —
   * beschriftet mit der Entfernung. Sie ist bei Matching, Measuring und Tentacles die
   * eigentliche Aussage der Karte: welcher Ort es ist und wie weit er weg liegt.
   *
   * Bei einer erhaltenen Frage gehört sie jemand anderem und bleibt deshalb neutral —
   * die Akzentfarbe ist dort für die eigene Vergleichslinie reserviert, sonst wären die
   * beiden Linien nicht auseinanderzuhalten.
   */
  function originLine(preview: MapPreview, to: { lat: number; lon: number }) {
    return L.polyline(
      [
        [preview.origin.lat, preview.origin.lon],
        [to.lat, to.lon],
      ],
      {
        color: accent(),
        weight: 2,
        opacity: 0.9,
        dashArray: '6,6',
        interactive: false,
      },
    ).bindTooltip(formatDistance(distanceMeters(preview.origin, to)), {
      permanent: true,
      direction: 'center',
      className: 'distance-label',
    })
  }

  /**
   * Tentacles: Kreis um den Fragepunkt, die Orte darin, und der nächstgelegene davon
   * hervorgehoben. Gefragt ist nach dem nächsten Ort *im Kreis* — die Orte ausserhalb
   * zählen für die Antwort nicht und werden deshalb auch nicht gezeigt.
   */
  function drawPoiWithin(preview: MapPreview, layers: L.Layer[]) {
    const radius = preview.radiusMeters
    if (!radius) return

    layers.push(
      L.circle([preview.origin.lat, preview.origin.lon], {
        renderer: renderer.value ?? undefined,
        radius,
        color: neutral(),
        weight: 3,
        opacity: 0.95,
        dashArray: '7,5',
        fillColor: neutral(),
        fillOpacity: 0.14,
        interactive: false,
      }),
    )

    const inside = poisFor(preview).filter((poi) => distanceMeters(preview.origin, poi) <= radius)
    const closest = nearest(preview.origin, inside)

    for (const poi of inside) {
      if (poi === closest?.item) continue
      layers.push(poiPin(poi, neutral()))
    }
    if (closest) {
      layers.push(poiPin(closest.item, accent(), true))
      layers.push(originLine(preview, closest.item))
    }

    layers.push(anchorMarker(preview))
  }

  /**
   * Matching und Measuring: die Orte der Kategorie, der nächstgelegene hervorgehoben,
   * eine beschriftete Linie dorthin.
   *
   * Beide Kartentypen zeigen dasselbe Bild. Sie fragen zwar Verschiedenes — Matching
   * nach der Identität des nächsten Orts, Measuring nach dem Abstand zu ihm — aber
   * beantworten lässt sich beides nur, indem man die Orte und den eigenen nächsten
   * sieht. Measuring zeichnete früher stattdessen die Isodistanz-Fläche; die färbte
   * eine Antwort ein, die es nicht mehr gibt, und liess die Orte selbst weg.
   */
  function drawPoiNearest(preview: MapPreview, layers: L.Layer[]) {
    const pois = poisFor(preview)
    const closest = nearest(preview.origin, pois)
    if (!closest) return

    // Alle Orte der Kategorie, ungekappt. Bei „Park" sind das über tausend Marker; das ist
    // dicht, aber gewollt — wer die Frage stellt, will sehen, wo überall welche liegen,
    // und nicht raten, ob hinter dem Rand des Ausschnitts noch einer steht.
    for (const poi of pois) {
      if (poi === closest.item) continue
      layers.push(poiPin(poi, neutral()))
    }
    layers.push(poiPin(closest.item, accent(), true))

    layers.push(originLine(preview, closest.item))
    layers.push(anchorMarker(preview))
  }

  /**
   * Der ungefähre Mittelpunkt einer Fläche — Mitte ihres umschliessenden Rechtecks.
   *
   * Reicht, um die Nachbarn nach Nähe zu sortieren; ein echter Schwerpunkt wäre für
   * diesen Zweck Rechenzeit ohne sichtbaren Unterschied.
   */
  function areaCenter(area: DivisionArea): LatLon {
    let west = 180
    let south = 90
    let east = -180
    let north = -90
    for (const ring of toLatLngRings(area.geometry)) {
      for (const point of ring as [number, number][]) {
        if (point[1] < west) west = point[1]
        if (point[1] > east) east = point[1]
        if (point[0] < south) south = point[0]
        if (point[0] > north) north = point[0]
      }
    }
    return { lat: (south + north) / 2, lon: (west + east) / 2 }
  }

  /** Die Fläche, in der der Punkt liegt — auf dem Wasser gibt es keine. */
  function areaAt(areas: DivisionArea[], point: LatLon): DivisionArea | null {
    return areas.find((area) => containsPoint(area.geometry, point)) ?? null
  }

  /**
   * Eine Fläche als Polygon. Gefüllt und benannt ist nur, was die Frage entscheidet.
   *
   * Der Name steht nicht immer da: bei der Grenzfrage ist die Entfernung die Aussage,
   * und deren Etikett liegt in der Mitte der Linie — also fast auf dem Fragepunkt und
   * damit genau dort, wo auch der Flächenname landen würde. Zwei Beschriftungen
   * übereinander, von denen die wichtigere verdeckt wird.
   */
  function divisionShape(
    area: DivisionArea,
    style: { color: string; filled: boolean; dashed?: boolean; labelled?: boolean },
  ) {
    const shape = L.polygon(toLatLngRings(area.geometry), {
      renderer: renderer.value ?? undefined,
      color: style.color,
      weight: 3,
      opacity: 0.95,
      dashArray: style.dashed ? '7,5' : undefined,
      fill: style.filled,
      fillColor: style.color,
      fillOpacity: 0.18,
      interactive: false,
    })

    return style.labelled
      ? shape.bindTooltip(area.name, {
          permanent: true,
          direction: 'center',
          className: 'division-label',
        })
      : shape
  }

  /**
   * Die Nachbarflächen als dünne Umrisse — sie sind der Massstab, an dem die eigene
   * Fläche überhaupt etwas bedeutet, und bei der Border-Karte zugleich die Grenzen,
   * um die es geht.
   */
  function divisionOutlines(areas: DivisionArea[], own: DivisionArea | null, layers: L.Layer[]) {
    const origin = own ? areaCenter(own) : null
    const neighbours = areas.filter((area) => area !== own)

    const shown = origin
      ? [...neighbours]
          .sort((a, b) => distanceMeters(origin, areaCenter(a)) - distanceMeters(origin, areaCenter(b)))
          .slice(0, MAX_DIVISION_OUTLINES)
      : neighbours.slice(0, MAX_DIVISION_OUTLINES)

    for (const area of shown) {
      layers.push(
        L.polygon(toLatLngRings(area.geometry), {
          renderer: renderer.value ?? undefined,
          color: neutral(),
          // Dünner als die eigene Fläche, aber nicht zart: eine Haarlinie mit halber
          // Deckkraft geht auf der Grundkarte zwischen Autobahnen und Kanälen
          // vollständig unter — nachgemessen, nicht geschätzt.
          weight: 2,
          opacity: 0.85,
          fill: false,
          interactive: false,
        }),
      )
    }
  }

  /**
   * Matching auf einer Verwaltungsebene: die Fläche, in der der Fragepunkt liegt,
   * hervorgehoben und benannt; die Nachbarn als Umriss.
   *
   * Solange die Ebene noch lädt, bleibt der Ankerpunkt allein stehen — die Flächen
   * kommen nach, ein `watch` auf `divisionsVersion` zeichnet dann neu.
   */
  function isDivision(viz: string | undefined): boolean {
    return viz === 'division' || viz === 'division-border'
  }

  /** Der nächste Punkt auf irgendeinem Abschnitt der Grenze. */
  function nearestOnBorder(from: LatLon, segments: BorderSegment[]) {
    let best: { lat: number; lon: number; distance: number } | null = null
    for (const segment of segments) {
      const hit = nearestPointOnEdges(from, segment.geometry)
      if (hit && (!best || hit.distance < best.distance)) best = hit
    }
    return best
  }

  /**
   * Die Landesgrenze: die Linie selbst und die Strecke zum nächsten Punkt darauf.
   *
   * Sie umschliesst keine Fläche, in der jemand stünde — es gibt hier nichts
   * hervorzuheben ausser der Entfernung. Deshalb bleibt die Grenze neutral und trägt
   * nur die Beschriftung des Nachbarlands, und die Aussage steckt allein in der Linie
   * zum Fusspunkt.
   */
  function drawBorder(preview: MapPreview, layers: L.Layer[]) {
    const segments = store.borderSegmentsFor(preview.borderId)

    for (const segment of segments) {
      layers.push(
        L.polyline(toLatLngRings(segment.geometry), {
          renderer: renderer.value ?? undefined,
          color: neutral(),
          weight: 2,
          opacity: 0.85,
          interactive: false,
        }).bindTooltip(`Grenze zu ${segment.with}`, { sticky: true }),
      )
    }

    const hit = nearestOnBorder(preview.origin, segments)
    if (hit) layers.push(originLine(preview, hit))

    layers.push(anchorMarker(preview))
  }

  function drawDivision(preview: MapPreview, layers: L.Layer[]) {
    const areas = store.divisionsFor(preview.divisionLevel)
    const own = areaAt(areas, preview.origin)

    divisionOutlines(areas, own, layers)
    if (own) {
      layers.push(
        divisionShape(own, {
          color: accent(),
          filled: true,
          labelled: true,
        }),
      )
    }

    layers.push(anchorMarker(preview))
  }

  /**
   * Measuring auf einer Verwaltungsebene: dazu die gestrichelte Linie zum nächsten
   * Punkt auf der Grenze, beschriftet mit der Entfernung.
   *
   * Weil die Flächen einer Ebene lückenlos kacheln, ist die nächste Grenze der
   * eigenen Fläche zugleich die nächste Grenze überhaupt — es muss keine zweite
   * Fläche geprüft werden.
   */
  function drawDivisionBorder(preview: MapPreview, layers: L.Layer[]) {
    const areas = store.divisionsFor(preview.divisionLevel)
    const own = areaAt(areas, preview.origin)

    divisionOutlines(areas, own, layers)
    if (own) {
      layers.push(
        divisionShape(own, {
          color: accent(),
          filled: false,
          labelled: false,
        }),
      )
      const hit = nearestPointOnEdges(preview.origin, own.geometry)
      if (hit) layers.push(originLine(preview, hit))
    }

    layers.push(anchorMarker(preview))
  }


  function draw() {
    if (!map.value) return
    group?.remove()
    group = null

    const preview = store.preview
    if (preview) {
      const layers: L.Layer[] = []

      if (preview.viz === 'radius') drawRadius(preview, layers)
      else if (preview.viz === 'thermometer') drawThermometer(preview, layers)
      else if (preview.viz === 'poi-within') drawPoiWithin(preview, layers)
      else if (preview.viz === 'division') drawDivision(preview, layers)
      else if (preview.viz === 'division-border') drawDivisionBorder(preview, layers)
      else if (preview.viz === 'border') drawBorder(preview, layers)
      else drawPoiNearest(preview, layers)

      if (layers.length) group = L.layerGroup(layers).addTo(map.value)
    }
  }

  watch(() => store.preview, draw, { deep: true })

  // Die Verwaltungsebenen werden erst geladen, wenn eine Frage sie braucht. Bis dahin
  // steht nur der Ankerpunkt auf der Karte; das hier trägt die Flächen nach — und mit
  // ihnen den Ausschnitt, der ohne sie nicht zu bestimmen war. Je Ebene passiert das
  // genau einmal pro Sitzung, es kommt also niemandem beim Verschieben in die Quere.
  watch(() => store.mapDataVersion, () => {
    draw()
    if (isDivision(store.preview?.viz) || store.preview?.viz === 'border') focusPreview()
  })

  // Auch die Vorschau holt ihre Farben aus dem CSS — nach einem Wechsel neu zeichnen.

  function bind() {
    if (!map.value) return
    map.value.createPane(ANCHOR_PANE).style.zIndex = '660'
    draw()
  }

  /** Karte auf die Vorschau ziehen. */
  function focusPreview() {
    const preview = store.preview
    if (!preview || !map.value) return

    const origin = L.latLng(preview.origin.lat, preview.origin.lon)

    // Bei einer Fläche gibt sie den Ausschnitt vor: „welche Gemeente ist das?" ist
    // erst zu sehen, wenn die ganze Fläche im Bild ist. Ein Radius um den Fragepunkt
    // träfe sie nur zufällig.
    //
    // Solange die Geometrie noch lädt, wird der Ausschnitt gar nicht angefasst: der
    // Rückfall unten spannte sonst erst weit auf und sprang beim Eintreffen der Daten
    // wieder zurück. Der Aufruf kommt nach dem Laden von selbst noch einmal.
    if (isDivision(preview.viz) && !store.divisionsFor(preview.divisionLevel).length) return

    /**
     * Die Landesgrenze ist hundert Kilometer lang und liegt ebenso weit weg. Sie ganz
     * ins Bild zu holen hiesse, halb Mitteleuropa zu zeigen; was die Karte aussagt, ist
     * die Strecke vom Fragepunkt zum nächsten Punkt darauf — die spannt den Ausschnitt.
     */
    if (preview.viz === 'border') {
      const segments = store.borderSegmentsFor(preview.borderId)
      if (!segments.length) return

      const hit = nearestOnBorder(preview.origin, segments)
      if (!hit) return

      const borderBounds = L.latLngBounds([
        [preview.origin.lat, preview.origin.lon],
        [hit.lat, hit.lon],
      ])
      map.value.fitBounds(borderBounds, {
        paddingTopLeft: [40, 40],
        paddingBottomRight: [40, Math.round(window.innerHeight * SHEET_HALF_RATIO)],
        maxZoom: 15,
      })
      return
    }

    const own = isDivision(preview.viz)
      ? areaAt(store.divisionsFor(preview.divisionLevel), preview.origin)
      : null
    if (own) {
      const areaBounds = L.latLngBounds(toLatLngRings(own.geometry).flat())
      map.value.fitBounds(areaBounds, {
        paddingTopLeft: [40, 40],
        paddingBottomRight: [40, Math.round(window.innerHeight * SHEET_HALF_RATIO)],
        maxZoom: 15,
      })
      return
    }

    // Ein Radius gibt den Ausschnitt vor. Ohne ihn (Matching, Measuring) spannt der
    // nächstgelegene Ort ihn auf: die Linie dorthin ist die Aussage der Karte und muss
    // ins Bild passen. Ein einzelner Punkt allein ergäbe ein leeres Rechteck und damit
    // die höchste Zoomstufe; die Untergrenze hält den Ausschnitt auch dann brauchbar,
    // wenn der Ort zweihundert Meter weiter steht.
    const MIN_EXTENT = 1200
    const FALLBACK_EXTENT = 8000

    let extent = preview.radiusMeters ?? null
    if (!extent) {
      const closest = nearest(preview.origin, poisFor(preview))
      extent = closest ? Math.max(closest.distance * 1.4, MIN_EXTENT) : FALLBACK_EXTENT
    }

    const bounds = origin.toBounds(extent * 2)

    // Das Sheet verdeckt den unteren Teil der Karte; ohne den Zuschlag läge die
    // Geometrie genau dahinter.
    map.value.fitBounds(bounds, {
      paddingTopLeft: [40, 40],
      paddingBottomRight: [40, Math.round(window.innerHeight * SHEET_HALF_RATIO)],
      maxZoom: 15,
    })
  }

  return { bind, draw, focusPreview }
}
