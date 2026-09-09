<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useGameStore } from './stores/game'
import { useQuestionStore } from './stores/questions'
import { useGeolocation } from './composables/useGeolocation'
import GameMap from './components/GameMap.vue'
import BottomSheet from './components/BottomSheet.vue'
import StationList from './components/StationList.vue'
import StationDetail from './components/StationDetail.vue'
import QuestionList from './components/QuestionList.vue'
import AnswerQuestion from './components/AnswerQuestion.vue'
import AnswerList from './components/AnswerList.vue'
import { POI_GLYPHS, POI_FALLBACK_GLYPH } from './lib/poiPin'
import type { LatLon, Question, TransportMode } from './types/game'

const store = useGameStore()
const questions = useQuestionStore()
const geo = useGeolocation()

type Tab = 'stations' | 'questions' | 'answers'
const tab = ref<Tab>('answers')

const mapRef = ref<InstanceType<typeof GameMap> | null>(null)
const sheetRef = ref<InstanceType<typeof BottomSheet> | null>(null)
const pickerOpen = ref(false)

/** Frage, deren Antwort gerade eingetragen wird — samt eingefrorenem Bezugspunkt. */
const answerTarget = ref<{
  question: Question
  origin: LatLon
  radiusMeters: number | null
} | null>(null)

onMounted(() => {
  store.load()
  questions.load()
})

watch(geo.fix, (fix) => {
  store.gpsPosition = fix
})

// Ein Halt lässt sich auch durch Antippen des Markers auswählen. Dann liegt das
// Detail im eingeklappten Sheet und wäre unsichtbar — also aufklappen.
watch(
  () => store.selectedId,
  (id) => {
    if (!id) return
    tab.value = 'stations'
    sheetRef.value?.expand()
  },
)

// Verkehrsmittel, die unter den Kandidaten nicht mehr vorkommen, brauchen keinen Chip.
const modes = computed(() =>
  (Object.keys(store.config?.modes ?? {}) as TransportMode[]).filter(
    (mode) => store.modeCounts[mode] > 0,
  ),
)

const poiCategories = computed(() =>
  questions.poiCategories
    .map((category) => ({
      ...category,
      count: questions.poisByCategory.get(category.id)?.length ?? 0,
      glyph: POI_GLYPHS[category.id] ?? POI_FALLBACK_GLYPH,
    }))
    .filter((category) => category.count > 0),
)

/**
 * Der Ortungsknopf.
 *
 * In der Verstecker-Fassung trug seine Farbe die Aussage „zählt das hier als Versteck?".
 * Für die Sucher gibt es diese Frage nicht — sie stehen nie in ihrem eigenen Versteck.
 * Übrig bleibt der schlichte Zustand der Ortung.
 */
const locate = computed(() => {
  const suffix = store.isManualPosition ? ' · Standort gesetzt' : ''
  if (store.userPosition) return { tone: 'ok', hint: 'Standort bekannt' + suffix }
  if (geo.message.value) return { tone: 'off', hint: geo.message.value }
  if (geo.status.value === 'locating') return { tone: 'off', hint: 'Suche Standort…' }
  return { tone: 'off', hint: 'Ortung aus — antippen zum Einschalten' }
})

const locateLabel = computed(() => {
  if (store.isManualPosition) return 'GPS nutzen'
  if (store.userPosition) return 'Zentrieren'
  return geo.status.value === 'locating' ? 'Suche…' : 'Ortung an'
})

const dismissedGeoMessage = ref<string | null>(null)
const geoNotice = computed(() =>
  geo.message.value && geo.message.value !== dismissedGeoMessage.value ? geo.message.value : null,
)

function onLocate() {
  if (store.isManualPosition) {
    store.clearManualPosition()
    if (!store.gpsPosition) geo.start()
    return
  }
  if (store.userPosition) mapRef.value?.centerOnUser()
  else geo.start()
}

function onSelect(id: string) {
  store.select(id)
  mapRef.value?.focusStation(id)
}

function onBack() {
  store.select(null)
}

function onSelectPoi(id: string) {
  if (questions.selectedPoiId === id) {
    questions.selectPoi(null)
    return
  }
  store.select(null)
  questions.selectPoi(id)
  mapRef.value?.focusPoi(id)
}

function toggleTools() {
  store.toolsOpen = !store.toolsOpen
  pickerOpen.value = false
}

function chooseBasemap(id: string) {
  store.basemapId = id
  pickerOpen.value = false
}

/**
 * Bezugspunkt einer Frage: wo die Sucher stehen. Ohne Ortung die Kartenmitte — beim
 * Planen zu Hause ist das genau der Punkt, den man meint.
 */
function originForQuestion() {
  if (store.userPosition) {
    return { lat: store.userPosition.lat, lon: store.userPosition.lon }
  }
  return mapRef.value?.getCenter() ?? null
}

// Verlässt man den Fragen-Bereich, ist eine unbestätigte Vorschau gegenstandslos.
watch(tab, (value) => {
  if (value !== 'questions') questions.clearPreview()
})

/** Das Karten-Icon einer Frage zeigt, worüber sie redet — um den eigenen Standort. */
function onPreviewQuestion(question: Question | null, radiusMeters: number | null) {
  if (!question) {
    questions.clearPreview()
    return
  }
  const origin = originForQuestion()
  if (!origin) return
  if (!questions.setPreview(question, origin, radiusMeters)) return

  sheetRef.value?.expand()
  mapRef.value?.focusPreview()
}

function onAnswerQuestion(question: Question, radiusMeters: number | null) {
  const origin = originForQuestion()
  if (!origin) return
  answerTarget.value = { question, origin, radiusMeters }
  // Der Knopf sitzt im aufgeklappten Sheet, und das liegt über allem anderen.
  sheetRef.value?.collapse()
}

/**
 * Nach dem Eintragen gehört der Blick auf das, was die Antwort verändert hat — das
 * geschrumpfte Suchgebiet. Beim Abbrechen bleibt man dagegen in der Fragenliste stehen.
 */
function onAnswerDone() {
  answerTarget.value = null
  tab.value = 'answers'
}
</script>

<template>
  <div class="app">
    <main class="stage">
      <GameMap ref="mapRef" />

      <button
        type="button"
        class="locate"
        :class="locate.tone"
        :title="locate.hint"
        :aria-label="locate.hint"
        @click="onLocate"
      >
        {{ locateLabel }}
      </button>

      <p v-if="store.loading" class="overlay">Lade Spieldaten…</p>
      <p v-else-if="store.error" class="overlay error">
        Spieldaten konnten nicht geladen werden: {{ store.error }}
      </p>
      <p v-else-if="geoNotice" class="overlay error">
        {{ geoNotice }}
        <button type="button" @click="dismissedGeoMessage = geoNotice">OK</button>
      </p>

      <p v-if="store.placingPosition" class="overlay hint">
        Tippe auf die Karte, wo du stehst
        <button type="button" @click="store.placingPosition = false">Abbrechen</button>
      </p>

      <!-- Orte-Menü links. Spiegelbild der Werkzeugleiste rechts: der Pfeil ist hier das
           erste Kind und bleibt deshalb am linken Rand stehen, während die Liste nach
           rechts weg wächst. -->
      <div
        v-if="poiCategories.length"
        class="poi-tools"
        :class="{ closed: !store.poiMenuOpen }"
      >
        <button
          type="button"
          class="fab toggle"
          :aria-expanded="store.poiMenuOpen"
          :aria-label="store.poiMenuOpen ? 'Orte-Menü einklappen' : 'Orte einblenden'"
          @click="store.poiMenuOpen = !store.poiMenuOpen"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.25 4.5 15.75 12l-7.5 7.5" />
          </svg>
        </button>

        <div class="poi-panel" role="group" aria-label="Orte einblenden">
          <button
            v-for="category in poiCategories"
            :key="category.id"
            type="button"
            class="poi-item"
            :class="{ on: store.activePoiCategories.has(category.id) }"
            :aria-pressed="store.activePoiCategories.has(category.id)"
            @click="store.togglePoiCategory(category.id)"
          >
            <svg class="poi-item-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path :d="category.glyph" />
            </svg>
            <span class="poi-item-label">{{ category.label }}</span>
            <span class="count">{{ category.count }}</span>
          </button>

          <!-- Steht immer da, auch ohne Auswahl: käme der Knopf erst mit dem ersten
               Häkchen dazu, würde die Liste unter dem Finger höher werden. -->
          <button
            type="button"
            class="poi-item clear"
            :disabled="!store.activePoiCategories.size"
            @click="store.clearPoiCategories()"
          >
            Alle ausblenden
          </button>
        </div>
      </div>

      <div class="tools" :class="{ closed: !store.toolsOpen }">
        <div class="fabs">
          <div v-if="pickerOpen" class="picker" role="radiogroup" aria-label="Kartentyp">
            <button
              v-for="basemap in store.basemaps"
              :key="basemap.id"
              type="button"
              class="picker-item"
              :class="{ on: basemap.id === store.activeBasemap?.id }"
              role="radio"
              :aria-checked="basemap.id === store.activeBasemap?.id"
              @click="chooseBasemap(basemap.id)"
            >
              {{ basemap.label }}
            </button>
          </div>

          <button
            type="button"
            class="fab"
            :aria-expanded="pickerOpen"
            @click="pickerOpen = !pickerOpen"
          >
            {{ store.activeBasemap?.label ?? 'Karte' }}
          </button>

          <button
            type="button"
            class="fab"
            :class="{ on: store.placingPosition || store.isManualPosition }"
            :aria-pressed="store.placingPosition"
            @click="store.placingPosition = !store.placingPosition"
          >
            Standort setzen
          </button>

        </div>

        <!-- Der Pfeil ist das letzte Kind der rechtsbündigen Zeile und bleibt deshalb
             in beiden Zuständen an derselben Stelle stehen. -->
        <button
          type="button"
          class="fab toggle"
          :aria-expanded="store.toolsOpen"
          :aria-label="store.toolsOpen ? 'Werkzeuge einklappen' : 'Werkzeuge ausklappen'"
          @click="toggleTools"
        >
          <!-- Gestrichener Winkel statt gefülltem Pfeil: er sitzt genau um (12,12) und
               bleibt deshalb beim Drehen an Ort und Stelle. -->
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.25 4.5 15.75 12l-7.5 7.5" />
          </svg>
        </button>
      </div>

      <AnswerQuestion
        v-if="answerTarget"
        :question="answerTarget.question"
        :origin="answerTarget.origin"
        :radius-meters="answerTarget.radiusMeters"
        @close="answerTarget = null"
        @saved="onAnswerDone"
      />

      <BottomSheet ref="sheetRef">
        <template #header>
          <div class="tabs">
            <button
              type="button"
              class="tab"
              :class="{ on: tab === 'answers' }"
              @click="tab = 'answers'"
            >
              Suchgebiet
              <span class="tab-count">{{ store.candidates.length }}</span>
            </button>
            <button
              type="button"
              class="tab"
              :class="{ on: tab === 'questions' }"
              @click="tab = 'questions'"
            >
              Fragen
              <span class="tab-count">{{ questions.usedCount }}/{{ questions.allQuestions.length }}</span>
            </button>
            <button
              type="button"
              class="tab"
              :class="{ on: tab === 'stations' }"
              @click="tab = 'stations'"
            >
              Halte
              <span class="tab-count">{{ store.listedStations.length }}</span>
            </button>
          </div>
        </template>

        <template v-if="tab === 'answers'">
          <AnswerList />
        </template>

        <template v-else-if="tab === 'stations'">
          <div class="filters">
            <button
              v-for="mode in modes"
              :key="mode"
              type="button"
              class="chip"
              :class="{ on: store.activeModes.has(mode) }"
              :aria-pressed="store.activeModes.has(mode)"
              :style="{ '--chip': store.config?.modes[mode]?.color }"
              @click="store.toggleMode(mode)"
            >
              {{ store.config?.modes[mode]?.label }}
              <span class="count">{{ store.modeCounts[mode] }}</span>
            </button>
          </div>

          <StationDetail v-if="store.selectedStation" @back="onBack" />
          <StationList v-else @select="onSelect" @select-poi="onSelectPoi" />
        </template>

        <template v-else>
          <QuestionList @preview="onPreviewQuestion" @answer="onAnswerQuestion" />
        </template>
      </BottomSheet>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

/* Schwebt über der Karte oben rechts; die Farbe trägt die Aussage des früheren
   Statusbalkens. Optik wie die Knöpfe unten rechts (.fab), damit die rechte Spalte
   eine Einheit bleibt. */
.locate {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  right: 12px;
  z-index: 550;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 2px 10px rgb(15 23 42 / 0.15);
  cursor: pointer;
}

.locate.ok {
  background: var(--ok);
  border-color: var(--ok);
  color: var(--on-accent);
}

.locate.bad {
  background: var(--bad);
  border-color: var(--bad);
  color: var(--on-accent);
}

.stage {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.overlay {
  position: absolute;
  /* Unter dem Ortungsknopf, sonst verdeckt die Einblendung ihn. */
  top: calc(60px + env(safe-area-inset-top));
  left: 16px;
  right: 16px;
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 2px 12px rgb(15 23 42 / 0.15);
  font-size: 14px;
  z-index: 550;
}

.overlay.error {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bad-soft);
  color: var(--bad);
}

.overlay.hint {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}

.overlay.error button,
.overlay.hint button {
  margin-left: auto;
  padding: 6px 10px;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

/* Rechtsbündige Zeile: links die Knöpfe, rechts der Pfeil. Weil der Container am rechten
   Rand hängt, wachsen die Knöpfe nach links weg — der Pfeil steht in beiden Zuständen an
   derselben Stelle. */
.tools {
  position: absolute;
  right: 12px;
  bottom: 124px;
  z-index: 550;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

/*
 * Die beiden Leisten liegen über der Karte, und `transform` verschiebt nur die
 * Darstellung, nicht das Layout: eingeklappt steht der Inhalt weiterhin in voller Grösse
 * im Container, nur woanders gezeichnet. Ein transparenter Container schluckt aber jeden
 * Touch — auf dem Handy wäre damit ein grosser Teil der Karte weder zu ziehen noch
 * anzutippen. Also nimmt der Container gar keine Ereignisse an; die Knöpfe holen sie sich
 * einzeln zurück.
 */
.tools,
.poi-tools {
  pointer-events: none;
}

.tools > *,
.poi-tools > * {
  pointer-events: auto;
}

/* Eingeklappt ist der Inhalt zwar unsichtbar, sein Kasten steht aber noch im Layout. */
.tools.closed .fabs,
.poi-tools.closed .poi-panel {
  pointer-events: none;
}

.fabs {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  /* Dieselbe Kurve wie beim Bottom Sheet, damit sich beides gleich anfühlt. */
  transition:
    transform 0.25s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.25s,
    visibility 0s;
}

/* Eigene Breite + Gap + Pfeil + Randabstand: die Knöpfe stehen komplett ausserhalb des
   Bildes, `.stage` schneidet sie ab. `visibility` erst am Ende der Fahrt, sonst sind sie
   eingeklappt noch klickbar und per Tastatur erreichbar. */
.tools.closed .fabs {
  transform: translateX(calc(100% + 60px));
  opacity: 0;
  visibility: hidden;
  transition:
    transform 0.25s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.25s,
    visibility 0s 0.25s;
}


/* Spiegelbild von .tools: am linken Rand verankert, Pfeil zuerst, Liste danach. */
.poi-tools {
  position: absolute;
  left: 12px;
  bottom: 124px;
  z-index: 550;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.poi-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 4px 16px rgb(15 23 42 / 0.22);
  /* Elf Kategorien sind höher als ein Handydisplay über dem Sheet hergibt. */
  max-height: calc(100dvh - 260px);
  overflow-y: auto;
  transition:
    transform 0.25s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.25s,
    visibility 0s;
}

/* Nach links aus dem Bild schieben; `.stage` schneidet ab. `visibility` erst am Ende
   der Fahrt, sonst bleibt die Liste eingeklappt anklickbar. */
.poi-tools.closed .poi-panel {
  transform: translateX(calc(-100% - 60px));
  opacity: 0;
  visibility: hidden;
  transition:
    transform 0.25s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.25s,
    visibility 0s 0.25s;
}

/* Der Pfeil zeigt nach aussen, also in die Richtung, in die das Menü verschwindet —
   spiegelbildlich zu dem rechts. */
.poi-tools .toggle svg {
  transform: rotate(180deg);
}

.poi-tools.closed .toggle svg {
  transform: rotate(0deg);
}

.poi-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 12px 0 8px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.poi-item.on {
  background: var(--accent);
  color: var(--on-accent);
}

.poi-item-icon {
  width: 18px;
  height: 18px;
  flex: none;
  fill: currentColor;
}

.poi-item-label {
  margin-right: auto;
}

/* Ohne eigenes Piktogramm: der Text rückt an die Stelle der anderen Beschriftungen. */
.poi-item.clear {
  padding-left: 34px;
  color: var(--text-muted);
  font-weight: 500;
}

/* Ohne Auswahl gibt es nichts auszublenden. Der Knopf bleibt stehen, damit die Liste
   ihre Höhe behält, nimmt sich aber sichtbar zurück. */
.poi-item.clear:disabled {
  opacity: 0.45;
  cursor: default;
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 4px 16px rgb(15 23 42 / 0.22);
}

.picker-item {
  min-height: 38px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  cursor: pointer;
}

.picker-item.on {
  background: var(--accent);
  color: var(--on-accent);
}

.fab {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 2px 10px rgb(15 23 42 / 0.15);
  cursor: pointer;
}

.fab.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.toggle {
  position: relative;
  /* Über den Knöpfen, damit sie beim Ein- und Ausfahren hinter dem Pfeil durchlaufen. */
  z-index: 1;
  width: 40px;
  padding: 0;
  display: grid;
  place-items: center;
}

/* Ein einziges Chevron, das sich dreht: nach rechts wegschieben, nach links herausholen.
   Als Strich gezeichnet — so lässt sich die Dicke unabhängig von der Grösse einstellen. */
.toggle svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  /* Im 24er-Raster auf 22 px: aus 3 Einheiten werden rund 2.75 px. */
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.25s;
}

.tools.closed .toggle svg {
  transform: rotate(180deg);
}

.tabs {
  display: flex;
  gap: 6px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.tab.on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.tab-count {
  font-size: 11px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.chip.on {
  border-color: var(--chip);
  color: var(--chip);
  background: color-mix(in srgb, var(--chip) 12%, transparent);
}

.count {
  font-size: 11px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

</style>
