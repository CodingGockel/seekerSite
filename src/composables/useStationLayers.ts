import { watch, type Ref } from 'vue'
import L from 'leaflet'
import { useGameStore } from '../stores/game'
import type { AppConfig, Station, TransportMode } from '../types/game'
import { toLatLngRings } from '../lib/geo'
import { SHEET_HALF_RATIO } from '../lib/layout'
import { cssColor } from '../lib/theme'

const USER_PANE = 'user-position'

/**
 * Unterhalb dieser Zoomstufe schrumpfen die Marker auf einfache Punkte. Volle
 * 26-px-Pins verklumpen in der Amsterdamer Innenstadt sonst zu einem Haufen, in
 * dem man weder Symbol noch einzelnen Halt erkennt. Seit auch Tram- und
 * Bushaltestellen dabei sind (459 statt 73), setzt das eine Stufe früher ein.
 */
const COMPACT_BELOW_ZOOM = 13

/**
 * Piktogramme im 24er-Raster, weiss auf der Farbe des Verkehrsmittels. Bei rund
 * 16 px Kantenlänge muss die Form kräftig und geschlossen sein — feine Linien
 * verschwinden auf der Karte.
 */
const GLYPHS: Record<TransportMode, string> = {
  train:
    'M12 2c-4 0-7 .5-7 4v8.5A2.5 2.5 0 0 0 7.5 17L6 19.5v.5h2l1.5-2h5l1.5 2h2v-.5L16.5 17a2.5 2.5 0 0 0 2.5-2.5V6c0-3.5-3-4-7-4zM7.5 7h9v4.5h-9zm2 6.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm5 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z',
  metro: 'M4.5 19V5h3.2l4.3 7.4L16.3 5h3.2v14h-2.9v-8.4l-3.3 5.6h-1.6l-3.3-5.6V19z',
  tram: 'M11 2.5V4H8a3 3 0 0 0-3 3v7.5A2.5 2.5 0 0 0 7.5 17L6 19.5v.5h2l1.5-2h5l1.5 2h2v-.5L16.5 17a2.5 2.5 0 0 0 2.5-2.5V7a3 3 0 0 0-3-3h-3V2.5zM7.5 7h9v4.5h-9zm2 6.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm5 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z',
  // Geteilte Frontscheibe und tiefer sitzende Räder — sonst ist der Bus bei 16 px
  // nicht vom Zug zu unterscheiden.
  bus: 'M12 2.5H7.5a3 3 0 0 0-3 3v9.2a2.5 2.5 0 0 0 1.5 2.29V19.5a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5V18h6v1.5a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-2.51a2.5 2.5 0 0 0 1.5-2.29V5.5a3 3 0 0 0-3-3H12zM6.8 6.2h4.4v4.6H6.8zm6 0h4.4v4.6h-4.4zM8.3 12.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zm7.4 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z',
  // Aufbau, Rumpf und eine Welle: erst die Welle macht bei 16 px aus dem Klotz ein Schiff.
  ferry:
    'M11 2h2v2.2h3.2a1 1 0 0 1 1 1V10H6.8V5.2a1 1 0 0 1 1-1H11zM2.9 11.6h18.2l-1.6 4a4.2 4.2 0 0 0-2.2 1 2.6 2.6 0 0 1-3.5 0 4.2 4.2 0 0 0-5.6 0 2.6 2.6 0 0 1-3.5 0 4.2 4.2 0 0 0-.2-.15zM3 18.4c1.1 0 1.7.75 2.9.75s1.8-.75 2.9-.75 1.7.75 2.9.75 1.8-.75 2.9-.75 1.7.75 2.9.75 1.4-.35 2.1-.6v2c-.7.25-1.2.6-2.1.6-1.2 0-1.7-.75-2.9-.75s-1.8.75-2.9.75-1.7-.75-2.9-.75-1.8.75-2.9.75S4.1 20.4 3 20.4z',
}

/**
 * Das zweite Verkehrsmittel für den Ring am Marker. Bus bleibt bewusst aussen vor:
 * fast jeder Halt wird auch von einer Buslinie bedient, ein Bus-Ring an 400 Markern
 * sagt nichts mehr aus.
 */
const RING_MODES: TransportMode[] = ['train', 'metro', 'tram', 'ferry']

function secondaryMode(station: Station): TransportMode | null {
  return RING_MODES.find((m) => m !== station.mode && station.lines[m]?.length) ?? null
}

function colorFor(station: Station, config: AppConfig): string {
  return config.modes[station.mode]?.color ?? '#475569'
}

export function useStationLayers(map: Ref<L.Map | null>, renderer: Ref<L.Canvas | null>) {
  const store = useGameStore()

  const markers = new Map<string, L.Marker>()
  let compact = false
  let areaLayer: L.LayerGroup | null = null
  let radiusLayer: L.LayerGroup | null = null
  let userLayer: L.LayerGroup | null = null

  function stationIcon(station: Station, selected: boolean): L.DivIcon {
    const config = store.config!
    const color = colorFor(station, config)
    // Die ausgewählte Station bleibt immer gross — sie soll auffindbar bleiben.
    const dense = compact && !selected
    const size = selected ? 34 : dense ? 16 : 26

    // Umsteigeknoten bekommen einen zweiten Ring in der Farbe des weiteren
    // Verkehrsmittels — an Amsterdam Zuid sieht man so direkt Bahn plus Metro.
    const secondary = secondaryMode(station)
    const ring = secondary ? (config.modes[secondary]?.color ?? color) : null

    const classes = ['station-pin']
    if (selected) classes.push('is-selected')
    if (ring) classes.push('is-interchange')
    if (dense) classes.push('is-compact')
    // Ausserhalb des Ticketgebiets: gestrichelter Rand statt eines vollen.
    if (station.extraCost) classes.push('is-extra')

    const glyph = dense
      ? ''
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS[station.mode]}"/></svg>`

    return L.divIcon({
      className: 'station-pin-host',
      html:
        `<span class="${classes.join(' ')}" style="--pin:${color};--ring:${ring ?? color}">` +
        glyph +
        `</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
  }

  /** Beim Über- oder Unterschreiten der Zoomschwelle alle Marker einmal neu bauen. */
  function updateDensity() {
    const next = (map.value?.getZoom() ?? 99) < COMPACT_BELOW_ZOOM
    if (next === compact) return
    compact = next

    const byId = new Map(store.visibleStations.map((s) => [s.id, s]))
    for (const [id, marker] of markers) {
      const station = byId.get(id)
      if (station) marker.setIcon(stationIcon(station, id === store.selectedId))
    }
  }

  function drawArea() {
    if (!map.value) return
    areaLayer?.remove()
    areaLayer = null

    const feature = store.area?.features?.[0]
    if (!feature?.geometry) return

    const rings = toLatLngRings(feature.geometry)
    if (!rings.length) return

    // Nur der Umriss. Das Abdunkeln aussen herum macht seit dem Sucher-Modus
    // `useHidingAreaLayer` — und zwar um das verbleibende Suchgebiet, das immer im
    // Spielgebiet liegt. Zweimal übereinander wäre der Rand doppelt so dunkel.
    areaLayer = L.layerGroup([
      L.polygon(rings, {
        color: cssColor('--area-border', '#b45309'),
        weight: 3,
        opacity: 0.95,
        dashArray: '8,5',
        fill: false,
        interactive: false,
      }),
    ]).addTo(map.value)
  }

  function drawStations() {
    if (!map.value || !store.config) return

    const wanted = new Set(store.visibleStations.map((s) => s.id))

    for (const [id, marker] of markers) {
      if (!wanted.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }

    for (const station of store.visibleStations) {
      if (markers.has(station.id)) continue
      const selected = station.id === store.selectedId
      const marker = L.marker([station.lat, station.lon], {
        icon: stationIcon(station, selected),
        zIndexOffset: selected ? 1000 : 0,
        keyboard: false,
      })
        .bindTooltip(station.name, { direction: 'top', offset: [0, -16] })
        .on('click', () => store.select(station.id))
        .addTo(map.value!)
      markers.set(station.id, marker)
    }
  }

  /**
   * Nur die beiden betroffenen Marker neu bauen statt aller sichtbaren: ein
   * DivIcon neu zu setzen heisst DOM-Arbeit, und das bei jedem Antippen für
   * mehrere hundert Marker zu tun ruckelt sichtbar.
   */
  function updateSelection(previousId: string | null) {
    for (const id of new Set([previousId, store.selectedId])) {
      if (!id) continue
      const station = store.visibleStations.find((s) => s.id === id)
      const marker = markers.get(id)
      if (!station || !marker) continue
      const selected = id === store.selectedId
      marker.setIcon(stationIcon(station, selected))
      marker.setZIndexOffset(selected ? 1000 : 0)
    }
  }

  function drawRadii() {
    if (!map.value || !store.config) return
    radiusLayer?.remove()

    const circles: L.Circle[] = []
    const radius = store.hidingRadius

    const selected = store.selectedStation
    if (selected) {
      circles.push(
        L.circle([selected.lat, selected.lon], {
          renderer: renderer.value ?? undefined,
          radius,
          color: colorFor(selected, store.config),
          weight: 2,
          opacity: 0.9,
          fillColor: colorFor(selected, store.config),
          fillOpacity: 0.12,
          interactive: false,
        }),
      )
    }

    radiusLayer = L.layerGroup(circles).addTo(map.value)
  }

  function drawUser() {
    if (!map.value) return
    userLayer?.remove()
    userLayer = null

    const pos = store.userPosition
    if (!pos) return

    const layers: L.Layer[] = []

    // Der Genauigkeitskreis gehört zur Ortung; ein gesetzter Punkt hat keine Streuung.
    if (!store.isManualPosition && pos.accuracy > 0) {
      layers.push(
        L.circle([pos.lat, pos.lon], {
          pane: USER_PANE,
          radius: pos.accuracy,
          stroke: false,
          fillColor: '#2563eb',
          fillOpacity: 0.15,
          interactive: false,
        }),
      )
    }

    if (store.isManualPosition) {
      // Gesetzter Standort: verschiebbar, und optisch als „von Hand" erkennbar.
      layers.push(
        L.marker([pos.lat, pos.lon], {
          pane: USER_PANE,
          draggable: true,
          keyboard: false,
          icon: L.divIcon({
            className: 'user-pin-host',
            html: '<span class="user-pin is-manual"><i></i></span>',
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        })
          .bindTooltip('Standort von Hand gesetzt', { direction: 'top', offset: [0, -12] })
          .on('dragend', (event) => {
            const { lat, lng } = (event.target as L.Marker).getLatLng()
            store.setManualPosition({ lat, lon: lng })
          }),
      )
    } else {
      layers.push(
        L.circleMarker([pos.lat, pos.lon], {
          pane: USER_PANE,
          radius: 7,
          color: '#ffffff',
          weight: 3,
          fillColor: '#2563eb',
          fillOpacity: 1,
          interactive: false,
        }),
      )
    }

    userLayer = L.layerGroup(layers).addTo(map.value)
  }


  // Die Watcher werden im Setup-Scope des Composables registriert, nicht erst in
  // bind(): dort erzeugte Watcher gehörten zu keinem Scope und blieben beim
  // Unmount der Karte als Leak zurück. Die draw-Funktionen prüfen selbst, ob die
  // Karte schon existiert, deshalb ist ein früher Aufruf unschädlich.
  watch(() => store.area, drawArea)

  // Bewusst nur auf die Menge der Stationen reagieren, nicht auf ihre Objekte:
  // jedes GPS-Update erzeugt neue Objekte (die Entfernung ändert sich), und die
  // Marker deswegen neu aufzubauen würde die Karte im Sekundentakt flackern lassen.
  watch(
    () => store.visibleStations.map((s) => s.id).join('|'),
    () => {
      drawStations()
      drawRadii()
    },
  )

  watch(
    () => store.selectedId,
    (_id, previousId) => {
      updateSelection(previousId ?? null)
      drawRadii()
    },
  )

  watch(() => store.userPosition, drawUser, { deep: true })
  watch(() => store.isManualPosition, drawUser)

  // Wechselt die Ansicht zwischen hell und dunkel, gelten andere Overlay-Farben.

  /** Erstzeichnung, sobald die Karte existiert. */
  function bind() {
    if (!map.value) return
    map.value.createPane(USER_PANE).style.zIndex = '650'

    // Vor dem ersten Zeichnen festlegen, sonst entstehen die Marker in der
    // falschen Grösse und werden sofort wieder ersetzt.
    compact = map.value.getZoom() < COMPACT_BELOW_ZOOM
    map.value.on('zoomend', updateDensity)

    drawArea()
    drawStations()
    drawRadii()
    drawUser()
  }

  /** Karte auf einen Halt ziehen — so, dass der Versteck-Radius ganz ins Bild passt. */
  function focusStation(id: string) {
    const station = store.visibleStations.find((s) => s.id === id)
    if (!station || !map.value) return
    // Nicht über L.circle(...).getBounds(): dessen Radius wird erst beim Projizieren
    // auf einer Karte gesetzt, ein freistehendes Circle liefert NaN-Bounds und
    // flyToBounds tut dann gar nichts. toBounds rechnet rein geografisch.
    const bounds = L.latLng(station.lat, station.lon).toBounds(store.hidingRadius * 2)
    // fitBounds statt flyToBounds: die Flug-Animation von Leaflet hat sich im Test
    // als unzuverlässig erwiesen und die Karte teils gar nicht bewegt. fitBounds
    // animiert ebenfalls, kommt aber nachweislich immer an.
    //
    // Nach der Auswahl klappt das Sheet auf, verdeckt also den unteren Teil der
    // Karte. Ohne den Zuschlag unten läge die Station genau dahinter.
    map.value.fitBounds(bounds, {
      paddingTopLeft: [48, 48],
      paddingBottomRight: [48, Math.round(window.innerHeight * SHEET_HALF_RATIO)],
      maxZoom: 15,
    })
  }

  function centerOnUser() {
    const pos = store.userPosition
    if (!pos || !map.value) return
    map.value.setView([pos.lat, pos.lon], Math.max(map.value.getZoom(), 14), { animate: true })
  }

  return { bind, focusStation, centerOnUser }
}
