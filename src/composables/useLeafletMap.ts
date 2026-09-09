import { onUnmounted, shallowRef, type Ref } from 'vue'
import L from 'leaflet'
import type { AppConfig, Basemap } from '../types/game'

/**
 * Besitzt die Leaflet-Instanz.
 *
 * Leaflet wird bewusst direkt benutzt statt über einen Vue-Wrapper: die Wrapper
 * hinken der Leaflet-Version hinterher und stehen genau bei den Dingen im Weg,
 * um die es hier geht (dynamische Radien, Canvas-Renderer, später Halbebenen).
 */
export function useLeafletMap(container: Ref<HTMLElement | null>) {
  const map = shallowRef<L.Map | null>(null)
  /** Gemeinsamer Canvas-Renderer für die Radien — als DOM-Elemente würden sie ruckeln. */
  const renderer = shallowRef<L.Canvas | null>(null)

  let tileLayer: L.TileLayer | null = null

  function create(config: AppConfig) {
    if (!container.value || map.value) return

    const instance = L.map(container.value, {
      center: config.map.center,
      zoom: config.map.zoom,
      minZoom: config.map.minZoom,
      maxZoom: config.map.maxZoom,
      zoomControl: false,
      // Leaflet blendet sonst dauerhaft einen Werbe-Link auf sich selbst ein. Die
      // Attribution der Kartendaten bleibt davon unberührt — die ist Lizenzpflicht.
      attributionControl: false,
    })

    L.control.zoom({ position: 'topright' }).addTo(instance)
    L.control
      .attribution({ position: 'bottomleft', prefix: false })
      // Die Basiskarten bringen ihre Attribution als Layer mit; die Verwaltungsflächen
      // sind eine Datei ohne Layer und müssen hier fest stehen. CC BY verlangt die
      // Nennung, unabhängig davon, ob gerade eine Fläche gezeichnet ist.
      .addAttribution(
        'Verwaltungsgrenzen &copy; <a href="https://www.cbs.nl/">CBS</a>/' +
          '<a href="https://www.pdok.nl/">PDOK</a> (CC BY 4.0)',
      )
      .addTo(instance)

    renderer.value = L.canvas({ padding: 0.5 }).addTo(instance)
    map.value = instance

    setupCompactAttribution(instance)
  }

  /**
   * Die Attribution muss aus Lizenzgründen erreichbar bleiben, frisst auf einem
   * Handy aber eine ganze Zeile. Deshalb auf ein antippbares „i" eingeklappt —
   * die von OpenStreetMap für kleine Displays vorgesehene Lösung.
   */
  function setupCompactAttribution(instance: L.Map) {
    const el = instance.getContainer().querySelector<HTMLElement>('.leaflet-control-attribution')
    if (!el) return

    el.classList.add('attribution-compact')
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
    el.setAttribute('aria-label', 'Kartenquellen anzeigen')

    L.DomEvent.disableClickPropagation(el)
    L.DomEvent.on(el, 'click', (event) => {
      const target = event.target as HTMLElement
      // Im aufgeklappten Zustand sollen die Quellen-Links normal funktionieren.
      if (target.tagName === 'A' && el.classList.contains('is-open')) return
      L.DomEvent.preventDefault(event)
      el.classList.toggle('is-open')
    })
  }

  /** Basiskarte wechseln. Der alte Layer verschwindet mitsamt seiner Attribution. */
  function setBasemap(basemap: Basemap, config: AppConfig) {
    if (!map.value) return

    tileLayer?.remove()
    tileLayer = L.tileLayer(basemap.url, {
      attribution: basemap.attribution,
      // Über die native Auflösung hinaus hochskalieren statt graue Flächen zeigen.
      maxNativeZoom: basemap.maxZoom,
      maxZoom: config.map.maxZoom,
      // Steuert den Farbfilter aus style.css: Luftbilder dürfen nicht invertiert werden.
      className: basemap.photo ? 'basemap-photo' : 'basemap-drawn',
    }).addTo(map.value)

    // Die Kacheln gehören hinter alles andere.
    tileLayer.bringToBack()
  }

  onUnmounted(() => {
    map.value?.remove()
    map.value = null
  })

  return { map, renderer, create, setBasemap }
}
