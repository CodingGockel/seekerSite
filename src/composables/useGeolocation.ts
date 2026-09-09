import { onUnmounted, ref } from 'vue'

export type GeoStatus = 'idle' | 'locating' | 'active' | 'denied' | 'unavailable' | 'error'

export interface GeoFix {
  lat: number
  lon: number
  accuracy: number
}

/**
 * Live-Standort per watchPosition.
 *
 * Ortung im Hintergrund läuft weiter und zieht Akku, deshalb wird der Watch
 * abgemeldet, sobald die Seite nicht mehr sichtbar ist — beim Hide & Seek liegt
 * das Handy die meiste Zeit in der Tasche.
 */
export function useGeolocation() {
  const fix = ref<GeoFix | null>(null)
  const status = ref<GeoStatus>('idle')
  const message = ref<string | null>(null)

  let watchId: number | null = null
  let wanted = false

  const options: PositionOptions = {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 20000,
  }

  function onSuccess(pos: GeolocationPosition) {
    fix.value = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }
    status.value = 'active'
    message.value = null
  }

  function onError(err: GeolocationPositionError) {
    if (err.code === err.PERMISSION_DENIED) {
      status.value = 'denied'
      message.value = 'Standortzugriff abgelehnt. In den Browser-Einstellungen freigeben.'
      wanted = false
      return
    }
    status.value = 'error'
    message.value =
      err.code === err.TIMEOUT
        ? 'Kein GPS-Fix. Unter freiem Himmel nochmal versuchen.'
        : 'Standort nicht verfügbar.'
  }

  function attach() {
    if (watchId !== null || !wanted) return
    watchId = navigator.geolocation.watchPosition(onSuccess, onError, options)
  }

  function detach() {
    if (watchId === null) return
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }

  function onVisibilityChange() {
    if (document.hidden) detach()
    else attach()
  }

  function start() {
    if (!('geolocation' in navigator)) {
      status.value = 'unavailable'
      message.value = 'Dieses Gerät kennt keine Standortbestimmung.'
      return
    }
    // Ohne HTTPS liefert der Browser dauerhaft PERMISSION_DENIED — das ist kein
    // Nutzerfehler, also sagen wir gleich, woran es liegt.
    if (!window.isSecureContext) {
      status.value = 'unavailable'
      message.value = 'Standort braucht HTTPS. Über localhost oder eine https-URL öffnen.'
      return
    }
    wanted = true
    if (!fix.value) status.value = 'locating'
    attach()
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function stop() {
    wanted = false
    detach()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    status.value = 'idle'
  }

  onUnmounted(() => {
    detach()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { fix, status, message, start, stop }
}
