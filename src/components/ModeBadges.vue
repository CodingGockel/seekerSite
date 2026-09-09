<script setup lang="ts">
import { useGameStore } from '../stores/game'
import type { Station } from '../types/game'

/**
 * Das Verkehrsmittel, wegen dem der Halt in der Liste steht — und, falls
 * zutreffend, der Hinweis auf den Aufpreis. Welche Linien sonst noch halten,
 * steht im Detail; in der Liste wären vier Badges pro Zeile nur Rauschen.
 */
defineProps<{ station: Station }>()
const store = useGameStore()
</script>

<template>
  <span class="badges">
    <span class="badge" :style="{ '--badge': store.config?.modes[station.mode]?.color ?? '#475569' }">
      {{ store.config?.modes[station.mode]?.label ?? station.mode }}
    </span>
    <span v-if="station.extraCost" class="badge is-extra">Aufpreis</span>
  </span>
</template>

<style scoped>
.badges {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}

.badge {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  color: var(--badge);
  background: color-mix(in srgb, var(--badge) 14%, transparent);
}

.badge.is-extra {
  --badge: #b45309;
}
</style>
