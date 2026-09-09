<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../stores/game'
import { useQuestionStore } from '../stores/questions'
import { distanceMeters, formatDistance } from '../lib/geo'
import { POI_GLYPHS, POI_FALLBACK_GLYPH } from '../lib/poiPin'
import ModeBadges from './ModeBadges.vue'
import type { Poi, StationWithDistance } from '../types/game'

const emit = defineEmits<{ select: [id: string]; selectPoi: [id: string] }>()
const store = useGameStore()
const questions = useQuestionStore()

/**
 * Wie viele Orte höchstens in der Trefferliste landen.
 *
 * „park" trifft über tausend Einträge. Sortiert wird nach Treffergüte und Entfernung,
 * die vorderen sind also die gemeinten — der Rest wäre eine Liste, durch die niemand
 * scrollt, und sie würde die Halte darunter begraben.
 */
const MAX_POI_HITS = 50

interface StationRow {
  kind: 'station'
  id: string
  name: string
  distance: number | null
  station: StationWithDistance
}

interface PoiRow {
  kind: 'poi'
  id: string
  name: string
  distance: number | null
  label: string
  glyph: string
}

/**
 * Halte und Orte in einer Liste.
 *
 * Ohne Suchbegriff bleibt es bei den Halten: sie tragen die Spielbedeutung (gültiges
 * Versteck, Ticketbereich), und zweitausend Orte darüber wären keine Liste mehr,
 * sondern ein Datenauszug. Sobald gesucht wird, mischen sich die Orte darunter —
 * dann sucht man ja etwas Bestimmtes und nicht die Übersicht.
 *
 * Die Kategorie-Häkchen des Orte-Menüs zählen hier absichtlich nicht: sie sagen, was
 * auf der Karte liegt. Wer den Namen eintippt, will ihn finden, nicht erst die passende
 * Kategorie einschalten müssen.
 */
const rows = computed<(StationRow | PoiRow)[]>(() => {
  const q = store.search.trim().toLowerCase()

  const stationRows: StationRow[] = store.listedStations.map((station) => ({
    kind: 'station',
    id: station.id,
    name: station.name,
    distance: station.distance,
    station,
  }))

  if (!q) return stationRows

  const position = store.userPosition
  const labels = new Map(questions.poiCategories.map((c) => [c.id, c.label]))

  const poiRows: PoiRow[] = questions.pois
    .filter((poi: Poi) => poi.name.toLowerCase().includes(q))
    .map((poi: Poi) => ({
      kind: 'poi' as const,
      id: poi.id,
      name: poi.name,
      distance: position ? distanceMeters(position, poi) : null,
      label: labels.get(poi.category) ?? poi.category,
      glyph: POI_GLYPHS[poi.category] ?? POI_FALLBACK_GLYPH,
    }))

  // Dieselbe Ordnung wie bei den Halten: wer „Vondelpark" tippt, meint den Vondelpark
  // und nicht das Vondelparkpaviljoen, auch wenn das näher liegt.
  const rank = (name: string) => (name.toLowerCase() === q ? 0 : name.toLowerCase().startsWith(q) ? 1 : 2)
  const order = (a: StationRow | PoiRow, b: StationRow | PoiRow) => {
    const byRank = rank(a.name) - rank(b.name)
    if (byRank !== 0) return byRank
    if (a.distance === null || b.distance === null) return a.name.localeCompare(b.name, 'nl')
    return a.distance - b.distance
  }

  return [...stationRows, ...poiRows.sort(order).slice(0, MAX_POI_HITS)].sort(order)
})

const poiHits = computed(() => rows.value.filter((row) => row.kind === 'poi').length)
</script>

<template>
  <div>
    <input
      v-model="store.search"
      class="search"
      type="search"
      inputmode="search"
      placeholder="Haltestelle oder Ort suchen…"
      aria-label="Haltestelle oder Ort suchen"
    />

    <p v-if="!rows.length" class="empty">
      Nichts gefunden. Suchbegriff oder Filter anpassen.
    </p>

    <ul class="list">
      <li v-for="row in rows" :key="row.kind + ':' + row.id">
        <button
          v-if="row.kind === 'station'"
          type="button"
          class="row"
          :class="{ active: row.id === store.selectedId }"
          @click="emit('select', row.id)"
        >
          <span class="info">
            <span class="name">{{ row.name }}</span>
            <ModeBadges :station="row.station" />
          </span>
          <span class="distance" :class="{ near: row.station.withinHidingRadius }">
            {{ formatDistance(row.distance) }}
          </span>
        </button>

        <button
          v-else
          type="button"
          class="row"
          :class="{ active: row.id === questions.selectedPoiId }"
          @click="emit('selectPoi', row.id)"
        >
          <!-- Dasselbe Piktogramm wie der Marker auf der Karte und der Schalter im
               Orte-Menü: die Zeile ist damit ohne Beschriftung als Ort zu erkennen. -->
          <svg class="poi-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="row.glyph" />
          </svg>
          <span class="info">
            <span class="name">{{ row.name }}</span>
            <span class="badges">
              <span class="badge">{{ row.label }}</span>
            </span>
          </span>
          <span class="distance">
            {{ formatDistance(row.distance) }}
          </span>
        </button>
      </li>
    </ul>

    <p v-if="poiHits >= MAX_POI_HITS" class="empty">
      Nur die {{ MAX_POI_HITS }} besten Treffer unter den Orten — genauer suchen zeigt den
      gemeinten.
    </p>
  </div>
</template>

<style scoped>
.search {
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 8px;
  font-size: 16px; /* unter 16px zoomt iOS beim Fokus in das Feld hinein */
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-sunken);
  color: inherit;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 8px 4px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: none;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.row.active {
  background: var(--accent-soft);
}

.poi-icon {
  flex: none;
  width: 20px;
  height: 20px;
  fill: var(--text-muted);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.name {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Wie die Verkehrsmittel-Badges, nur in der neutralen Farbe: die Kategorie ordnet ein,
   sie ist keine Aussage über das Spiel. */
.badges {
  display: inline-flex;
  gap: 4px;
}

.badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.distance {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  color: var(--text-muted);
}

.distance.near {
  color: var(--ok);
  font-weight: 700;
}

.empty {
  padding: 24px 4px;
  color: var(--text-muted);
  font-size: 14px;
}
</style>
