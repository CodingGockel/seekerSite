<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useGameStore } from '../stores/game'
import { useLeafletMap } from '../composables/useLeafletMap'
import { useStationLayers } from '../composables/useStationLayers'
import { useHidingAreaLayer } from '../composables/useHidingAreaLayer'
import { usePreviewLayers } from '../composables/usePreviewLayers'
import { usePoiLayers } from '../composables/usePoiLayers'

const store = useGameStore()
const container = ref<HTMLElement | null>(null)
const { map, renderer, create, setBasemap } = useLeafletMap(container)
const layers = useStationLayers(map, renderer)
const hidingArea = useHidingAreaLayer(map)
const preview = usePreviewLayers(map, renderer)
const pois = usePoiLayers(map)

let initialised = false

function init() {
  if (initialised || !store.config || !container.value) return
  initialised = true
  create(store.config)
  if (store.activeBasemap) setBasemap(store.activeBasemap, store.config)
  layers.bind()
  // Zuerst das Restgebiet: die Abdunkelung gehört unter alle Marker und Linien, sonst
  // liegt sie über den Halten, um die es gerade geht.
  hidingArea.bind()
  // Vor der Vorschau: so liegt das Dauer-Overlay unter ihren Markern und Linien.
  pois.bind()
  preview.bind()

  map.value?.on('click', (event) => {
    if (!store.placingPosition) return
    store.setManualPosition({ lat: event.latlng.lat, lon: event.latlng.lng })
  })
}

onMounted(init)
watch(() => store.config, init)

watch(
  () => store.activeBasemap,
  (basemap) => {
    if (basemap && store.config && map.value) setBasemap(basemap, store.config)
  },
)

/** Rückfall für den Bezugspunkt einer Frage, wenn keine Ortung läuft. */
function getCenter() {
  const center = map.value?.getCenter()
  return center ? { lat: center.lat, lon: center.lng } : null
}

defineExpose({
  focusStation: layers.focusStation,
  centerOnUser: layers.centerOnUser,
  focusPreview: preview.focusPreview,
  focusPoi: pois.focusPoi,
  getCenter,
})
</script>

<template>
  <div ref="container" class="map" aria-label="Spielgebietskarte"></div>
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
  background: var(--surface-sunken);
}
</style>
