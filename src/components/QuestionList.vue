<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuestionStore } from '../stores/questions'
import type { Question } from '../types/game'

const emit = defineEmits<{
  preview: [question: Question | null, radiusMeters: number | null]
  answer: [question: Question, radiusMeters: number | null]
}>()

const store = useQuestionStore()

// Alle Kategorien starten eingeklappt — 69 Fragen am Stück sind auf dem Handy
// nicht zu überblicken.
const collapsed = ref<Set<string>>(new Set(['matching', 'measuring', 'photos', 'tentacles']))

/**
 * Die eine Frage, deren Geometrie gerade auf der Karte liegt — aus dem Store gelesen,
 * nicht hier gehalten: die Vorschau verschwindet auch von aussen, etwa beim Wechsel in
 * den Haltestellen-Bereich. Ein eigener Merker bliebe dann fälschlich hell.
 */
const openId = computed(() => store.preview?.questionId ?? null)
const customRadius = ref(3000)

function toggleCategory(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

/**
 * Das Karten-Icon zeigt die Geometrie der Frage: den Umkreis, die Orte, den
 * nächstgelegenen davon. Ein zweiter Druck nimmt sie wieder weg. Immer nur eine —
 * beantwortet wird im Chat, hier bleibt nur das Häkchen.
 */
function onToggleMap(question: Question) {
  if (openId.value === question.id) {
    emit('preview', null, null)
    return
  }
  emit('preview', question, radiusFor(question))
}

/**
 * Der frei gewählte Radius gilt nur für die eine Radar-Karte, die keinen mitbringt.
 * Sonst hinge er auch an einer Matching-Karte, die gar keinen Umkreis kennt — und die
 * Karte zöge den Ausschnitt auf drei Kilometer statt auf den nächstgelegenen Ort.
 */
function radiusFor(question: Question): number | null {
  if (question.radiusMeters != null) return question.radiusMeters
  return question.viz === 'radius' ? customRadius.value : null
}

/** Beim frei gewählten Radius wächst der Kreis beim Tippen mit. */
function onCustomRadiusChange(question: Question) {
  if (openId.value !== question.id) return
  emit('preview', question, customRadius.value)
}

/**
 * Antworten lässt sich auf jede Karte — auch auf die, die auf der Karte nichts zeigt.
 * Die Photos-Karten schliessen zwar nichts aus, kosten den Verstecker aber Karten und
 * gehören deshalb ins Protokoll.
 */
function onAnswer(question: Question) {
  emit('answer', question, radiusFor(question))
}
</script>

<template>
  <div class="questions">
    <input
      v-model="store.search"
      class="search"
      type="search"
      inputmode="search"
      placeholder="Frage suchen…"
      aria-label="Frage suchen"
    />

    <p class="summary">
      {{ store.usedCount }} von {{ store.allQuestions.length }} genutzt ·
      {{ store.answers.length }} beantwortet
      <button v-if="store.usedCount" type="button" class="reset" @click="store.clearUsed()">
        Häkchen zurücksetzen
      </button>
    </p>

    <section v-for="category in store.filteredCategories" :key="category.id" class="category">
      <button type="button" class="cat-head" @click="toggleCategory(category.id)">
        <span class="chevron" :class="{ open: !collapsed.has(category.id) }">›</span>
        <span class="cat-name">{{ category.name }}</span>
        <span class="cat-meta">
          {{ category.questions.length }} · {{ category.timeLimitMin }} min ·
          {{ category.cards.draw }}/{{ category.cards.keep }}
        </span>
      </button>

      <p v-if="!collapsed.has(category.id)" class="prompt">{{ category.prompt }}</p>

      <ul v-if="!collapsed.has(category.id)" class="list">
        <li v-for="question in category.questions" :key="question.id">
          <div class="row" :class="{ used: store.usedIds.has(question.id) }">
            <button
              type="button"
              class="check"
              :aria-pressed="store.usedIds.has(question.id)"
              :aria-label="`${question.label} als genutzt markieren`"
              @click="store.toggleUsed(question.id)"
            >
              <span v-if="store.usedIds.has(question.id)">✓</span>
            </button>

            <span class="label">
              {{ question.label }}
            </span>

            <button
              type="button"
              class="send"
              :aria-label="`Antwort auf ${question.label} eintragen`"
              title="Antwort eintragen"
              @click="onAnswer(question)"
            >
              <!-- Häkchen im Kreis: eintragen heisst hier zugleich abhaken. -->
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.4-4.2-4.2 1.7-1.7 2.5 2.5 5.4-5.4 1.7 1.7-7.1 7.1z"
                />
              </svg>
            </button>

            <button
              v-if="question.viz !== 'none'"
              type="button"
              class="show"
              :class="{ on: openId === question.id }"
              :aria-pressed="openId === question.id"
              :aria-label="`${question.label} auf der Karte zeigen`"
              title="Auf der Karte zeigen"
              @click="onToggleMap(question)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M20.5 3l-.16.03L15 5.1 9 3 3.38 4.9c-.23.07-.38.26-.38.5V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.62-1.9c.23-.07.38-.26.38-.5V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"
                />
              </svg>
            </button>
            <span v-else class="no-viz" title="Nicht auf der Karte darstellbar">–</span>
          </div>

          <!-- Nur noch für die eine Radar-Karte ohne festen Radius und für die
               Begründung, warum eine Frage als schwach gilt. -->
          <div
            v-if="
              openId === question.id &&
              (question.weak || (question.viz === 'radius' && question.radiusMeters == null))
            "
            class="details"
          >
            <label v-if="question.radiusMeters == null && question.viz === 'radius'" class="custom">
              Radius
              <input
                v-model.number="customRadius"
                type="number"
                min="100"
                step="100"
                @input="onCustomRadiusChange(question)"
              />
              m
            </label>
            <p v-if="question.weak" class="weak-note">{{ question.weak }}</p>
          </div>
        </li>
      </ul>
    </section>

    <p v-if="!store.filteredCategories.length" class="empty">Keine Frage gefunden.</p>
  </div>
</template>

<style scoped>
.search {
  width: 100%;
  padding: 10px 12px;
  font-size: 16px; /* unter 16px zoomt iOS beim Fokus hinein */
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-sunken);
  color: inherit;
}

.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px;
  font-size: 12px;
  color: var(--text-muted);
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

.category {
  border-top: 1px solid var(--border);
}

.cat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 46px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.chevron {
  display: inline-block;
  width: 14px;
  color: var(--text-muted);
  transition: transform 0.15s;
}

.chevron.open {
  transform: rotate(90deg);
}

.cat-name {
  font-weight: 700;
  font-size: 15px;
}

.cat-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.prompt {
  margin: 0 0 6px 22px;
  font-size: 12px;
  font-style: italic;
  color: var(--text-muted);
}

.list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}

.row {
  /* Knopf und Platzhalter teilen sich diese Breite. Standen die Werte getrennt da,
     war der Platzhalter 4 px schmaler als der Knopf — und in jeder Zeile ohne
     Kartenknopf rutschte der Senden-Knopf daneben um genau diese 4 px nach rechts. */
  --row-action: 34px;

  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding-left: 22px;
}

.row.used .label {
  color: var(--text-muted);
  text-decoration: line-through;
}

.check {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1.5px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ok);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.row.used .check {
  border-color: var(--ok);
}

.label {
  flex: 1;
  min-width: 0;
  font-size: 14px;
}

.weak {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
}

/* Zwei gleich grosse Icon-Knöpfe statt Wörtern: in einer 44-px-Zeile ist neben dem
   Label kein Platz für zwei Beschriftungen, und nebeneinander lesen sich Papierflieger
   und Faltkarte schneller als „Karte". */
.send,
.show {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--row-action);
  height: var(--row-action);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}

.send svg,
.show svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
}

.show {
  border-color: var(--accent);
  color: var(--accent);
}

/* Liegt die Geometrie dieser Frage gerade auf der Karte, ist der Knopf gefüllt. */
.show.on {
  background: var(--accent);
  color: var(--on-accent);
}

/* Steht an der Stelle des Kartenknopfs und muss ihn deshalb genau ersetzen. */
.no-viz {
  flex: none;
  width: var(--row-action);
  text-align: center;
  color: var(--border-strong);
}

.details {
  margin: 0 0 10px 56px;
  padding: 10px;
  border-radius: 10px;
  background: var(--surface-sunken);
}

.custom {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.custom input {
  width: 90px;
  margin: 0 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: inherit;
  font: inherit;
  font-size: 14px;
}

.weak-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.empty {
  padding: 24px 4px;
  color: var(--text-muted);
  font-size: 14px;
}
</style>
