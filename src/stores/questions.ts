import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  AnsweredQuestion,
  BorderSegment,
  BordersFile,
  DivisionArea,
  DivisionsFile,
  LatLon,
  MapPreview,
  Poi,
  PoiFile,
  Question,
  QuestionCategory,
  QuestionsFile,
} from '../types/game'

const BASE = import.meta.env.BASE_URL
const USED_KEY = 'hs.usedQuestions.v1'

/**
 * Die beantworteten Fragen — der eigentliche Spielstand der Sucher.
 *
 * Bis V4 gab es dasselbe schon einmal unter `hs.constraints.v1` und es wurde verworfen,
 * weil eine Verstecker-App die Antworten gar nicht kennt (SPEC §V2). Für die Sucher
 * dreht sich das um: sie stellen die Fragen und kennen jede Antwort.
 */
const ANSWERS_KEY = 'hs.answers.v1'

function loadJson<T>(file: string): Promise<T> {
  return fetch(`${BASE}data/${file}`).then((res) => {
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
    return res.json()
  })
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    // Privater Modus oder blockierter Storage.
    return fallback
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Nicht verfügbar — gilt dann nur für diese Sitzung.
  }
}

export const useQuestionStore = defineStore('questions', () => {
  const categories = ref<QuestionCategory[]>([])
  const pois = ref<Poi[]>([])
  const poiCategories = ref<{ id: string; label: string }[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)

  const usedIds = ref<Set<string>>(new Set(readStored<string[]>(USED_KEY, [])))
  const search = ref('')

  /**
   * Die beantworteten Fragen, in der Reihenfolge, in der sie gestellt wurden.
   *
   * Eine Liste und keine Map: dieselbe Karte darf zweimal gestellt werden (Hausregel,
   * der Verstecker zieht dann doppelt Karten), und die Reihenfolge ist beim Nachvollziehen
   * die halbe Information.
   */
  const answers = ref<AnsweredQuestion[]>(readStored<AnsweredQuestion[]>(ANSWERS_KEY, []))

  /**
   * Geometriedateien, die erst geladen werden, wenn eine Frage sie braucht:
   * die vier Verwaltungsebenen und die Landesgrenze.
   *
   * Zusammen wiegen sie mehr als alle übrigen Laufzeitdaten, die Buurt-Ebene allein
   * über ein Megabyte. Die meisten Runden fragen keine einzige dieser Karten; beim
   * Start mitzuladen hiesse, das im Zug für nichts zu bezahlen.
   */
  const mapData = ref(new Map<string, unknown>())
  /** Zählt hoch, sobald eine Datei da ist — daran hängt das Neuzeichnen der Karte. */
  const mapDataVersion = ref(0)
  const pendingMapData = new Map<string, Promise<void>>()

  /**
   * Die Geometrie der Frage, über die gerade geredet wird. Höchstens eine, nie
   * gespeichert: sie zeigt, worüber die Frage redet, und verschwindet wieder.
   */
  const preview = ref<MapPreview | null>(null)


  watch(usedIds, () => writeStored(USED_KEY, [...usedIds.value]), { deep: true })
  watch(answers, () => writeStored(ANSWERS_KEY, answers.value), { deep: true })

  const allQuestions = computed(() => categories.value.flatMap((c) => c.questions))

  const questionById = computed(() => new Map(allQuestions.value.map((q) => [q.id, q])))

  const categoryOfQuestion = computed(() => {
    const map = new Map<string, QuestionCategory>()
    for (const category of categories.value) {
      for (const question of category.questions) map.set(question.id, category)
    }
    return map
  })

  /** Kategorien mit auf den Suchbegriff gefilterten Fragen; leere fallen raus. */
  const filteredCategories = computed(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return categories.value
    return categories.value
      .map((category) => ({
        ...category,
        questions: category.questions.filter(
          (question) =>
            question.label.toLowerCase().includes(q) ||
            category.name.toLowerCase().includes(q),
        ),
      }))
      .filter((category) => category.questions.length > 0)
  })

  /**
   * Der Ort, den die Suche zuletzt gewählt hat.
   *
   * Er wird auf der Karte hervorgehoben, auch wenn seine Kategorie im Orte-Menü
   * ausgeblendet ist — sonst sucht man etwas und sieht danach nichts.
   */
  const selectedPoiId = ref<string | null>(null)

  const selectedPoi = computed(
    () => pois.value.find((poi) => poi.id === selectedPoiId.value) ?? null,
  )

  function selectPoi(id: string | null) {
    selectedPoiId.value = id
  }

  const poisByCategory = computed(() => {
    const map = new Map<string, Poi[]>()
    for (const poi of pois.value) {
      const list = map.get(poi.category)
      if (list) list.push(poi)
      else map.set(poi.category, [poi])
    }
    return map
  })

  /**
   * Eine Geometriedatei laden, genau einmal.
   *
   * Parallele Aufrufe teilen sich dasselbe Promise: die Vorschau stösst das Laden an,
   * und ein zweiter Tipp auf dieselbe Karte darf es nicht ein zweites Mal auslösen.
   * Ein Fehler wird geschluckt und der Versuch freigegeben — die Karte zeigt dann den
   * Fragepunkt ohne Geometrie, und beim nächsten Öffnen wird es erneut versucht.
   */
  function ensureMapData(file: string | null | undefined): void {
    if (!file || mapData.value.has(file) || pendingMapData.has(file)) return

    const request = loadJson<unknown>(file)
      .then((content) => {
        mapData.value.set(file, content)
        mapDataVersion.value++
      })
      .catch(() => {})
      .finally(() => pendingMapData.delete(file))

    pendingMapData.set(file, request)
  }

  /** Welche Datei eine Frage braucht — null, wenn sie ohne auskommt. */
  function mapDataFileFor(question: {
    divisionLevel?: string | null
    borderId?: string | null
  }): string | null {
    if (question.divisionLevel) return `divisions/${question.divisionLevel}.json`
    if (question.borderId) return `borders/${question.borderId}.json`
    return null
  }

  /**
   * Die Geometrie nachladen, die eingetragene Antworten zum Auswerten brauchen.
   *
   * `immediate`, weil nach einem Neustart Antworten aus dem Speicher kommen, ihre
   * Divisions- oder Grenzdatei aber nicht. Ohne das bliebe die Einschränkung stumm —
   * `predicateFor` lässt bei fehlender Geometrie alles durch, und das Suchgebiet wäre
   * stillschweigend zu gross.
   */
  watch(
    answers,
    (list) => {
      for (const entry of list) ensureMapData(mapDataFileFor(entry))
    },
    { immediate: true, deep: true },
  )

  /** Die Flächen einer Ebene, oder eine leere Liste solange sie noch lädt. */
  function divisionsFor(level: string | null | undefined): DivisionArea[] {
    if (!level) return []
    return (mapData.value.get(`divisions/${level}.json`) as DivisionsFile | undefined)?.areas ?? []
  }

  /** Die Abschnitte einer Grenzlinie, oder eine leere Liste solange sie noch lädt. */
  function borderSegmentsFor(id: string | null | undefined): BorderSegment[] {
    if (!id) return []
    return (mapData.value.get(`borders/${id}.json`) as BordersFile | undefined)?.segments ?? []
  }

  const usedCount = computed(() => usedIds.value.size)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const [questionsFile, poiFile] = await Promise.all([
        loadJson<QuestionsFile>('questions.json'),
        loadJson<PoiFile>('poi.json'),
      ])
      categories.value = questionsFile.categories
      pois.value = poiFile.pois
      poiCategories.value = poiFile.categories
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function toggleUsed(id: string) {
    const next = new Set(usedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    usedIds.value = next
  }

  function clearUsed() {
    usedIds.value = new Set()
  }

  /**
   * Eine Antwort eintragen — und die Karte damit zugleich abhaken.
   *
   * Beides in einem Schritt: eine beantwortete Frage *ist* eine genutzte. Ein zweites
   * Häkchen von Hand wäre Buchhaltung, die unterwegs niemand pflegt.
   */
  function addAnswer(entry: Omit<AnsweredQuestion, 'id' | 'askedAt'>): AnsweredQuestion {
    const record: AnsweredQuestion = {
      ...entry,
      // Datum plus Zufall: zwei Antworten in derselben Millisekunde sind unwahrscheinlich,
      // aber die ID muss sie trotzdem auseinanderhalten — sie ist der Schlüssel zum Löschen.
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      askedAt: Date.now(),
    }
    answers.value = [...answers.value, record]
    if (!usedIds.value.has(record.questionId)) {
      usedIds.value = new Set(usedIds.value).add(record.questionId)
    }
    return record
  }

  /**
   * Eine Antwort zurücknehmen. Das Häkchen bleibt: die Karte wurde ja gestellt, der
   * Verstecker hat seine Karten dafür gezogen.
   */
  function removeAnswer(id: string) {
    answers.value = answers.value.filter((entry) => entry.id !== id)
  }

  /** Neue Runde: alles zurück auf Anfang. */
  function clearAnswers() {
    answers.value = []
  }

  /** Geometrie einer Frage zeigen. */
  function setPreview(
    question: Question,
    origin: LatLon,
    radiusMeters: number | null,
    bearing: number | null = null,
  ): MapPreview | null {
    if (question.viz === 'none') {
      preview.value = null
      return null
    }

    ensureMapData(mapDataFileFor(question))

    preview.value = {
      id: '__preview',
      questionId: question.id,
      categoryId: categoryOfQuestion.value.get(question.id)?.id ?? '',
      label: question.label,
      viz: question.viz,
      origin,
      radiusMeters: radiusMeters ?? question.radiusMeters ?? null,
      poiCategory: question.poiCategory,
      divisionLevel: question.divisionLevel ?? null,
      divisionLabel: question.divisionLabel ?? null,
      borderId: question.borderId ?? null,
      borderLabel: question.borderLabel ?? null,
      bearing,
      createdAt: Date.now(),
    }
    return preview.value
  }

  function clearPreview() {
    preview.value = null
  }


  return {
    categories,
    pois,
    poiCategories,
    loading,
    error,
    usedIds,
    answers,
    search,
    preview,
    mapDataVersion,
    allQuestions,
    questionById,
    categoryOfQuestion,
    filteredCategories,
    poisByCategory,
    selectedPoiId,
    selectedPoi,
    selectPoi,
    usedCount,
    setPreview,
    clearPreview,
    divisionsFor,
    borderSegmentsFor,
    load,
    toggleUsed,
    clearUsed,
    addAnswer,
    removeAnswer,
    clearAnswers,
  }
})
