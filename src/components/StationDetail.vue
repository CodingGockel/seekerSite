<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../stores/game'
import { formatDistance } from '../lib/geo'
import ModeBadges from './ModeBadges.vue'
import type { TransportMode } from '../types/game'

const emit = defineEmits<{ back: [] }>()
const store = useGameStore()

const station = computed(() => store.selectedStation)

const MODE_ORDER: TransportMode[] = ['train', 'metro', 'tram', 'ferry', 'bus']

/**
 * Was hier hält, nach Verkehrsmittel gruppiert — „Tram 12, 25". Das Verkehrsmittel
 * des Halts steht oben, danach der Rest in fester Reihenfolge.
 */
const servedBy = computed(() => {
  const s = station.value
  if (!s) return []
  const order = [s.mode, ...MODE_ORDER.filter((m) => m !== s.mode)]
  return order.filter((mode) => s.lines[mode]?.length).map((mode) => ({
    mode,
    label: store.config?.modes[mode]?.label ?? mode,
    color: store.config?.modes[mode]?.color ?? '#475569',
    lines: s.lines[mode]!.join(', '),
  }))
})

const mapsUrl = computed(() =>
  station.value
    ? `https://www.google.com/maps/search/?api=1&query=${station.value.lat},${station.value.lon}`
    : '#',
)

/**
 * Wie weit die Sucher von der Versteck-Zone dieses Halts entfernt sind.
 *
 * In der Zone zu stehen heisst: der Verstecker wäre, wenn er hier sitzt, in Sichtweite —
 * ab hier wird gesucht statt gefahren.
 */
const verdict = computed(() => {
  const s = station.value
  if (!s) return null
  if (s.distance === null) return { tone: 'muted', text: 'Standort unbekannt — Ortung einschalten.' }
  if (s.withinHidingRadius) {
    return {
      tone: 'ok',
      text: `Ihr seid in der Zone — ${formatDistance(s.distance)} bis zum Halt.`,
    }
  }
  const missing = s.distance - store.hidingRadius
  return {
    tone: 'muted',
    text: `${formatDistance(missing)} bis zum Rand der Zone.`,
  }
})
</script>

<template>
  <div v-if="station" class="detail">
    <button type="button" class="back" @click="emit('back')">← Alle Haltestellen</button>

    <h2 class="name">{{ station.name }}</h2>
    <ModeBadges :station="station" />

    <p class="verdict" :class="verdict?.tone">{{ verdict?.text }}</p>

    <p v-if="station.extraCost" class="warn">
      Ausserhalb des Amsterdam &amp; Region Travel Ticket — die Fahrt dorthin kostet Aufpreis.
    </p>

    <dl class="facts">
      <div>
        <dt>Entfernung</dt>
        <dd>{{ formatDistance(station.distance) }}</dd>
      </div>
      <div>
        <dt>Versteck-Radius</dt>
        <dd>{{ store.hidingRadius }} m</dd>
      </div>
      <div v-if="station.aliases.length">
        <dt>Auch bekannt als</dt>
        <dd>{{ station.aliases.join(', ') }}</dd>
      </div>
    </dl>

    <ul v-if="servedBy.length" class="lines">
      <li v-for="row in servedBy" :key="row.mode">
        <span class="line-mode" :style="{ '--badge': row.color }">{{ row.label }}</span>
        <span class="line-list">{{ row.lines }}</span>
      </li>
    </ul>

    <p v-if="station.notes" class="note">{{ station.notes }}</p>

    <a class="link" :href="mapsUrl" target="_blank" rel="noopener">In Karten öffnen ↗</a>
  </div>
</template>

<style scoped>
.detail {
  padding-bottom: 8px;
}

.back {
  padding: 8px 0;
  margin-bottom: 4px;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.name {
  margin: 0 0 8px;
  font-size: 20px;
  line-height: 1.2;
}

.verdict {
  margin: 14px 0;
  padding: 12px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
}

.verdict.ok {
  background: var(--ok-soft);
  color: var(--ok);
}

.verdict.bad {
  background: var(--bad-soft);
  color: var(--bad);
}

.verdict.muted {
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-weight: 500;
}

.warn {
  margin: 14px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, #b45309 14%, transparent);
  color: #b45309;
  font-size: 13px;
  line-height: 1.4;
}

.lines {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: grid;
  gap: 8px;
}

.lines li {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.line-mode {
  flex: none;
  min-width: 52px;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 6px;
  border-radius: 4px;
  text-align: center;
  color: var(--badge);
  background: color-mix(in srgb, var(--badge) 14%, transparent);
}

.line-list {
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-muted);
}

.facts {
  margin: 0 0 14px;
  display: grid;
  gap: 2px;
}

.facts > div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}

dt {
  color: var(--text-muted);
  font-size: 14px;
}

dd {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-align: right;
}

.note {
  margin: 10px 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-muted);
}

.link {
  display: inline-block;
  padding: 10px 0;
  color: var(--accent);
  font-size: 15px;
  font-weight: 600;
}
</style>
