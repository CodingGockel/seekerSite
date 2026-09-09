# Hide & Seek Amsterdam — Spec

Begleit-App für ein Hide-and-Seek-Spiel nach dem Vorbild von *Jet Lag: The Game*.
Spielgebiet: alle Haltestellen, die mit dem **Amsterdam & Region Travel Ticket** (3 Tage, €44) erreichbar sind — Bahn, Metro, Tram, Bus und Fähre.

**Seit V7 ist die App ein Werkzeug für die Sucher**, nicht mehr für den Verstecker. V4
(Fragen verschicken) und V5 (Sucher-Standort von Hand) sind damit entfallen; V2 gilt in
umgekehrter Richtung — sie ist unten entsprechend annotiert.

---

## 1. Leitplanken

| Entscheidung | Wahl | Begründung |
|---|---|---|
| Frontend | Vue 3 + Vite + TypeScript | Client-only, statisch deploybar |
| Karte | Leaflet + Raster-Tiles | klein, stabil auf alten Handys, kein API-Key, Overlays trivial |
| State | Pinia + `localStorage` | kein Backend, kein Sync — Absprache läuft über eure Chat-Gruppe |
| Geometrie | Turf.js nur im Build-Skript | Das Gebiets-Polygon entsteht vorab; im Client reicht Haversine + Leaflet |
| Daten | statische JSON/GeoJSON in `public/data/` | zur Laufzeit per `fetch()` — **ohne Rebuild austauschbar** |
| Offline | nein | Manifest für den Homescreen-Start ist da, aber kein Service Worker — die Architektur blockiert ihn nicht |
| Hosting | GitHub Pages / Cloudflare Pages | statisch. **HTTPS ist Pflicht**, sonst kein `geolocation` |

**Bewusst nicht in V1:** Server, Accounts, Echtzeit-Sync, Push, Foto-Upload, Routing/Fahrplan.

---

## 2. Scope

### V1 — „Die Karte" (dieser Entwurf)
1. Vollbild-Karte, mobile-first
2. Spielgebiet als Polygon-Overlay
3. Alle erlaubten Halte als Marker, gefiltert nach Verkehrsmittel
4. **Versteck-Radius:** 800 m um den gewählten Halt als Kreis — das ist die Versteck-Regel
5. **Gültigkeitsprüfung:** eigener Standort vs. Radius — „du bist 240 m von Haarlem, gültig"
6. Eigener Standort (live) + „Zentrieren"-Button; alternativ von Hand auf der Karte
   gesetzt und dort verschiebbar
7. Haltestellenliste im Bottom Sheet, nach Entfernung sortiert, Suche
8. Detail zu einem Halt: Name, bedienende Linien je Verkehrsmittel, Entfernung, Link zu Maps
9. Umschalter zwischen drei Basiskarten (Standard, ÖPNV, Satellit)

**Standortquellen:** Ortung und ein von Hand gesetzter Punkt liegen getrennt im Store,
der gesetzte hat Vorrang. Andernfalls würde ihn das nächste GPS-Update überschreiben und
das Setzen wäre wirkungslos — mit `watchPosition` passiert das im Sekundentakt.

**Spielregel, die die App abbildet:** Verstecke sind **ausschließlich Haltestellen** (die
Spielerklärung: „Dein Zentrum ist die Station/Haltestelle, nicht dein genauer Standort"). Der
Hider muss sich innerhalb von 800 m Luftlinie um einen Halt aufhalten. Der Radius ist in
`config.json` konfigurierbar, nicht im Code festgenagelt — ihr werdet ihn beim Spielen
nachjustieren wollen. (Die Quelldatei nennt 700 m; das ist nur der Abstand, auf den Bus- und
Tramhalte ausgedünnt wurden, nicht der Spielradius.)

### V2 — Fragekarten (umgesetzt)

Alle 69 Karten aus `jetlag_questions_medium.json` stehen als durchsuchbare Liste zum
Abhaken bereit. 42 davon lassen sich auf der Karte zeichnen (35 in V2, die sechs
Verwaltungsebenen und die Landesgrenze kamen mit V6 dazu).

**Entwurfsentscheidung (mit V7 aufgehoben, s. u.):** Die App nimmt keine Antworten entgegen. Sie zeigt, *worüber*
eine Frage redet — den Umkreis, die Orte der Kategorie, den nächstgelegenen davon —, und
die Schlussfolgerung zieht der Spieler. Antworten laufen ohnehin über den Chat; ein
zweiter Zustand neben dem Häkchen wäre unterwegs nur Buchhaltung, die niemand pflegt.

Daraus folgt: Es liegt immer **höchstens eine** Geometrie auf der Karte, und sie ist
nicht dauerhaft. Der erste Entwurf sammelte stattdessen beantwortete Fragen als farbige
Einschränkungen, die sich überlagern sollten — der Bereich, den alle offen lassen, wäre
der gesuchte gewesen. Diese Überlagerung steht und fällt damit, dass jede Antwort
eingetragen wird; ohne Ja/Nein gibt es sie nicht mehr. Übrig geblieben ist die Vorschau,
die es schon vorher gab.

> **V7 dreht genau dieses Argument um.** Es galt für den *Verstecker* — der die Antworten
> gibt, aber nicht sammelt. Die *Sucher* stellen die Fragen und kennen jede Antwort; das
> Eintragen ist ihre Arbeit und nicht Buchhaltung obendrauf. Die Überlagerung ist damit
> nicht mehr die Wette, an der V2 gescheitert ist, sondern der Zweck der App.

Es gibt deshalb nur zwei Farben: alles Neutrale in `--preview`, und in `--accent` genau
das, was die Frage entscheidet — der nächstgelegene Ort und eine gestrichelte Linie mit
der Entfernung dorthin.

| Frage-Typ | Zeichenbar | Geometrie |
|---|---|---|
| **Radar** (8) | alle | gestrichelter Kreis um den Fragepunkt |
| **Tentacles** (4) | alle | Kreis, die Orte darin, der nächstgelegene hervorgehoben |
| **Matching** (20) | 15 | die Orte in der Nähe (bis zu 60), der nächstgelegene hervorgehoben; bei den Verwaltungsebenen die Fläche, s. V6 |
| **Measuring** (20) | 15 | dasselbe Bild wie Matching |
| **Thermometer** (3) | 0 | braucht Start- und Zielpunkt, s. u. |
| **Photos** (14) | 0 | rein soziale Mechanik |

**Matching und Measuring zeigen dasselbe Bild.** Die Fragen sind verschieden — Identität
des nächsten Orts gegen Abstand zu ihm —, beantworten lässt sich aber beides nur, indem
man die Orte sieht und weiss, welcher der eigene nächste ist. Measuring zeichnete
zunächst die Isodistanz: die Menge aller Punkte, die näher an *irgendeinem* Museum liegen
als der Fragende, ist exakt die Vereinigung gleich grosser Kreise um alle Museen. Exakt,
elegant, ganz ohne Voronoi — und beim Spielen unbrauchbar, weil sie eine Antwort einfärbt,
die es nicht mehr gibt, und ausgerechnet die Orte weglässt, um die es geht.

**Das Thermometer ist entfallen** (mit V7 zurückgekehrt, s. u.). Es braucht einen Start-
*und* einen Zielpunkt und lebte von „wärmer/kälter"; ohne Antworten bleibt eine
Mittelsenkrechte ohne Aussage.

Der Bezugspunkt einer Vorschau wird beim Anlegen **eingefroren**: der eigene Standort,
sonst die Kartenmitte. Mit der Live-Position würde der Kreis mitwandern und seine Aussage
verlieren. Verschiebbar ist er nicht — die Vorschau wird nicht gespeichert, ein
verschobener Punkt hielte nur bis zum nächsten Neuzeichnen.

**Abweichung vom Original:** Radar- und Thermometer-Werte sind metrisch und auf das
Gebiet zugeschnitten (500 m bis 40 km statt bis 161 km). Bei 45 × 40 km Spielgebiet
schliessen die oberen Original-Stufen nichts mehr aus. Dadurch 69 statt 71 Karten.

Nicht zeichenbar bleiben Küstenlinie, Gewässer, Bahn- und Strassenlinien sowie Höhe über
NN. Die Verwaltungsgrenzen und die Landesgrenze standen zunächst in derselben Liste; sie
sind mit V6 dazugekommen.

### V4 — Fragen verschicken (mit V7 entfallen)

Fast jede Karte fragt nach dem Verhältnis zweier Standorte — ohne die Koordinaten des
Suchers ist sie nicht zu beantworten. Bisher lief das über den Chat, von Hand
abgetippt. Jetzt baut die App die Nachricht selbst:

```
Team Rot fragt — Radar
Bist du im Umkreis von 2 km um mich?
Mein Standort: 52.37897, 4.90042
https://www.google.com/maps?q=52.37897,4.90042
In der App beantworten: https://…/#v=1&q=radar%3A2-km&o=52.37897%2C4.90042&r=2000&n=Team+Rot
```

Vier Zeilen mit je einem Zweck: wer fragt und was, wo er steht, derselbe Punkt für alle
ohne die App, und der Link für alle mit ihr. Der Knopf sitzt an **jeder** Karte, auch an
den nicht zeichenbaren — die Photos-Karten leben gerade davon, verschickt zu werden.

**Nur der Hinweg.** Die Antwort kommt als normale Chat-Nachricht zurück und bleibt dort.
Ein Antwort-Link wäre der nächste Schritt (`&a=<answer>` ist im Schema frei), hätte in der
App aber nichts, wohin er führte.

**Link-Schema.** Alles steckt im Fragment, nicht im Query-String: so braucht der
statische Host keine Umschreibregel, und die Koordinaten stehen in keinem Server-Log.

| | |
|---|---|
| `v` | Schema-Version. Passt sie nicht, wird der Link verworfen statt halb gelesen |
| `q` | `Question.id` — daraus kommen Label, Visualisierung und POI-Bezug |
| `o` | Standort des Fragenden, 5 Nachkommastellen (≈ 1 m) |
| `r` | Radius, nur wenn die Karte keinen mitbringt (`radar:frei-waehlbar`) |
| `n` | Absendername, optional |
| `t` | reserviert für den Zielpunkt des Thermometers |

**Beim Empfänger** öffnet der Link die Frage als Vorschau: die Geometrie des Fragenden,
sein Standort als fester Punkt A — dort ist er eine Tatsache aus der Nachricht und kein
Regler — und dazu **von der eigenen Position eine gestrichelte Linie zu jedem Punkt, der
die Antwort entscheidet**, beschriftet mit der Entfernung.

| Kartentyp | Linie(n) von der eigenen Position zu |
|---|---|
| Radar | dem Standort des Fragenden — im Kreis oder nicht, die Zahl macht es eindeutig |
| Matching | dem eigenen nächsten Ort. Läuft die zweite Linie auf denselben Marker, heisst die Antwort „ja" |
| Measuring | dem eigenen nächsten Ort; die beiden beschrifteten Linien nebeneinander sind „näher" oder „weiter" |
| Tentacles | dem nächsten Ort **im Kreis des Fragenden** — dessen Name *ist* die Antwort, deshalb steht er auch im Klartext in der Karte |
| Thermometer | — die Karte zeichnet nichts mehr, s. §2 |

Die App zeigt damit alles, was zur Antwort nötig ist, behauptet sie aber nicht — das
bleibt beim Spieler, wie schon bei den Einschränkungen.

**Grenzen.** Eine feste WhatsApp-Gruppe lässt sich nicht adressieren — `wa.me` kennt nur
einen Chat-Picker oder eine Telefonnummer, keine Gruppen-ID.

### V5 — Sucher-Standort von Hand (mit V7 entfallen)

Der Antwort-Weg aus V4 setzt voraus, dass die Sucher die App benutzen und den Link
schicken. Sie tun das nicht immer — oft steht in der Gruppe nur „wir sind bei
52.37897, 4.90042". Deshalb lässt sich derselbe Punkt auch von Hand eintragen: ein
Knopf „Sucher" auf der Karte, ein Textfeld, ein Zahlenpaar.

Von da an ist es **derselbe Zustand wie ein erhaltener Link**: das Karten-Icon einer
Frage legt ihre Geometrie um den Sucher-Standort und zieht von der eigenen Position die
gestrichelten Vergleichslinien (§V4, Tabelle). Es gibt keinen neuen Kartentyp und keinen
zweiten Zeichenweg — nur eine Weiche in `onPreviewQuestion`: mit Sucher-Standort
`setIncoming`, ohne ihn wie bisher `setPreview` um die eigene Position.

Bewusst schmal gehalten:

- **Nur ein Standort.** Eine Liste benannter Teams wäre Zustand, den unterwegs niemand
  pflegt; gefragt hat ohnehin gerade eines.
- **Nur ein Textfeld**, kein Setzen per Kartentipp und kein Ziehen des Markers. Der Punkt
  ist eine Angabe aus dem Chat, keine Schätzung — er wird abgetippt, nicht gepeilt.
- **Bleibt liegen**, auch beim Tab-Wechsel und über einen Neustart (`hs.prefs.v2`). Er
  darf deshalb nicht in `preview`/`incoming` stehen: die räumt `clearPreview()` weg.

Der Marker ist ein Ring in der Vorschau-Farbe, kein Punkt: liegt eine Frage an, setzt
sich der Ankerpunkt der Vorschau genau in seine Mitte, statt ihn zu verdecken.

Dabei fiel ein Fehler auf, der auch den Link-Weg betraf: `focusPreview` passte den
Ausschnitt nur um den Fragepunkt an. Steht der Sucher ein paar Kilometer weiter, lief die
eigene Vergleichslinie aus dem Bild — die halbe Aussage. Die Bounds schliessen jetzt bei
`compareToUser` die eigene Position ein.

### V6 — Verwaltungsebenen und Landesgrenze (umgesetzt)

Sieben Karten fragen nach Grenzen: sechs nach Verwaltungsgebieten — vier nach der Fläche selbst („1st bis 4th
Administrative Division"), zwei nach dem Abstand zu ihrer Grenze. Sie waren die grösste
zusammenhängende Lücke: Flächen statt Punkte, und dafür gab es weder Daten noch Zeichenweg.

**Die Zuordnung der Ebenen ist eine Spielentscheidung, keine Datenfrage.** Formal kennt
das Land nur zwei Ebenen, Provincie → Gemeente. Als 1. Ebene taugt die Provinz hier
trotzdem nicht: im Spielfeld liegen drei, rund vier Fünftel davon Noord-Holland. „Gleiche
Provinz?" antwortet fast immer „ja" und verschenkt einen Zug. Genommen werden deshalb die
offiziellen Zwischenraster des CBS:

| Ebene | Raster | im Spielgebiet |
|---|---|---|
| 1. | COROP-Regio (NUTS-3) | 9 |
| 2. | Gemeente | 46 |
| 3. | Wijk | 481 |
| 4. | Buurt | 1913 — als **schwach** markiert |

Die Alternative zu COROP wäre die Veiligheidsregio gewesen (7 im Feld, unterwegs
vielleicht geläufiger). COROP gewinnt, weil es dieselbe Quelle ist wie die drei anderen
Ebenen und als NUTS-3-Region auch ausserhalb der Niederlande ein Begriff bleibt.

Dass Buurt automatisch als schwach herauskommt, ist kein Versehen, sondern die Auskunft
über die Ebene: `build-questions.mjs` zählt die Flächen im Spielgebiet mit derselben
Schwelle wie bei den Orten. Gezählt wird gegen die Hülle selbst, nicht gegen ihr
umschliessendes Rechteck — die Hülle ist ein schräges Vieleck, und über die Ecken kämen
genug Wijken dazu, um auch Ebene 3 fälschlich über die Schwelle zu heben.

**Quelle:** CBS Gebiedsindelingen über den PDOK-WFS (CC BY 4.0, Attribution steht fest in
der Karte). Eine Adresse für alle vier Ebenen, amtlich, als fertiges GeoJSON in WGS84 —
kein Zusammensetzen von Relationen wie bei Overpass. Drei Eigenheiten stehen als Kommentar
im Skript: der `bbox`-Parameter ist `lat,lon`, die Ausgabe `lon,lat`; der Dienst gibt rund
tausend Objekte je Antwort heraus und muss gepagt werden (`numberMatched` ist dabei nicht
die Gesamtzahl, sondern zählt mit); und `bbox` filtert, es schneidet nicht — gewollt, denn
eine am Rahmen abgeschnittene Gemeente ergäbe für die Border-Karte eine schnurgerade
Grenze, die es nicht gibt.

**Geladen wird erst bei Bedarf.** Die vier Dateien wiegen zusammen mehr als alle übrigen
Laufzeitdaten, Buurt allein 1,1 MB. Die meisten Runden fragen keine einzige dieser Karten.
Also lädt jede Ebene beim ersten Öffnen einer Frage, die sie braucht, und dann nie wieder.
Bis sie da ist, steht nur der Ankerpunkt auf der Karte; ein Zähler im Store trägt die
Flächen nach — **und mit ihnen den Ausschnitt.** Ohne das passte `focusPreview` zunächst
auf den Rückfallwert und sprang beim Eintreffen der Daten ein zweites Mal; bei einer Wijk
lagen dazwischen fünf Zoomstufen.

**Das Bild** folgt der Regel aus V2: neutral, was die Frage umreisst, in `--accent` genau
das, was sie entscheidet. Die Fläche, in der der Fragepunkt liegt, wird ausgefüllt und
benannt; die 40 nächsten Nachbarn stehen als Umriss darum. Ohne sie sagt die eigene Fläche
nichts — und bei der Border-Karte *sind* sie die Grenzen, um die es geht. Die Kappung bei
40 ist dieselbe Überlegung wie `MAX_POI_MARKERS`: auf Buurt-Ebene lägen sonst fast
viertausend Ringe auf der Karte.

Der Name steht nur da, wo er die Antwort ist. Auf der Border-Karte ist es die Entfernung,
und deren Etikett sitzt in der Mitte einer meist kurzen Linie — also fast auf dem
Fragepunkt, genau dort, wo auch der Flächenname landet. Zwei Beschriftungen übereinander,
von denen die wichtigere verdeckt wird.

**Bei einer erhaltenen Frage entscheidet keine Punktentfernung, sondern eine Fläche.** Die
Regel aus V4 — von der eigenen Position eine Linie zu jedem Punkt, der die Antwort
entscheidet — läuft hier ins Leere: eine Linie zum Flächenschwerpunkt sagt nichts. An ihre
Stelle tritt die eigene Fläche, gestrichelt in der Akzentfarbe umrandet und benannt,
während die des Fragenden neutral gefüllt bleibt. Ist es dieselbe, liegt ein Umriss auf dem
anderen. Die Border-Karte behält dagegen die Linie: dort gibt es den entscheidenden Punkt,
nämlich den nächsten auf der Grenze der eigenen Fläche.

Weil die Flächen einer Ebene lückenlos kacheln, ist die nächste Grenze der eigenen Fläche
zugleich die nächste Grenze überhaupt — es muss keine zweite Fläche geprüft werden.

**Die Landesgrenze** („International Border") kam als siebte Karte dazu und ist der
einfachere Fall: sie umschliesst keine Fläche, in der jemand stünde — gefragt ist nur der
Abstand. Damit ist sie eine **Linie**, und das erspart das, was bei OSM-Grenzen sonst die
eigentliche Arbeit ist: Relationsmitglieder zu Ringen zusammenzusetzen. Die Wege selbst
sind schon die Antwort.

Der Kniff steckt in der Abfrage. Ein Weg, der zugleich Mitglied der Grenzrelation der
Niederlande *und* der eines Nachbarlands ist, liegt auf der gemeinsamen Grenze; Overpass
kann Mengen schneiden (`way.nl.other`). Die Küste fällt damit von selbst heraus — sie
gehört nur zu einer der beiden Relationen. Übrig bleiben 420 Wege, davon 10 maritime.

Aussagekräftig ist die Karte trotz der Entfernung: der westlichste Punkt der deutschen
Grenze liegt bei Millingen (51,84 N / 5,96 O) und ist von überall im Feld der nächste, im
Westen übernimmt Belgien. Zwischen Utrecht (64 km) und Zaandam (103 km) liegen 40 km — die
Frage läuft auf „stehst du weiter östlich als ich?" hinaus und teilt das Feld sauber.
Deshalb spannt auch nicht die Grenze den Ausschnitt auf, sondern die Strecke zu ihr: die
ganze Linie im Bild hiesse, halb Mitteleuropa zu zeigen.

**Im Client bleibt es bei Handarbeit** (§1): `containsPoint` als Strahlenschnitt mit
Löchern, `nearestPointOnEdges` als Punkt-zu-Strecke in einer flachen Ebene um den
Fragepunkt. Letzteres läuft über die Kantenzüge einer Geometrie — die Ringe einer Fläche
wie die Züge einer Linie — und trägt damit Gemeentegrenze und Landesgrenze auf demselben
Weg. Turf läuft weiterhin nur im Build. Das Link-Schema bleibt unverändert: `q` trägt die
Frage-ID, Ebene und Grenze kommen beim Empfänger aus `questions.json`.

### V7 — Sucher-Modus (umgesetzt)

Die App wechselt die Seite. Eingetragen werden jetzt **Antworten**, und gezeigt wird, was
danach als Versteck noch übrig ist.

**Kandidaten filtern, nicht Polygone verschneiden.** Ein Versteck ist immer eine
Haltestelle (§V1) — die Menge der Möglichkeiten ist also endlich und klein, 459 Halte.
Jede Antwort ist damit ein Prädikat über dieser Menge, und das verbleibende Suchgebiet
ist die Vereinigung der 800-m-Kreise um die Übriggebliebenen.

Das ist nicht die billigere Näherung, sondern die genauere Rechnung: eine
Polygonverschneidung müsste dieselben Kreise erst bilden und würde dabei nur Rundungsfehler
hinzufügen. Und sie erspart die Bibliothek — `@turf/*` liegt bewusst nur in
`devDependencies` (§4), ein `difference`/`union` hätte polygon-clipping ins Bundle geholt.
Gebraucht werden stattdessen vier Funktionen, die alle schon in `lib/geo.ts` standen:
Entfernung, nächster Ort, Punkt-in-Fläche, Abstand zum Rand.

Nebeneffekt, der unterwegs mehr zählt als die Fläche: **eine Zahl.** „Noch 37 mögliche
Verstecke" beantwortet die Frage, die die Sucher wirklich haben.

**Das Thermometer kommt zurück** (es war in V2 entfallen, weil es Start *und* Ziel braucht).
Gefahren wird dabei nicht: gewählt wird eine Richtung, der Zielpunkt liegt die Kartendistanz
davon entfernt. „Wärmer" ist die Halbebene jenseits der Mittelsenkrechten — und die liegt
auf der **halben** Strecke. Daraus folgt das Gegenintuitive: die *kürzeste* Karte schneidet
am schärfsten. Bei 1 km läuft die Trennlinie 500 m neben den Suchern durch und halbiert das
Feld (H = 1,00 Bit), bei 15 km liegt sie 7,5 km weg und nimmt nur eine Ecke mit (H = 0,84).
Zusammen mit der frei wählbaren Richtung ist die Karte damit ein beliebig drehbarer Schnitt
durch die eigene Position — die stärkste Primitive im Spiel, und mit 2 gezogenen Karten
zugleich die billigste.

**Vorschau vor dem Eintragen.** An jeder Antwortmöglichkeit steht, wie viele Verstecke sie
übrig liesse. Bei einer Frage, die den Verstecker Karten kostet, ist das der halbe Entschluss.

**Nicht auswertbare Antworten werden trotzdem protokolliert.** Photos, „gleiche Transitlinie",
Küstenlinie, Meereshöhe — sie kosten den Verstecker Karten und gehören ins Protokoll, sind
dort aber sichtbar als „schliesst nichts aus" markiert. Still durchgereicht würde man den
Fehler in der Zahl darüber suchen.

**Ortskategorien bleiben die unsichere Stelle.** Die Hausregel entscheidet sie über Google
Maps, die App rechnet mit OSM (93 „Zoos", 1003 „Parks"). Rechnerisch sind es starke Fragen,
praktisch unzuverlässig. Deshalb ist jede Antwort einzeln löschbar — das ist zugleich die
Antwort auf Veto, „Move"-Powerup und Vertipper, ohne dafür eigene Logik zu bauen.

**Was entfallen ist:** die Prüfung „zählt mein Standort als Versteck?" samt dem grün/roten
Ortungsknopf, das Verschicken von Fragen (V4) mitsamt `lib/share.ts` und dem Empfangsweg,
der von Hand eingetragene Sucher-Standort (V5) — die Sucher *sind* jetzt der eigene
Standort —, und der Schalter „alle Radien", den die Restgebiets-Darstellung ersetzt.

**Gegenprobe.** `npm run check` rechnet 21 Fälle vom Amsterdam Centraal gegen unabhängig
ermittelte Sollwerte, je Fragetyp einen. Dabei fiel auf, dass eine erste, auf den Centraal
projizierte Vergleichsrechnung die Landesgrenzen-Frage um fünf Halte danebenlag: über 94 km
zur Grenze verzerrt eine ortsfeste Ebene messbar. `nearestPointOnEdges` projiziert pro
Punkt neu und liegt richtig — 249 statt 244.

### V3 — Flüche
- Fluch-Katalog aus JSON, aktive Flüche mit Timer
- Freies Radien-Zeichenwerkzeug auf der Karte
- Küstenlinie und Gewässer als Geometrie — schaltet die letzten Measuring-Karten frei
  (die Verwaltungsgrenzen sind mit V6 erledigt)

---

## 3. Datenmodell

Alles liegt in `public/data/` und wird zur Laufzeit geladen. Ändern = Datei tauschen, kein Build.

### `stations.json`
```jsonc
{
  "version": 2,
  "generatedAt": "2026-09-03",
  "source": "data/artt_verstecke.geojson (kuratierte ARTT-Versteckliste)",
  "stations": [
    {
      "id": "amsterdam-centraal",       // stabil, wird für Spielstände referenziert
      "name": "Amsterdam Centraal",
      "aliases": ["Centraal Station"],  // Zweitname der Quelle, nur für die Suche
      "lat": 52.37897,
      "lon": 4.90042,
      "mode": "train",                  // wonach gefiltert und eingefärbt wird
      "lines": {                        // wer hier hält, je Verkehrsmittel
        "train": ["Intercity", "Sprinter", "…"],
        "metro": ["51", "52", "53", "54"],
        "tram": ["2", "4", "14", "17", "24", "26"],
        "bus": ["18", "21", "…"],
        "ferry": ["F2", "F3", "F4"]
      },
      "isStation": true,                // Bahnhof — für „nächster Bahnhof"
      "extraCost": false,               // true = ausserhalb des Tickets, Aufpreis
      "ticketValid": true,              // false schliesst den Halt vom Spiel aus
      "notes": ""
    }
  ]
}
```

`mode` ist einwertig und trägt den Filter: der Halt steht wegen genau eines Verkehrsmittels
in der Liste. Die Linien-Spalten sagen zusätzlich, was dort sonst noch hält — daraus kommt
der zweite Ring am Marker (Bus dabei ausgenommen: er hält fast überall und der Ring wäre
dann bedeutungslos).

### `area.geojson`
Ein `Polygon`/`MultiPolygon` mit dem Spielgebiet. **Nur visuell** — normativ ist die Haltestellenliste.
Wird als weiches Overlay gezeichnet (Rest der Welt abgedunkelt), damit sofort klar ist, wo Schluss ist.

### `config.json`
Startposition, Zoom-Grenzen, Versteck-Radius, die Liste der Basiskarten und die Farben pro
`mode`. `map.maxZoom` ist die Grenze der Karte, `maxZoom` je Basiskarte die Stufe, bis zu
der die Quelle echte Kacheln liefert (`maxNativeZoom`) — darüber skaliert Leaflet hoch,
statt graue Flächen zu zeigen.

### `poi.json`
Rund 2350 Orte in 11 Kategorien (Museum, Bibliothek, Kino, Krankenhaus, Park, Zoo,
Golfplatz, Freizeitpark, Konsulat, Flughafen, Aquarium), erzeugt von
`scripts/fetch-pois.mjs`. Rahmen bewusst grösser als das Spielgebiet, sonst bekämen
Randstationen ein falsches „nächstes Museum". Kompakt geschrieben (260 kB, 57 kB gzip) —
die Datei wird nie von Hand bearbeitet.

Die Kategorien stehen in zwei Rahmen (s. V6), was in der Datei unter `frames` und je
Kategorie als `scope` steht: die dichten im 25-km-Ring, die fünf seltenen (Aquarium,
Flughafen, Zoo, Freizeitpark, Konsulat) in 100 km. Am Ende jedes Laufs rechnet das Skript
für alle 459 Halte nach, dass der nächste Ort jeder Kategorie näher liegt als ihr Offset,
und bricht sonst ab — die Datei wäre dann still falsch.

Zwei Filter sind entscheidend: `zoo=petting_zoo` fliegt raus (163 von 193 „Zoos" sind
niederländische Kinderbauernhöfe), und als Flughafen zählt nur, was einen IATA-Code hat
(ein ICAO-Code reicht nicht, den hat auch ein Segelflugplatz).

### `divisions/<ebene>.json`
Die vier Verwaltungsebenen, je eine Datei: `corop`, `gemeente`, `wijk`, `buurt`. Je Fläche
nur `code`, `name` und die Geometrie; erzeugt von `scripts/fetch-divisions.mjs` aus den CBS
Gebiedsindelingen (s. V6). **Als einzige Laufzeitdaten nicht beim Start geladen**, sondern
erst, wenn eine Frage die Ebene braucht — zusammen wiegen sie mehr als alles andere.

### `borders/international.json`
Die Landesgrenze zu Deutschland und Belgien als Linienzüge, nach Nachbarland gruppiert;
erzeugt von `scripts/fetch-borders.mjs` aus OpenStreetMap. Wird wie die Ebenen erst bei
Bedarf geladen.

### `questions.json`
Erzeugt von `scripts/build-questions.mjs` aus `jetlag_questions_medium.json`: stabile ID
je Frage (damit Häkchen einen Neustart überstehen), Visualisierungstyp, POI- oder
Ebenenbezug. Das Skript liest `poi.json`, `stations.json` und die Ebenen und markiert
Fragen automatisch als **schwach**, wenn die Daten sie entwerten — bei zweitausend Buurten
im Spielgebiet ist „gleiche Buurt?" fast immer „nein".

---

## 4. Architektur

```
public/data/          stations.json · area.geojson · config.json   ← zur Laufzeit geladen
public/data/divisions/ corop · gemeente · wijk · buurt             ← erst bei Bedarf
public/data/borders/  international.json                          ← ebenso
scripts/
  import-stations.mjs data/artt_verstecke.geojson → stations.json
  fetch-pois.mjs      Overpass → poi.json
  fetch-divisions.mjs PDOK-WFS → divisions/*.json
  fetch-borders.mjs   Overpass → borders/international.json
  lib/region.mjs      die Rahmen, in denen beschafft wird
  lib/geojson.mjs     ausdünnen und runden, für beide Geometrie-Skripte
src/
  components/
    GameMap.vue           Karten-Host, besitzt die Leaflet-Instanz
    StationLayer.vue      Marker + Clustering
    AreaLayer.vue         Spielgebiet-Overlay
    BottomSheet.vue       Snap-Punkte: peek / halb / voll
    StationList.vue       sortiert nach Entfernung, mit Suche
    StationDetail.vue
    LayerControls.vue     Filter nach Verkehrsmittel
  composables/
    usePreviewLayers.ts   Geometrie der gerade gezeigten Frage, Orte wie Flächen
    useLeafletMap.ts      Leaflet direkt kapseln
    useGeolocation.ts     watchPosition + Permission-Handling
    useGameData.ts        JSON laden, validieren, cachen
    useDistances.ts
  stores/
    game.ts               Pinia, in localStorage gespiegelt
  types/game.ts
```

**Leaflet wird direkt benutzt, nicht über einen Vue-Wrapper.** Die Wrapper hinken Versionen
hinterher und stehen genau da im Weg, wo es interessant wird (Halbebenen, dynamische Kreise,
Canvas-Renderer). Ein Composable, das die Map-Instanz hält und bei `onUnmounted` aufräumt,
ist weniger Code als der Wrapper.

Marker über `L.canvas()` rendern — bei ~150 Stationen auf einem Mittelklasse-Handy ist
DOM-Marker-Rendering beim Zoomen spürbar ruckelig, Canvas nicht.

---

## 5. Mobile-First UI

```
┌──────────────────────────┐
│                  [Ortung]│  grau: aus · grün: gültiges Versteck · rot: keins
│                      +/− │
│         KARTE            │  Vollbild, Spielgebiet abgesetzt
│                          │
│           [Standard]  ‹  │  Karte · Standort setzen · Sucher · Alle Radien
├──────────────────────────┤
│ ══ Bottom Sheet ══       │  peek: „12 Haltestellen in der Nähe"
│ Haltestellen · Filter    │  halb: Liste  ·  voll: Detail
└──────────────────────────┘
```

Die Knopfleiste rechts fährt über den Pfeil an ihrem unteren Ende nach rechts aus dem Bild
und gibt die Karte frei; der Zustand liegt bei den übrigen Einstellungen. Der Ortungsknopf
bleibt aussen vor — er ist zugleich Anzeige und muss immer sichtbar sein.

Das Bottom Sheet kennt drei Rastpunkte (peek · halb · voll). Ziehen und der Griff schalten
wie gehabt; ein Tipp auf die leere Fläche rechts neben den Tabs fährt es ganz aus und aus
dem ausgefahrenen Zustand wieder ganz ein — die zwei Extreme ohne Umweg über „halb".

Ein Statusbalken über der Karte war der erste Entwurf; er kostete rund 56 px Höhe für
eine Aussage, die in eine Farbe passt. Geblieben ist der Ortungsknopf oben rechts: er
ist zugleich Schalter (Ortung an · Zentrieren · GPS nutzen) und Anzeige — grau ohne
Standort, grün im Versteck-Radius, rot ausserhalb. Der ausführliche Text steht im
`title`, Ortungsfehler erscheinen als wegklickbare Einblendung.

Harte Regeln, weil das Ding im Zug mit einer Hand bedient wird:
- `100dvh` statt `100vh`, plus `env(safe-area-inset-*)` — sonst verdeckt die iOS-Leiste die Controls
- Touch-Targets ≥ 44 px, Fließtext ≥ 14 px
- Alle primären Aktionen im unteren Bildschirmdrittel (Daumenzone)
- Eine Palette, hell, auch auf einem Gerät im Dunkelmodus (`color-scheme: light`): gespielt
  wird tagsüber draussen, und dort ist die helle Karte die lesbare. Die Karten-Overlays
  holen ihre Farben trotzdem aus dem CSS (`cssColor` in `lib/theme.ts`), weil Leaflet
  konkrete Werte braucht und sie nur an einer Stelle stehen sollen
- `watchPosition` mit `enableHighAccuracy`, aber pausieren, wenn die Seite im Hintergrund ist (Akku)

**Basiskarten:** drei zur Auswahl, alle ohne API-Key, konfiguriert in `config.json`:

| Karte | Quelle | wofür |
|---|---|---|
| Standard | OpenStreetMap | Orientierung, Strassennamen |
| ÖPNV | ÖPNVKarte (memomaps) | zeigt Linien und Netz — für ein Spiel über Nahverkehr das nützlichste Bild |
| Satellit | Esri World Imagery | Gelände und Bebauung, um Verstecke einzuschätzen |

**Zoom bis 21.** Wie weit eine Quelle wirklich reicht, steht nirgends dokumentiert — es
wurde Kachel für Kachel abgefragt: OpenStreetMap liefert bis 19 und antwortet darüber mit
HTTP 400, die ÖPNVKarte bis 18 (danach 404), Esri World Imagery bis **21**. Ab 22 gibt
Esri viermal dieselbe 2521 Byte grosse Platzhalterkachel zurück — der Statuscode bleibt
200, die Grenze ist also nur am Inhalt zu erkennen. Die z21-Abdeckung wurde an allen vier
Ecken des Spielgebiets geprüft, nicht nur in Amsterdam.

Die Karte geht deshalb bis 21, und nur der Satellit hat dort echte Bilddaten — knapp 7 cm
je Pixel, genug für Dachaufbauten und einzelne Büsche. Die beiden gezeichneten Karten
skalieren die letzten zwei bzw. drei Stufen hoch; „Spoor 10" und „Kiosk" bleiben dabei
lesbar. Das ist der Zweck der Trennung von `maxZoom` und `maxNativeZoom`: ohne sie wäre
oberhalb der Quellgrenze nichts als Grau.

CARTO Positron wäre optisch die bessere Grundkarte, verlangt aber inzwischen einen
API-Key — die Kacheln kommen sonst mit „API KEY REQUIRED" quer über der Karte.

Gezeichnete Karten sind für eine Spielkarte zu bunt; ein CSS-Filter entsättigt sie leicht,
damit die Marker davor klarer hervortreten. Der Filter sitzt auf dem Layer-Container, nicht
auf der Tile-Pane — nur so bleiben Marker und Radien unberührt **und** lassen sich
Luftbilder über `photo: true` ausnehmen.

**Haltestellenmarker:** Piktogramm des Verkehrsmittels (Zug, „M" für Metro, Tram, Bus,
Fähre) in Weiss auf der Modusfarbe. Umsteigeknoten tragen einen zweiten Ring in der Farbe
des weiteren Verkehrsmittels, Halte ausserhalb des Tickets einen gestrichelten Rand.
Unterhalb von Zoom 13 schrumpfen sie auf schlichte Punkte — bei 459 Markern verklumpen
volle Pins in der Innenstadt sonst zu einem unlesbaren Haufen.

**Attribution:** Das Leaflet-Branding ist abgeschaltet, die Attribution der Kartendaten
bleibt (Lizenzpflicht), eingeklappt auf ein antippbares „i". Das ist die von OpenStreetMap
für kleine Displays vorgesehene Form.

## 6. Datenbeschaffung

Die Rahmen, in denen beschafft wird, stehen gemeinsam in `scripts/lib/region.mjs` und
werden dort aus `area.geojson` gepuffert, nicht von Hand gesetzt — sonst laufen sie der
Zone hinterher, sobald sich die Stationsliste ändert. Es sind drei:

| Rahmen | Offset | wofür |
|---|---|---|
| `BBOX` (nah) | Zone + 25 km | alles Dichte, wonach „am nächsten" gefragt wird; COROP- und Gemeentegrenzen |
| `FAR_BBOX` | Zone + 100 km | Aquarium, Flughafen, Zoo, Freizeitpark, Konsulat |
| `INNER_BBOX` | Zone + 5 km | Wijk und Buurt, wo nur „dieselbe wie meine?" zählt |

Wie weit ein Rahmen reichen muss, entscheidet nicht das Gebiet, sondern die Dichte der
Kategorie: der weiteste „nächste" ist bei Kino 11,4 km, bei Aquarium 59,5 km. Deshalb der
zweite, weite Rahmen für die fünf seltenen Kategorien — es sind zusammen rund 370
Datensätze, er kostet also fast nichts. Beim nahen Rahmen ist zusätzlich der *Ring* um das
Gebiet massgeblich, nicht das Rechteck: `fetch-pois.mjs` wirft nach der Abfrage weg, was
nur in dessen Ecken liegt (Rotterdam, Den Haag). Das hält die Datei klein, obwohl der
Abstand ringsum gleichmässig 25 km beträgt.

Quelle ist `data/artt_verstecke.geojson`: die von Hand kuratierte Liste aller Halte im
Geltungsbereich des Tickets — Bahn, Metro und Fähre vollständig, Bus und Tram auf 650 m
Abstand ausgedünnt, je Halt die bedienenden Linien, dazu `in_artt` (im Ticket) und
`is_station` (Bahnhof).

`scripts/import-stations.mjs` macht daraus `stations.json`: Linien-Spalten aufsplitten,
IDs vergeben (`slug(name)`, bei Namensgleichheit an verschiedenen Orten mit dem Modus
ergänzt — Zaandam ist Bahnhof *und* Fähranleger) und die doppelt geführten Bahnhöfe
zusammenlegen. Die stehen einmal unter dem NS-Namen („Amsterdam Centraal") und einmal
unter dem GVB-Namen („Centraal Station"); die Paare liegen unter 100 m auseinander, das
nächste echte Bahnhofspaar über 800 m, deshalb trennt ein 300-m-Schwellwert sicher. Der
verworfene Name bleibt als `aliases` erhalten, damit die Suche ihn findet.

Vorher kam die Liste aus OpenStreetMap (`fetch-stations.mjs`, entfallen). Overpass kennt
die Ticket-Grenze nicht — die kuratierte Datei schon, und zwar mit dem Zwischenzustand
„erreichbar, aber gegen Aufpreis" (`extraCost`). Solche Halte sind bespielbar, in Liste und
Karte markiert und zählen auch fürs Gebiet — die Hülle reicht dadurch bis Utrecht und
Alkmaar. Wer einen Halt ganz ausschliessen will, setzt `ticketValid: false` in
`stations.json`; nur das hält ihn aus Karte, Liste und Gebiet heraus.

## 7. Entschieden

1. **Tram/Bus:** drin. Ursprünglich waren nur NS-Bahnhöfe und GVB-Metro Verstecke, um die
   Liste bei ~150 Punkten und die Karte lesbar zu halten. Die Spielerklärung nennt aber
   ausdrücklich die *Haltestelle* als Zentrum der Zone, und mit der kuratierten Liste (Bus
   und Tram auf 650 m ausgedünnt) bleiben es 459 Punkte. Lesbar bleibt die Karte über den
   Filter je Verkehrsmittel und die Punkt-Darstellung unterhalb von Zoom 13.
2. **Verstecke:** ausschließlich Haltestellen, 800 m Radius (s. §2).
3. **Timer und Rollen:** nicht in der App. Bleibt bei euch im Chat, spart die halbe Statusleiste.
4. **Spielgebiet-Polygon:** wird zur Build-Zeit als konvexe Hülle über alle bespielbaren
   Halte erzeugt (`npm run data:area`), die Aufpreis-Bahnhöfe eingeschlossen. Damit ist das
   Gebiet automatisch konsistent mit der Haltestellenliste — auch nachdem du Halte nachgezogen
   hast. Ein handgezeichnetes `area.geojson` überschreibt es, falls ihr das Gebiet später
   bewusst enger zieht.

## 8. Status

V1, V2, V6 und V7 sind umgesetzt; V4 und V5 sind mit V7 entfallen. Die Auswertung ist
headless gegen den echten Datenstand gegengeprüft (`npm run check`, 21 Fälle je Fragetyp).

- 459 Halte (63 Bahn, 29 Metro, 52 Tram, 300 Bus, 15 Fähre), davon 16 nur gegen Aufpreis;
  alle liegen im Spielgebiet
- 2259 Orte in 11 Kategorien
- 4831 Verwaltungsflächen in 4 Ebenen (21 COROP, 156 Gemeenten, 829 Wijken, 3825 Buurten)
- Landesgrenze zu Deutschland und Belgien, 3562 Stützpunkte
- 69 Fragekarten, 45 davon auf der Karte zeichenbar (die drei Thermometer kamen mit V7 dazu)
- 24 Karten schliessen nichts aus und werden nur protokolliert

### Beim Bauen aufgefallen

- Ein Welt-Ring bis ±90° Breite lässt sich in Web-Mercator nicht projizieren; das
  Spielgebiet-Overlay wurde dadurch gar nicht gezeichnet. Grenze ist ±85,05°.
- Leaflet stapelt Marker nach Breitengrad, nicht nach Einfügereihenfolge. Der
  hervorgehobene Ort verschwand dadurch mitten in der Innenstadt unter den anderen; es
  braucht einen `zIndexOffset`.
- `L.circle(...).getBounds()` funktioniert nur, wenn das Circle an einer Karte hängt —
  sonst kommen NaN-Bounds heraus. `L.latLng(...).toBounds(meter)` rechnet kartenunabhängig.
- Leaflets `flyToBounds` hat die Karte im Test nicht bewegt, `fitBounds` schon.
- `fitBounds` auf einen einzelnen Punkt ergibt ein leeres Rechteck und damit die höchste
  Zoomstufe — bei Matching und Measuring war danach von der Geometrie nichts mehr zu
  sehen. Ohne Radius spannt dort der nächstgelegene Ort den Ausschnitt auf, mit einer
  Untergrenze für den Fall, dass er zweihundert Meter weiter steht.
- Bahn und Metro am selben Knoten heissen unterschiedlich („Amsterdam Centraal" vs.
  „Centraal Station") — in OSM wie in der kuratierten Liste. Halte müssen räumlich
  zusammengeführt werden, nicht über den Namen.
- „Ist dein nächster Bahnhof meiner?" galt als schwache Frage, weil der Hider per Regel an
  einem Bahnhof stand. Mit Tram- und Bushaltestellen als Verstecken sagt sie wieder etwas
  aus — sie zeichnet deshalb nur die 63 Bahnhöfe (`isStation`), nicht jeden Halt.
- CARTO-Basiskarten verlangen inzwischen einen API-Key und schreiben sonst
  „API KEY REQUIRED" über die Kacheln.
- Beim Prüfen der Zoomstufe über die Kachel-URLs täuscht die erste Kachel im DOM: beim
  Zoomen bleiben alte stehen. Nur die höchste vorhandene Stufe ist die aktuelle.
- Esri meldet oberhalb seiner Auflösungsgrenze keinen Fehler, sondern HTTP 200 mit einer
  immer gleichen Platzhalterkachel. Wer die Grenze über den Statuscode sucht, findet sie
  nicht — es braucht den Vergleich der Antwortgrössen benachbarter Kacheln.
- Das Bottom Sheet liegt mit `z-index: 700` über allem. Ein Overlay, das aus ihm heraus
  aufgerufen wird, muss es einklappen — sonst erscheint es hinter der Liste, aus der man
  es gerade geöffnet hat.
- `history.replaceState` löst kein `hashchange` aus. Deshalb kann das Fragment nach dem
  Lesen gefahrlos geleert werden, ohne dass sich der Link selbst noch einmal auslöst.
- Permanente Leaflet-Tooltips erscheinen auch an Linien mit `interactive: false` — genau
  das, was eine Streckenbeschriftung braucht, die nicht angeklickt werden soll.
- Der frei wählbare Radar-Radius steckt in der Fragenliste und galt versehentlich auch
  für Karten ohne Radius. Im Link stand dann `r=3000` an einer Photos-Karte, und beim
  Einpassen zog die Karte den Ausschnitt auf die 3 km des Reglers statt auf den
  nächstgelegenen Ort — beim Zeichnen fiel es nicht auf, weil Matching und Measuring
  keinen Radius benutzen.
- Der Platzhalter, der in der Fragenliste an der Stelle eines fehlenden Kartenknopfs
  steht, war 30 px breit, der Knopf 34. In jeder Zeile ohne Kartenknopf rutschte der
  Senden-Knopf daneben deshalb um 4 px nach rechts. Beide hängen jetzt an einem Wert.
- Der Beschaffungsrahmen endete im Osten bei 5,35°, das Spielgebiet reicht aber bis
  Lelystad (5,50°). Für Halte im Osten war „dein nächstes Museum" damit schlicht falsch —
  aufgefallen erst, als die Verwaltungsebenen denselben Rahmen benutzen sollten. Beide
  Rahmen stehen jetzt gemeinsam in `scripts/lib/region.mjs`.
- Derselbe Fehler noch zweimal, nachdem die Ostkante geflickt war. Erstens war das von
  Hand nachgezogene Rechteck ringsum unterschiedlich weit — Süd 6,7 km, Nord 10,8 km, West
  17,2 km, Ost 19,6 km, bei einem Kommentar, der „plus rund 20 km" behauptete. Es wird
  jetzt aus `area.geojson` gepuffert und kann gar nicht mehr auseinanderlaufen. Zweitens
  hilft ein gleichmässiger Offset den seltenen Kategorien nicht: für 269 von 459 Halten lag
  das nächste Aquarium weiter weg als der Rand, für 39 der nächste Flughafen. Die Weite
  muss an der Dichte hängen, nicht am Gebiet. Beides fiel nur auf, weil nachgerechnet
  wurde; auf der Karte sieht eine falsche Antwort genauso plausibel aus wie eine richtige,
  und deshalb rechnet `fetch-pois.mjs` das jetzt bei jedem Lauf selbst nach.
- Nachbarumrisse bei Strichstärke 1 und 55 % Deckkraft sind auf der Grundkarte nicht zu
  sehen: zwischen Autobahnen, Kanälen und Bebauungsgrenzen geht eine Haarlinie unter. Erst
  Stärke 2 bei 85 % trennt sie davon ab. Am Bildschirm nachgemessen, nicht geschätzt.
- `watchPosition` liefert im Sekundentakt. Solange eine erhaltene Frage offen ist, hängt
  daran ein Neuzeichnen — bei Matching und Measuring bis zu 60 Marker. Unter 20 m Bewegung
  wird deshalb nicht neu gezeichnet; das ist feiner, als die Entfernungsangabe auflöst.
