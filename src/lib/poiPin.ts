/**
 * Die Ortsmarker der Karte — ein Piktogramm im runden Feld.
 *
 * Sie werden von zwei Seiten gesetzt: von der Fragen-Vorschau, die eine Kategorie zeigt
 * und den nächstgelegenen Ort hervorhebt, und vom Orte-Menü links, das beliebig viele
 * Kategorien dauerhaft einblendet. Beide müssen gleich aussehen, sonst wirken dieselben
 * Orte je nach Herkunft wie zweierlei Dinge — deshalb steht die Fabrik hier und nicht in
 * einem der beiden Aufrufer.
 */
import L from 'leaflet'

/**
 * Piktogramme der Ortskategorien, im 24er-Raster und geschlossen gezeichnet: bei
 * rund 14 px Kantenlänge überlebt nur eine kräftige Silhouette.
 */
export const POI_GLYPHS: Record<string, string> = {
  // Giebel über drei Säulen
  museum: 'M12 2 1 8v2h22V8zM4 12h2.6v6H4zm6.7 0h2.6v6h-2.6zM17.4 12H20v6h-2.6zM2 20h20v2H2z',
  // Aufgeschlagenes Buch
  library:
    'M12 6.6C10.3 5.3 7.9 4.6 5 4.6c-1 0-2 .1-3 .3v13.4c1-.2 2-.3 3-.3 2.9 0 5.3.7 7 2 1.7-1.3 4.1-2 7-2 1 0 2 .1 3 .3V4.9c-1-.2-2-.3-3-.3-2.9 0-5.3.7-7 2z',
  // Filmstreifen
  cinema:
    'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 3v2h2V7zm14 0v2h2V7zM4 11v2h2v-2zm14 0v2h2v-2zM4 15v2h2v-2zm14 0v2h2v-2zM8 7v10h8V7z',
  // Medizinisches Kreuz
  hospital: 'M9 2h6v7h7v6h-7v7H9v-7H2V9h7z',
  // Nadelbaum
  park: 'M12 2 5.5 11H9l-4 6h6v5h2v-5h6l-4-6h3.5z',
  // Tierpfote: Ballen und drei Zehen. Vier Zehen zerfallen bei 14 px zu Rauschen.
  zoo: 'M12 12.4c2.9 0 5.3 2 5.3 4.5 0 1.7-1.3 3.1-3 3.1-1.1 0-1.8-.5-2.3-.5s-1.2.5-2.3.5c-1.7 0-3-1.4-3-3.1 0-2.5 2.4-4.5 5.3-4.5zM5.2 5.8c1.7 0 3.1 1.7 3.1 3.8s-1.4 3.8-3.1 3.8S2.1 11.7 2.1 9.6s1.4-3.8 3.1-3.8zm13.6 0c1.7 0 3.1 1.7 3.1 3.8s-1.4 3.8-3.1 3.8-3.1-1.7-3.1-3.8 1.4-3.8 3.1-3.8zM12 2.5c1.8 0 3.2 1.8 3.2 4s-1.4 4-3.2 4-3.2-1.8-3.2-4 1.4-4 3.2-4z',
  // Fahne am Loch
  golf_course: 'M7 2h2v20H7zm2 .8 11 4-11 4z',
  // Riesenrad
  theme_park:
    'M12 2a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-1 2.1V10H5.4A7 7 0 0 1 11 4.1zm2 0A7 7 0 0 1 18.6 10H13zM5.4 12H11v5.9A7 7 0 0 1 5.4 12zm7.6 5.9V12h5.6a7 7 0 0 1-5.6 5.9zM8 21h8v2H8z',
  // Globus. Eine Flagge wäre vom Golfplatz-Symbol nicht zu unterscheiden.
  consulate:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2c1.2 0 2.5 2.2 3 5.8H9c.5-3.6 1.8-5.8 3-5.8zM6.8 10H4.5a7.9 7.9 0 0 1 3.3-4.4A16 16 0 0 0 6.8 10zm0 4c.1 1.6.4 3.1.9 4.4A7.9 7.9 0 0 1 4.5 14zM9 14h6c-.5 3.6-1.8 5.8-3 5.8S9.5 17.6 9 14zm8.2 0h2.3a7.9 7.9 0 0 1-3.2 4.4c.5-1.3.8-2.8.9-4.4zm0-4a16 16 0 0 0-1-4.4A7.9 7.9 0 0 1 19.5 10z',
  // Flugzeug
  airport:
    'M21.5 15.5v-2l-8-5V3a1.5 1.5 0 0 0-3 0v5.5l-8 5v2l8-2.4V19l-2.2 1.6V22l3.7-1 3.7 1v-1.4L13.5 19v-5.9z',
  // Fisch. Der Schwanz braucht spürbar Breite, sonst bleibt optisch nur ein Auge übrig.
  aquarium:
    'M22 12c-1.9 3.3-5.4 5.6-9.2 5.6-2.5 0-4.8-.9-6.4-2.5L2 19.5v-15l4.4 4.4C8 7.3 10.3 6.4 12.8 6.4c3.8 0 7.3 2.3 9.2 5.6zm-5.6-1.4a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z',
  // Bahnhof — für „Rail Station", das nicht aus poi.json kommt
  station:
    'M12 2c-4 0-7 .5-7 4v8.5A2.5 2.5 0 0 0 7.5 17L6 19.5v.5h2l1.5-2h5l1.5 2h2v-.5L16.5 17a2.5 2.5 0 0 0 2.5-2.5V6c0-3.5-3-4-7-4zM7.5 7h9v4.5h-9zm2 6.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm5 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z',
}

/** Punkt als Rückfall, wenn eine Kategorie kein eigenes Zeichen hat. */
export const POI_FALLBACK_GLYPH = 'M12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12z'

/** Ein Ort, so viel wie ein Marker davon braucht. */
export interface PinPoi {
  name: string
  lat: number
  lon: number
  category?: string
}

/**
 * Ein Ort als Piktogramm seiner Kategorie. Der hervorgehobene wird grösser und trägt
 * einen Ring: er ist der Ort, um den es in der Frage geht.
 */
export function poiPin(poi: PinPoi, color: string, highlighted = false) {
  const size = highlighted ? 30 : 22
  const glyph = POI_GLYPHS[poi.category ?? ''] ?? POI_FALLBACK_GLYPH
  const classes = highlighted ? 'poi-pin is-nearest' : 'poi-pin'

  return L.marker([poi.lat, poi.lon], {
    keyboard: false,
    // Leaflet stapelt Marker nach Breitengrad. In der Innenstadt liegen Dutzende Orte
    // übereinander — ohne Vorrang verschwindet ausgerechnet der hervorgehobene darunter.
    zIndexOffset: highlighted ? 1000 : 0,
    icon: L.divIcon({
      className: 'poi-pin-host',
      html:
        `<span class="${classes}" style="--c:${color}">` +
        `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${glyph}"/></svg>` +
        `</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }),
  }).bindTooltip(poi.name, { direction: 'top', offset: [0, -size / 2 - 2] })
}
