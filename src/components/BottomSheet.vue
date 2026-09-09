<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { SHEET_HALF_RATIO } from '../lib/layout'

/**
 * Bottom Sheet mit drei Rastpunkten.
 *
 * Gezogen wird nur am Griff und an der Kopfzeile — läge der Ziehbereich über dem
 * ganzen Sheet, wäre die Liste darin nicht mehr scrollbar.
 */
const PEEK_HEIGHT = 108

const sheet = ref<HTMLElement | null>(null)
const offset = ref(0)
const dragging = ref(false)
const snapIndex = ref(0)

let startPointerY = 0
let startOffset = 0
/** Beim Drücken gemerkt: nach `setPointerCapture` zeigt `event.target` nur noch auf die
    Kopfzeile, das ursprüngliche Ziel wäre bei `pointerup` also nicht mehr zu erkennen. */
let startTarget: HTMLElement | null = null
let moved = false

/** Verschiebung in px, von unten gemessen: gross = eingeklappt, 0 = ganz offen. */
function snapPoints(): number[] {
  const height = sheet.value?.offsetHeight ?? 0
  return [
    height - PEEK_HEIGHT,
    Math.max(0, height - window.innerHeight * SHEET_HALF_RATIO),
    0,
  ]
}

function applySnap(index: number) {
  const points = snapPoints()
  snapIndex.value = Math.min(Math.max(index, 0), points.length - 1)
  offset.value = points[snapIndex.value]
}

function onPointerDown(event: PointerEvent) {
  dragging.value = true
  startPointerY = event.clientY
  startOffset = offset.value
  startTarget = event.target as HTMLElement
  moved = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const points = snapPoints()
  const next = startOffset + (event.clientY - startPointerY)
  // Kleine Schwelle: ein Wackeln beim Tippen darf nicht schon als Ziehen zählen.
  if (Math.abs(event.clientY - startPointerY) > 6) moved = true
  offset.value = Math.min(Math.max(next, 0), points[0])
}

function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false

  // Getippt statt gezogen, und nicht auf Griff oder Tabs: die leere Fläche der Kopfzeile.
  if (!moved && !startTarget?.closest('button')) {
    toggleFull()
    return
  }

  const points = snapPoints()
  // Zum nächstgelegenen Rastpunkt einschnappen.
  let nearest = 0
  points.forEach((point, i) => {
    if (Math.abs(point - offset.value) < Math.abs(points[nearest] - offset.value)) nearest = i
  })
  applySnap(nearest)
}

/**
 * Tippen auf die leere Fläche der Kopfzeile: ganz auf, und vom ganz offenen Sheet aus
 * wieder ganz zu. Der Zwischenschritt „halb" bleibt dem Griff und dem Ziehen vorbehalten.
 */
function toggleFull() {
  applySnap(snapIndex.value === snapPoints().length - 1 ? 0 : snapPoints().length - 1)
}

/** Tippen auf den Griff schaltet durch die Rastpunkte — schneller als ziehen. */
function cycle() {
  if (dragging.value) return
  applySnap((snapIndex.value + 1) % snapPoints().length)
}

function onResize() {
  applySnap(snapIndex.value)
}

onMounted(() => {
  applySnap(0)
  window.addEventListener('resize', onResize)
})

onUnmounted(() => window.removeEventListener('resize', onResize))

defineExpose({ expand: () => applySnap(1), collapse: () => applySnap(0) })

/**
 * Das Padding hält den Scroll-Viewport von `.body` deckungsgleich mit dem sichtbaren
 * Teil des Sheets — ohne es reicht die Liste unter den Bildschirmrand und ihr Ende
 * bleibt unerreichbar. Dank `box-sizing: border-box` bleibt `offsetHeight` konstant,
 * die Rastpunkte rechnen also unverändert.
 */
const style = computed(() => ({
  transform: `translateY(${offset.value}px)`,
  paddingBottom: `${offset.value}px`,
  transition: dragging.value ? 'none' : 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
}))
</script>

<template>
  <section ref="sheet" class="sheet" :style="style">
    <header
      class="grab"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <button class="handle" type="button" aria-label="Liste auf- oder zuklappen" @click="cycle" />
      <div class="head"><slot name="header" /></div>
    </header>
    <div class="body"><slot /></div>
  </section>
</template>

<style scoped>
.sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 86dvh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -2px 24px rgb(15 23 42 / 0.18);
  z-index: 700;
  touch-action: none;
}

.grab {
  flex: none;
  padding: 6px 16px 10px;
  cursor: grab;
}

.handle {
  display: block;
  position: relative;
  width: 44px;
  height: 5px;
  margin: 0 auto 8px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--border-strong);
}

/* Vergrössert die Trefferfläche des Griffs, ohne den Strich selbst dicker zu machen.
   Die Fläche hängt am Griff selbst — wäre sie am Sheet verankert, spannte sie sich über
   dessen ganze obere Kante und schluckte die Taps auf die Tabs in der Kopfzeile. Nach
   unten reicht sie deshalb nur bis zur Kopfzeile, nach oben nur bis zur Sheet-Kante. */
.handle::before {
  content: '';
  position: absolute;
  left: -28px;
  right: -28px;
  top: -6px;
  bottom: -8px;
}

.head {
  min-height: 34px;
}

.body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  padding: 0 16px calc(16px + env(safe-area-inset-bottom));
}
</style>
