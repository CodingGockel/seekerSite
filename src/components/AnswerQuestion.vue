<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGameStore } from '../stores/game'
import { useQuestionStore } from '../stores/questions'
import { ANSWER_OUT_OF_RANGE, ANSWER_UNKNOWN } from '../lib/eliminate'
import { destinationFrom, distanceMeters, formatBearing, formatDistance } from '../lib/geo'
import type { AnsweredQuestion, LatLon, Question } from '../types/game'

const props = defineProps<{
  question: Question
  origin: LatLon
  radiusMeters: number | null
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const game = useGameStore()
const questions = useQuestionStore()

const category = computed(() => questions.categoryOfQuestion.get(props.question.id) ?? null)

/**
 * Die Richtung, in die die Sucher „fahren" — nur beim Thermometer.
 *
 * Gefahren wird dabei nicht wirklich: gewählt wird eine Richtung, und der Zielpunkt
 * liegt die Kartendistanz davon entfernt. Was die Antwort trennt, ist die
 * Mittelsenkrechte zwischen Standort und Zielpunkt — sie liegt auf der halben Strecke.
 * Deshalb schneidet die *kürzeste* Karte am schärfsten.
 */
const bearing = ref(270)
const BEARINGS = Array.from({ length: 16 }, (_, i) => i * 22.5)

const destination = computed(() =>
  props.question.viz === 'thermometer' && props.radiusMeters
    ? destinationFrom(props.origin, props.radiusMeters, bearing.value)
    : null,
)

/** Die Orte im Tentacles-Kreis — sie sind die möglichen Antworten. */
const tentacleOptions = computed(() => {
  if (props.question.viz !== 'poi-within' || !props.radiusMeters) return []
  const pois =
    props.question.poiCategory === 'station'
      ? game.railStations.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon }))
      : (questions.poisByCategory.get(props.question.poiCategory ?? '') ?? [])
  return pois
    .map((poi) => ({ poi, distance: distanceMeters(props.origin, poi) }))
    .filter((row) => row.distance <= props.radiusMeters!)
    .sort((a, b) => a.distance - b.distance)
})

/**
 * Die Antwortmöglichkeiten der Kategorie, als Wert und deutsche Beschriftung.
 *
 * `QuestionCategory.answers` steht zwar in den Daten, aber als englische Etiketten
 * („closer", „location name"). Gebraucht wird beides getrennt: der Wert geht in die
 * Auswertung, die Beschriftung auf den Knopf.
 */
const options = computed<{ value: string; label: string }[]>(() => {
  switch (category.value?.id) {
    case 'radar':
      return [
        { value: 'yes', label: 'Ja' },
        { value: 'no', label: 'Nein' },
      ]
    case 'thermometer':
      return [
        { value: 'hotter', label: 'Wärmer' },
        { value: 'colder', label: 'Kälter' },
      ]
    case 'matching':
      return [
        { value: 'yes', label: 'Ja' },
        { value: 'no', label: 'Nein' },
      ]
    case 'measuring':
      return [
        { value: 'closer', label: 'Näher' },
        { value: 'further', label: 'Weiter weg' },
      ]
    case 'tentacles':
      return [
        ...tentacleOptions.value.map((row) => ({
          value: row.poi.id,
          label: `${row.poi.name} · ${formatDistance(row.distance)}`,
        })),
        { value: ANSWER_OUT_OF_RANGE, label: 'Ausser Reichweite' },
      ]
    default:
      // Photos und die Karten ohne Daten: die Antwort wird protokolliert, ausgewertet
      // wird sie nicht — was sie aussagt, weiss nur der Kopf der Sucher.
      return [{ value: ANSWER_UNKNOWN, label: 'Beantwortet — abhaken' }]
  }
})

/**
 * Die Trennlinie auf der Karte mitführen, solange der Dialog offen ist.
 *
 * Beim Thermometer ist die Richtung die eigentliche Entscheidung — und man trifft sie
 * nicht an Kompasspunkten, sondern daran, wie die Linie durch das Restgebiet läuft.
 */
watch(
  bearing,
  (value) => {
    if (props.question.viz !== 'thermometer') return
    questions.setPreview(props.question, props.origin, props.radiusMeters, value)
  },
  { immediate: true },
)

onMounted(() => {
  if (props.question.viz === 'thermometer') return
  questions.setPreview(props.question, props.origin, props.radiusMeters)
})

// Die Vorschau gehört zum Dialog; wer ihn schliesst, will die Linie nicht behalten.
onUnmounted(() => questions.clearPreview())

function draftFor(answer: string): Omit<AnsweredQuestion, 'id' | 'askedAt'> {
  return {
    questionId: props.question.id,
    categoryId: category.value?.id ?? '',
    label: props.question.label,
    viz: props.question.viz,
    origin: props.origin,
    destination: destination.value,
    bearing: props.question.viz === 'thermometer' ? bearing.value : null,
    radiusMeters: props.radiusMeters,
    poiCategory: props.question.poiCategory ?? null,
    divisionLevel: props.question.divisionLevel ?? null,
    borderId: props.question.borderId ?? null,
    answer,
  }
}

/** Was jede Antwort übrig liesse — die Zahl steht auf dem Knopf, vor dem Eintragen. */
const outcomes = computed(() =>
  options.value.map((option) => ({
    ...option,
    count: game.candidatesIf({ ...draftFor(option.value), id: '', askedAt: 0 }),
  })),
)

function choose(answer: string) {
  questions.addAnswer(draftFor(answer))
  emit('saved')
}
</script>

<template>
  <div class="answer" role="dialog" aria-label="Antwort eintragen">
    <div class="head">
      <strong>{{ question.label }}</strong>
      <button type="button" class="close" aria-label="Schliessen" @click="emit('close')">×</button>
    </div>

    <p v-if="category" class="prompt">{{ category.prompt.replace('{X}', question.label) }}</p>

    <p class="origin">
      Gefragt von {{ origin.lat.toFixed(5) }}, {{ origin.lon.toFixed(5) }}
      <span v-if="!game.userPosition"> · Kartenmitte, keine Ortung</span>
      <span v-else-if="game.isManualPosition"> · gesetzter Standort</span>
    </p>

    <!-- Thermometer: die Richtung ist frei wählbar, und genau darin liegt die Stärke
         der Karte — die Trennlinie lässt sich damit beliebig drehen. -->
    <div v-if="question.viz === 'thermometer'" class="bearing">
      <p class="bearing-head">
        Richtung <strong>{{ formatBearing(bearing) }}</strong>
        <span class="hint">Trennlinie {{ formatDistance((radiusMeters ?? 0) / 2) }} vor euch</span>
      </p>
      <div class="dial" role="radiogroup" aria-label="Fahrtrichtung">
        <button
          v-for="deg in BEARINGS"
          :key="deg"
          type="button"
          class="dir"
          :class="{ on: bearing === deg }"
          role="radio"
          :aria-checked="bearing === deg"
          @click="bearing = deg"
        >
          {{ formatBearing(deg) }}
        </button>
      </div>
    </div>

    <p v-if="question.weak" class="weak">{{ question.weak }}</p>

    <div class="options" :class="{ many: outcomes.length > 3 }">
      <button
        v-for="option in outcomes"
        :key="option.value"
        type="button"
        class="option"
        @click="choose(option.value)"
      >
        <span class="option-label">{{ option.label }}</span>
        <span class="option-count">{{ option.count }}</span>
      </button>
    </div>

    <p class="foot">
      Die Zahl rechts ist, was von den {{ game.candidates.length }} möglichen Verstecken
      danach übrig bleibt.
    </p>
  </div>
</template>

<style scoped>
/* Über dem eingeklappten Sheet, in der Daumenzone — dort wird im fahrenden Zug getippt. */
.answer {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 120px;
  z-index: 560;
  max-height: calc(100dvh - 200px);
  overflow-y: auto;
  padding: 12px 14px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 6px 24px rgb(15 23 42 / 0.28);
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.close {
  margin-left: auto;
  width: 32px;
  height: 32px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.prompt {
  margin: 2px 0 0;
  font-size: 12px;
  font-style: italic;
  color: var(--text-muted);
}

.origin {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.bearing {
  margin-top: 10px;
}

.bearing-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.hint {
  margin-left: auto;
  font-size: 11px;
}

/* Vier Spalten, 16 Kompasspunkte: eine Rose wäre hübscher, aber auf dem Handy sind
   quadratische Ziele die einzigen, die man im fahrenden Zug trifft. */
.dial {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.dir {
  min-height: 34px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-sunken);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.dir.on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.weak {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}

.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 10px;
}

/* Tentacles bringt so viele Antworten mit, wie Orte im Kreis liegen — die gehören
   untereinander, mit dem Namen als Zeile. */
.options.many {
  grid-template-columns: 1fr;
  max-height: 40dvh;
  overflow-y: auto;
}

.option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-sunken);
  color: inherit;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-count {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.foot {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
