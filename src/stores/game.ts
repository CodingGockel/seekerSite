import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  AnsweredQuestion,
  AppConfig,
  Station,
  StationWithDistance,
  StationsFile,
  TransportMode,
} from '../types/game'
import { distanceMeters } from '../lib/geo'
import { predicateFor, type EliminationCtx } from '../lib/eliminate'
import { useQuestionStore } from './questions'

const BASE = import.meta.env.BASE_URL
const PREFS_KEY = 'hs.prefs.v2'

interface Prefs {
  activeModes: TransportMode[]
  basemapId: string | null
  manualPosition: { lat: number; lon: number } | null
  /** Sind die Werkzeugknöpfe rechts ausgefahren? */
  toolsOpen: boolean
  /** Ist das Orte-Menü links ausgefahren? */
  poiMenuOpen: boolean
  /** Ortskategorien, die dauerhaft auf der Karte liegen. */
  activePoiCategories: string[]
}

const DEFAULT_PREFS: Prefs = {
  activeModes: ['train', 'metro', 'tram', 'bus', 'ferry'],
  basemapId: null,
  manualPosition: null,
  toolsOpen: true,
  poiMenuOpen: false,
  // Leer: über zweitausend Orte beim ersten Start wären eine Wand aus Piktogrammen.
  activePoiCategories: [],
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
  } catch {
    // Privater Modus oder blockierter Storage — Defaults sind gut genug.
    return DEFAULT_PREFS
  }
}

export const useGameStore = defineStore('game', () => {
  const prefs = loadPrefs()
  const questions = useQuestionStore()

  const config = ref<AppConfig | null>(null)
  const stations = ref<Station[]>([])
  const area = ref<GeoJSON.FeatureCollection | null>(null)
  const dataDate = ref<string>('')

  const loading = ref(true)
  const error = ref<string | null>(null)

  const selectedId = ref<string | null>(null)
  const search = ref('')
  const activeModes = ref<Set<TransportMode>>(new Set(prefs.activeModes))
  /** Ausgefahrene Werkzeugleiste rechts — eingeklappt gibt sie die Karte frei. */
  const toolsOpen = ref(prefs.toolsOpen)
  /** Ausgefahrenes Orte-Menü links. */
  const poiMenuOpen = ref(prefs.poiMenuOpen)
  /**
   * Ortskategorien, die unabhängig von einer Frage auf der Karte liegen.
   *
   * Dasselbe wie `activeModes` bei den Halten, nur für die Orte: eine reine
   * Sichtbarkeitsfrage. Was eine Fragekarte zeigt, hängt nicht daran — die Vorschau
   * zeichnet ihre Kategorie immer, auch wenn sie hier nicht angehakt ist.
   */
  const activePoiCategories = ref<Set<string>>(new Set(prefs.activePoiCategories))
  const basemapId = ref<string | null>(prefs.basemapId)

  /** Was die Ortung liefert. */
  const gpsPosition = ref<{ lat: number; lon: number; accuracy: number } | null>(null)

  /**
   * Von Hand auf der Karte gesetzter Standort. Nützlich zum Planen ohne GPS und
   * wenn die Ortung im Zug daneben liegt.
   */
  const manualPosition = ref<{ lat: number; lon: number } | null>(prefs.manualPosition)

  /** Wartet die Karte gerade auf einen Tap, um den Standort zu setzen? */
  const placingPosition = ref(false)


  /**
   * Der gesetzte Punkt hat Vorrang vor der Ortung — sonst würde ihn das nächste
   * GPS-Update überschreiben, und Setzen wäre sinnlos.
   */
  const userPosition = computed(() =>
    manualPosition.value ? { ...manualPosition.value, accuracy: 0 } : gpsPosition.value,
  )

  const isManualPosition = computed(() => manualPosition.value !== null)

  watch(
    [
      activeModes,
      basemapId,
      manualPosition,
      toolsOpen,
      poiMenuOpen,
      activePoiCategories,
    ],
    () => {
      try {
        localStorage.setItem(
          PREFS_KEY,
          JSON.stringify({
            activeModes: [...activeModes.value],
            basemapId: basemapId.value,
            manualPosition: manualPosition.value,
            toolsOpen: toolsOpen.value,
            poiMenuOpen: poiMenuOpen.value,
            activePoiCategories: [...activePoiCategories.value],
          } satisfies Prefs),
        )
      } catch {
        // Storage nicht verfügbar — die Einstellung gilt dann nur für diese Sitzung.
      }
    },
    { deep: true },
  )

  const hidingRadius = computed(() => config.value?.hidingRadiusMeters ?? 800)

  const basemaps = computed(() => config.value?.basemaps ?? [])

  /** Die gemerkte Karte, oder die erste — eine ungültige gespeicherte ID fällt zurück. */
  const activeBasemap = computed(
    () => basemaps.value.find((b) => b.id === basemapId.value) ?? basemaps.value[0] ?? null,
  )

  /** Halte, die bespielbar sind — explizit ausgeschlossene fliegen raus. */
  const playable = computed(() => stations.value.filter((s) => s.ticketValid !== false))

  /**
   * Nur die Bahnhöfe. „Ist dein nächster Bahnhof meiner?" darf nicht plötzlich
   * Bushaltestellen meinen, seit auch die in der Liste stehen.
   */
  const railStations = computed(() => playable.value.filter((s) => s.isStation))

  /**
   * Ein Prädikat je eingetragener Antwort.
   *
   * Getrennt von `candidates`, weil das Bauen der teure Teil ist: die Buurt-Ebene bringt
   * knapp 4000 Flächen mit, die einmal indiziert werden wollen. So passiert das nur, wenn
   * sich die Antworten ändern — und nicht bei jedem GPS-Tick, der `userPosition` anfasst.
   */
  function eliminationCtx(): EliminationCtx {
    return {
      poisByCategory: questions.poisByCategory,
      railStations: railStations.value,
      divisionsFor: questions.divisionsFor,
      borderSegmentsFor: questions.borderSegmentsFor,
    }
  }

  const predicates = computed(() => {
    // Lesen, damit die Liste neu gebaut wird, sobald eine nachgeladene Divisions- oder
    // Grenzdatei da ist: vorher lässt das Prädikat mangels Geometrie alles durch.
    void questions.mapDataVersion

    const ctx = eliminationCtx()
    return questions.answers.map((entry) => predicateFor(entry, ctx))
  })

  /**
   * Die Halte, die nach allen Antworten noch als Versteck in Frage kommen.
   *
   * Das ist der Spielstand der Sucher, verdichtet auf eine Menge: das verbleibende
   * Suchgebiet ist die Vereinigung der Versteck-Radien um genau diese Halte.
   */
  const candidates = computed(() => {
    const matchers = predicates.value
    if (!matchers.length) return playable.value
    return playable.value.filter((station) => matchers.every((match) => match(station)))
  })

  /** Kandidaten mit Entfernung zur aktuellen Position. */
  const withDistance = computed<StationWithDistance[]>(() => {
    const pos = userPosition.value
    const radius = hidingRadius.value
    return candidates.value.map((s) => {
      const distance = pos ? distanceMeters(pos, s) : null
      return {
        ...s,
        distance,
        withinHidingRadius: distance !== null && distance <= radius,
      }
    })
  })

  /** Was auf der Karte liegt: nach Verkehrsmittel gefiltert. */
  const visibleStations = computed(() =>
    withDistance.value.filter((s) => activeModes.value.has(s.mode)),
  )

  /** Was in der Liste steht: zusätzlich nach Suchbegriff, nach Entfernung sortiert. */
  const listedStations = computed(() => {
    const q = search.value.trim().toLowerCase()
    const matches = (s: StationWithDistance) =>
      s.name.toLowerCase().includes(q) || s.aliases.some((a) => a.toLowerCase().includes(q))
    const rows = q ? visibleStations.value.filter(matches) : [...visibleStations.value]

    return rows.sort((a, b) => {
      // Bei aktiver Suche zuerst nach Treffergüte: wer "Haarlem" tippt, meint
      // Haarlem und nicht Haarlem Spaarnwoude, auch wenn das näher liegt.
      if (q) {
        const rank = (name: string) =>
          name.toLowerCase() === q ? 0 : name.toLowerCase().startsWith(q) ? 1 : 2
        const byRank = rank(a.name) - rank(b.name)
        if (byRank !== 0) return byRank
      }
      if (a.distance === null || b.distance === null) return a.name.localeCompare(b.name, 'nl')
      return a.distance - b.distance
    })
  })

  const selectedStation = computed(
    () => withDistance.value.find((s) => s.id === selectedId.value) ?? null,
  )



  /**
   * Was von den Kandidaten übrig bliebe, wenn diese Antwort dazukäme.
   *
   * Damit steht die Aussage einer Karte schon *vor* dem Eintragen da — bei einer Frage,
   * die den Verstecker Karten kostet, ist das der halbe Entschluss.
   */
  function candidatesIf(entry: AnsweredQuestion): number {
    const match = predicateFor(entry, eliminationCtx())
    let count = 0
    for (const station of candidates.value) if (match(station)) count++
    return count
  }

  const modeCounts = computed(() => {
    // Ausgangspunkt sind die Verkehrsmittel aus der Konfiguration, damit auch eines
    // ohne Halte eine Null bekommt statt undefined.
    const counts = Object.fromEntries(
      Object.keys(config.value?.modes ?? {}).map((m) => [m, 0]),
    ) as Record<TransportMode, number>
    for (const s of candidates.value) counts[s.mode] = (counts[s.mode] ?? 0) + 1
    return counts
  })

  async function loadJson<T>(file: string): Promise<T> {
    const res = await fetch(`${BASE}data/${file}`)
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
    return res.json()
  }

  async function load() {
    loading.value = true
    error.value = null
    try {
      const [cfg, stationsFile, areaFile] = await Promise.all([
        loadJson<AppConfig>('config.json'),
        loadJson<StationsFile>('stations.json'),
        loadJson<GeoJSON.FeatureCollection>('area.geojson').catch(() => null),
      ])
      config.value = cfg
      stations.value = stationsFile.stations
      dataDate.value = stationsFile.generatedAt
      area.value = areaFile
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function select(id: string | null) {
    selectedId.value = id
  }

  function setManualPosition(point: { lat: number; lon: number }) {
    manualPosition.value = point
    placingPosition.value = false
  }

  /** Zurück zur Ortung. */
  function clearManualPosition() {
    manualPosition.value = null
    placingPosition.value = false
  }


  function togglePoiCategory(id: string) {
    const next = new Set(activePoiCategories.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    activePoiCategories.value = next
  }

  function clearPoiCategories() {
    activePoiCategories.value = new Set()
  }

  function toggleMode(mode: TransportMode) {
    const next = new Set(activeModes.value)
    if (next.has(mode)) next.delete(mode)
    else next.add(mode)
    // Auch das leere Set ist erlaubt: eine Karte ganz ohne Halte ist beim Planen einer
    // Fragekarte genau das, was man sehen will.
    activeModes.value = next
  }

  return {
    config,
    stations,
    area,
    dataDate,
    loading,
    error,
    selectedId,
    search,
    activeModes,
    toolsOpen,
    poiMenuOpen,
    activePoiCategories,
    basemapId,
    basemaps,
    activeBasemap,
    gpsPosition,
    manualPosition,
    placingPosition,
    isManualPosition,
    userPosition,
    hidingRadius,
    playable,
    candidates,
    candidatesIf,
    railStations,
    visibleStations,
    listedStations,
    selectedStation,
    modeCounts,
    load,
    select,
    toggleMode,
    togglePoiCategory,
    clearPoiCategories,
    setManualPosition,
    clearManualPosition,
  }
})
