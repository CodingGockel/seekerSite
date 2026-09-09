import { watch, type Ref } from 'vue'
import L from 'leaflet'
import { useGameStore } from '../stores/game'
import { cssColor } from '../lib/theme'

/**
 * Das verbleibende Suchgebiet: alles abgedunkelt, ausser den Versteck-Radien der
 * Halte, die nach den eingetragenen Antworten noch möglich sind.
 *
 * **Warum ein eigener Canvas und kein `L.polygon([WORLD_RING, ...kreise])`.** Das
 * Loch-Muster, mit dem `useStationLayers` das Spielgebiet freistellt, trägt nur bei
 * *disjunkten* Löchern. Benachbarte Halte liegen aber oft keine 800 m auseinander, ihre
 * Radien überlappen also ständig — und Leaflets Canvas-Renderer füllt nach der
 * Even-Odd-Regel, bei der sich zwei überlappende Löcher gegenseitig wieder zumalen.
 * Man sähe ausgerechnet dort dunkle Linsen, wo die meisten Kandidaten stehen.
 *
 * `destination-out` kennt das Problem nicht: jeder Kreis radiert, was schon radiert ist,
 * bleibt radiert. Das erspart zugleich eine Polygon-Bibliothek im Bundle — die Vereinigung
 * der Kreise wird nie als Geometrie gebraucht, nur als Bild.
 */
export function useHidingAreaLayer(map: Ref<L.Map | null>) {
  const store = useGameStore()

  let layer: L.Layer | null = null
  let canvas: HTMLCanvasElement | null = null

  function draw() {
    if (!map.value || !canvas) return
    const instance = map.value
    const size = instance.getSize()
    const ratio = window.devicePixelRatio || 1

    if (canvas.width !== size.x * ratio || canvas.height !== size.y * ratio) {
      canvas.width = size.x * ratio
      canvas.height = size.y * ratio
    }
    canvas.style.width = `${size.x}px`
    canvas.style.height = `${size.y}px`

    // Der Canvas hängt am Karten-Pane, das beim Ziehen mitverschoben wird. Damit das
    // Bild trotzdem zum Kartenausschnitt passt, wird er in jedem Zug an die linke obere
    // Ecke des sichtbaren Bereichs zurückgesetzt.
    const corner = instance.containerPointToLayerPoint([0, 0])
    L.DomUtil.setPosition(canvas, corner)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)

    ctx.fillStyle = cssColor('--area-excluded', 'rgb(15 23 42 / 0.55)')
    ctx.fillRect(0, 0, size.x, size.y)

    const radius = store.hidingRadius
    const candidates = store.candidates
    if (!candidates.length) return

    // Meter in Bildschirmpixel: über einen zweiten Punkt derselben Breite, damit die
    // Mercator-Streckung bei der jeweiligen Breite mit drin ist.
    const centre = instance.getCenter()
    const centrePoint = instance.latLngToContainerPoint(centre)
    const edgePoint = instance.latLngToContainerPoint(
      L.latLng(centre.lat, centre.lng + radius / (111320 * Math.cos((centre.lat * Math.PI) / 180))),
    )
    const radiusPx = Math.abs(edgePoint.x - centrePoint.x)

    ctx.globalCompositeOperation = 'destination-out'
    for (const station of candidates) {
      const point = instance.latLngToContainerPoint([station.lat, station.lon])
      // Was weit ausserhalb des Bildes liegt, muss nicht gezeichnet werden.
      if (
        point.x < -radiusPx ||
        point.y < -radiusPx ||
        point.x > size.x + radiusPx ||
        point.y > size.y + radiusPx
      ) {
        continue
      }
      ctx.beginPath()
      ctx.arc(point.x, point.y, radiusPx, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  function hide() {
    if (canvas) canvas.style.visibility = 'hidden'
  }

  function show() {
    if (canvas) canvas.style.visibility = 'visible'
  }

  function bind() {
    if (!map.value || layer) return

    const HidingArea = L.Layer.extend({
      onAdd(instance: L.Map) {
        canvas = L.DomUtil.create('canvas', 'hiding-area-canvas')
        canvas.style.position = 'absolute'
        canvas.style.pointerEvents = 'none'
        instance.getPanes().overlayPane.appendChild(canvas)
        instance.on('move viewreset resize zoomend moveend', draw)
        // Während der Zoom-Animation stimmen Container- und Layer-Koordinaten kurzzeitig
        // nicht überein; mitzuzeichnen liesse die Abdunkelung sichtbar verrutschen. Sie
        // für die zwei Zehntelsekunden auszublenden ist ruhiger als hinterherzuhinken.
        instance.on('zoomstart', hide)
        instance.on('zoomend', show)
        draw()
      },
      onRemove(instance: L.Map) {
        instance.off('move viewreset resize zoomend moveend', draw)
        instance.off('zoomstart', hide)
        instance.off('zoomend', show)
        canvas?.remove()
        canvas = null
      },
    })

    layer = new (HidingArea as unknown as new () => L.Layer)()
    layer.addTo(map.value)
  }

  // Im Setup-Scope registriert, nicht in bind(): dort erzeugte Watcher gehörten zu keinem
  // Scope und blieben beim Unmount der Karte als Leak zurück — dieselbe Überlegung wie in
  // useStationLayers. `draw` prüft selbst, ob Karte und Canvas schon da sind.
  //
  // Beobachtet wird die Liste selbst, nicht ihre Länge: zwei verschiedene Antworten können
  // gleich viele Halte übrig lassen, und dann bliebe die Abdunkelung auf dem alten Stand.
  // Teuer ist das nicht — `candidates` wird nur neu berechnet, wenn sich Antworten oder
  // Haltestellendaten ändern, und hängt bewusst nicht an der Position.
  watch(() => store.candidates, draw)
  watch(() => store.hidingRadius, draw)

  return { bind, draw }
}
