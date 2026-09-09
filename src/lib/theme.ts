/**
 * Leaflet erwartet konkrete Farbwerte, das Farbschema steckt aber in CSS-Variablen.
 * Also einmal auslesen.
 */
export function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}
