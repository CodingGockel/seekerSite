export type TransportMode = 'train' | 'metro' | 'tram' | 'bus' | 'ferry'

export interface Station {
  id: string
  name: string
  /** Zweitname aus der Quelle ("Centraal Station"), damit die Suche ihn findet */
  aliases: string[]
  lat: number
  lon: number
  /** Das Verkehrsmittel, wegen dem der Halt in der Liste steht — danach wird gefiltert */
  mode: TransportMode
  /** Bedienende Linien je Verkehrsmittel; leere Verkehrsmittel fehlen */
  lines: Partial<Record<TransportMode, string[]>>
  /** Bahnhof im Sinn der Frage „nächster Bahnhof" */
  isStation: boolean
  /** Mit dem Ticket erreichbar, aber nur gegen Aufpreis */
  extraCost: boolean
  /** false schliesst den Halt vom Spiel aus */
  ticketValid: boolean
  notes: string
}

export interface StationsFile {
  version: number
  generatedAt: string
  source: string
  stations: Station[]
}

export interface Basemap {
  id: string
  label: string
  url: string
  attribution: string
  maxZoom: number
  /**
   * Luftbild o.ä. — solche Kacheln bleiben vom Entsättigungsfilter ausgenommen, der
   * die gezeichneten Karten hinter den Markern zurücktreten lässt.
   */
  photo: boolean
}

export interface ModeStyle {
  label: string
  color: string
}

export interface AppConfig {
  /** Radius um einen Halt, innerhalb dessen man sich verstecken darf */
  hidingRadiusMeters: number
  map: {
    center: [number, number]
    zoom: number
    minZoom: number
    maxZoom: number
  }
  basemaps: Basemap[]
  modes: Record<TransportMode, ModeStyle>
}

/** Halt mit auf die aktuelle Position bezogenen Angaben. */
export interface StationWithDistance extends Station {
  /** Luftlinie in Metern, null solange keine Position bekannt ist */
  distance: number | null
  /** Liegt die aktuelle Position im Versteck-Radius dieses Halts? */
  withinHidingRadius: boolean
}

// ---------------------------------------------------------------------------
// Fragekarten und ihre Visualisierung
// ---------------------------------------------------------------------------

export interface LatLon {
  lat: number
  lon: number
}

/**
 * Wie eine Frage auf der Karte dargestellt wird.
 *
 * - `radius`          Kreis um den Standort (Radar)
 * - `poi-within`      Kreis plus die Orte darin (Tentacles)
 * - `poi-nearest`     alle Orte der Kategorie, der nächstgelegene hervorgehoben (Matching)
 * - `poi-isodistance` dasselbe Bild wie `poi-nearest` (Measuring). Früher standen hier
 *                     gleich grosse Kreise um alle Orte, deren Vereinigung die Antwort
 *                     „näher" war — ohne Ja/Nein gibt es nichts mehr einzufärben, und
 *                     zum Spielen zählen die Orte selbst. Der eigene Wert bleibt, weil
 *                     die Frage eine andere ist: Abstand statt Identität.
 * - `division`        die Verwaltungsfläche, in der der Fragepunkt liegt, hervorgehoben,
 *                     die Nachbarn als Umriss (Matching)
 * - `division-border` dasselbe Bild plus eine Linie zum nächsten Punkt auf der Grenze
 *                     dieser Fläche (Measuring)
 * - `border`          eine Grenzlinie und die Strecke zum nächsten Punkt darauf. Die
 *                     Landesgrenze umschliesst keine Fläche, in der jemand stünde —
 *                     gefragt ist nur der Abstand (Measuring)
 * - `thermometer`     die Mittelsenkrechte zwischen Standort und dem Punkt, der
 *                     `radiusMeters` in der gewählten Richtung liegt. Sie halbiert die
 *                     Karte und liegt `radiusMeters / 2` vom Standort entfernt
 * - `none`            nicht zeichenbar, nur abhakbar (Photos, Küstenlinie, Meereshöhe)
 */
export type VizKind =
  | 'radius'
  | 'thermometer'
  | 'poi-within'
  | 'poi-nearest'
  | 'poi-isodistance'
  | 'division'
  | 'division-border'
  | 'border'
  | 'none'

export interface Question {
  id: string
  label: string
  viz: VizKind
  poiCategory: string | null
  /** Ebene aus `divisions/<level>.json` — das Gegenstück zu `poiCategory` für Flächen. */
  divisionLevel?: string | null
  /** „Gemeente", „Wijk" … für den Fragesatz, ohne dafür die Geometrie zu laden. */
  divisionLabel?: string | null
  /** Grenzlinie aus `borders/<id>.json` — das Gegenstück für Linien. */
  borderId?: string | null
  /** „Landesgrenze" für den Fragesatz. */
  borderLabel?: string | null
  radiusMeters?: number | null
  /** Gesetzt, wenn die Frage mit den vorhandenen Daten kaum etwas aussagt. */
  weak: string | null
}

export interface QuestionCategory {
  id: string
  name: string
  prompt: string
  answers: string[]
  timeLimitMin: number
  cards: { draw: number; keep: number }
  questions: Question[]
}

export interface QuestionsFile {
  version: number
  generatedAt: string
  game: string
  size: string
  categories: QuestionCategory[]
}

export interface Poi {
  id: string
  name: string
  category: string
  lat: number
  lon: number
}

export interface PoiFile {
  version: number
  generatedAt: string
  categories: { id: string; label: string }[]
  pois: Poi[]
}

/** Eine Verwaltungsfläche — Gemeente, Wijk, COROP-Regio, Buurt. */
export interface DivisionArea {
  /** Amtlicher Code, „GM0479" */
  code: string
  name: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export interface DivisionsFile {
  version: number
  generatedAt: string
  source: string
  level: string
  label: string
  bbox: [number, number, number, number]
  areas: DivisionArea[]
}

/** Ein Stück Grenze — die Wege, die sich zwei Länder teilen. */
export interface BorderSegment {
  /** Das Nachbarland, „Deutschland" */
  with: string
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString
}

export interface BordersFile {
  version: number
  generatedAt: string
  source: string
  id: string
  label: string
  segments: BorderSegment[]
}

/**
 * Eine Frage als Geometrie auf der Karte.
 *
 * Es liegt immer höchstens eine davon auf der Karte: sie zeigt, worüber die Frage
 * redet, und verschwindet wieder. Was von einer Frage bleibt, ist die `AnsweredQuestion`
 * — die Vorschau ist nur der Blick darauf, bevor die Antwort da ist.
 *
 * `origin` wird beim Anlegen eingefroren: die Frage wurde von einem bestimmten Ort
 * aus gestellt. Mit der Live-Position würde der Kreis mitwandern und seine Aussage
 * verlieren.
 */
export interface MapPreview {
  id: string
  questionId: string
  categoryId: string
  label: string
  viz: VizKind
  origin: LatLon
  radiusMeters?: number | null
  poiCategory?: string | null
  divisionLevel?: string | null
  divisionLabel?: string | null
  borderId?: string | null
  borderLabel?: string | null
  /** Nur Thermometer: die gewählte Fahrtrichtung in Grad, 0 = Nord. */
  bearing?: number | null
  createdAt: number
}

/**
 * Eine gestellte und beantwortete Frage.
 *
 * Das ist der Spielstand der Sucher: jede Antwort schliesst Halte aus, und was alle
 * zusammen übrig lassen, ist das verbleibende Suchgebiet. Anders als `MapPreview` wird
 * sie deshalb gespeichert und überlebt einen Neustart.
 *
 * `origin` ist eingefroren — die Frage wurde von einem bestimmten Ort aus gestellt, und
 * mit der Live-Position würde sie nachträglich eine andere Aussage bekommen.
 */
export interface AnsweredQuestion {
  /** Eigene ID, nicht die der Karte: dieselbe Karte darf zweimal gestellt werden. */
  id: string
  questionId: string
  categoryId: string
  label: string
  viz: VizKind
  /** Wo die Sucher standen, als sie gefragt haben. */
  origin: LatLon
  /** Nur Thermometer: der aus Richtung und Distanz gerechnete Zielpunkt. */
  destination?: LatLon | null
  /** Nur Thermometer: die gewählte Richtung in Grad, 0 = Nord, im Uhrzeigersinn. */
  bearing?: number | null
  radiusMeters?: number | null
  poiCategory?: string | null
  divisionLevel?: string | null
  borderId?: string | null
  /**
   * Die Antwort. Je nach Kategorie `yes`/`no`, `closer`/`further`, `hotter`/`colder`,
   * bei Tentacles die ID des Orts oder `out-of-range`. `unknown` steht für „nicht
   * auswertbar" (Veto, Foto, Karte ohne Daten) und schliesst nichts aus.
   */
  answer: string
  askedAt: number
}
