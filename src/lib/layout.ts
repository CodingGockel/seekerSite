/**
 * Anteil der Fensterhöhe, den das halb geöffnete Bottom Sheet einnimmt.
 *
 * Wird an zwei Stellen gebraucht: das Sheet rastet dort ein, und die Karte muss
 * den verdeckten Bereich beim Einpassen aussparen — sonst landet die ausgewählte
 * Station hinter dem Sheet.
 */
export const SHEET_HALF_RATIO = 0.45
