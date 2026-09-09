<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../stores/game'
import { useQuestionStore } from '../stores/questions'
import { ANSWER_OUT_OF_RANGE, ANSWER_UNKNOWN } from '../lib/eliminate'
import { formatBearing, formatDistance } from '../lib/geo'
import type { AnsweredQuestion } from '../types/game'

const game = useGameStore()
const questions = useQuestionStore()

const ANSWER_LABELS: Record<string, string> = {
  yes: 'ja',
  no: 'nein',
  closer: 'näher',
  further: 'weiter weg',
  hotter: 'wärmer',
  colder: 'kälter',
  [ANSWER_OUT_OF_RANGE]: 'ausser Reichweite',
  [ANSWER_UNKNOWN]: 'beantwortet',
}

/** Bei Tentacles ist die Antwort eine Orts-ID — auf der Zeile soll der Name stehen. */
function answerLabel(entry: AnsweredQuestion): string {
  const known = ANSWER_LABELS[entry.answer]
  if (known) return known
  const poi = questions.pois.find((p) => p.id === entry.answer)
  if (poi) return poi.name
  return game.stations.find((s) => s.id === entry.answer)?.name ?? entry.answer
}

/** Der Zusatz, der aus einer Karte erst eine bestimmte Frage macht. */
function detail(entry: AnsweredQuestion): string | null {
  if (entry.viz === 'thermometer' && entry.bearing != null) {
    return `Richtung ${formatBearing(entry.bearing)}`
  }
  if (entry.viz === 'radius' && entry.radiusMeters) return formatDistance(entry.radiusMeters)
  return null
}

/**
 * Antworten, die nichts ausschliessen, sind trotzdem in der Liste — sie kosten den
 * Verstecker Karten und gehören ins Protokoll. Aber sie werden als solche gekennzeichnet,
 * sonst sucht man den Fehler in der Zahl darüber.
 */
function isInert(entry: AnsweredQuestion): boolean {
  return entry.answer === ANSWER_UNKNOWN || entry.viz === 'none'
}

const remaining = computed(() => game.candidates.length)
const total = computed(() => game.playable.length)
</script>

<template>
  <div class="answers">
    <p class="summary">
      <strong>{{ remaining }}</strong>
      <span>von {{ total }} Verstecken möglich</span>
      <button
        v-if="questions.answers.length"
        type="button"
        class="reset"
        @click="questions.clearAnswers()"
      >
        neue Runde
      </button>
    </p>

    <p v-if="!questions.answers.length" class="empty">
      Noch keine Antwort eingetragen. Im Reiter „Fragen" auf das Häkchen-Symbol einer Karte
      tippen, sobald der Verstecker geantwortet hat — das Suchgebiet schrumpft dann mit.
    </p>

    <ol v-else class="list">
      <li v-for="(entry, index) in questions.answers" :key="entry.id" class="row">
        <span class="index">{{ index + 1 }}</span>
        <span class="body">
          <span class="label">
            {{ entry.label }}
            <span v-if="detail(entry)" class="detail">{{ detail(entry) }}</span>
          </span>
          <span class="answer" :class="{ inert: isInert(entry) }">
            {{ answerLabel(entry) }}
            <span v-if="isInert(entry)" class="inert-note">· schliesst nichts aus</span>
          </span>
        </span>
        <button
          type="button"
          class="remove"
          :aria-label="`Antwort zu ${entry.label} entfernen`"
          @click="questions.removeAnswer(entry.id)"
        >
          ×
        </button>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.summary {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.summary strong {
  font-size: 20px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.reset {
  margin-left: auto;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.empty {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  border-top: 1px solid var(--border);
}

.index {
  flex: none;
  width: 18px;
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail {
  margin-left: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
}

.answer {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}

.answer.inert {
  color: var(--text-muted);
  font-weight: 500;
}

.inert-note {
  font-weight: 400;
}

.remove {
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
</style>
