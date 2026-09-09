# Hide & Seek — Amsterdam · Sucher-Modus

Werkzeug für die **Sucher** in einem Hide-and-Seek-Spiel nach dem Vorbild von
*Jet Lag: The Game*. Man trägt die Antworten des Verstecker ein, und die App zeigt,
welche Fläche danach überhaupt noch ein gültiges Versteck sein kann.

Client-only, mobile-first, kein Server. Der Entwurf steht in [SPEC.md](SPEC.md).

> Dies ist der Sucher-Umbau der ursprünglichen Verstecker-App. Alles, was nur der
> Verstecker brauchte — die Prüfung „zählt mein Standort als Versteck?", das Verschicken
> von Fragen per Link, der von Hand eingetragene Sucher-Standort — ist entfallen.

## Der Kerngedanke

Die Spielregel sagt: ein Versteck ist **immer eine Haltestelle**, und der Verstecker muss
sich innerhalb von 800 m um sie herum aufhalten. Damit ist die Menge der möglichen
Verstecke endlich und klein — **459 Halte**.

Jede beantwortete Frage ist deshalb keine Fläche, die man verschneiden müsste, sondern
schlicht ein Filter über diesen 459: „Radar 10 km → ja" lässt 186 übrig, eine
Landesgrenzen-Frage davon noch 109. Das verbleibende Suchgebiet ist die Vereinigung der
800-m-Kreise um die Übriggebliebenen.

Das ist exakter als eine Polygonverschneidung, kostet keine Geometrie-Bibliothek im
Bundle — und liefert nebenbei die Zahl, die unterwegs mehr wert ist als jedes Bild:
**wie viele Verstecke sind noch möglich?**

## Was die App kann

- Vollbild-Karte, auf der alles **abgedunkelt** ist, was als Versteck ausscheidet
- **Antwort eintragen**: ein Tipp auf die Fragekarte, ein Tipp auf die Antwort — die
  Fläche schrumpft sofort, und die Karte gilt zugleich als gespielt
- **Vorschau vor dem Eintragen**: an jeder Antwortmöglichkeit steht, wie viele Verstecke
  sie übrig liesse. Bei einer Frage, die den Verstecker Karten kostet, ist das der halbe
  Entschluss
- **Protokoll** aller Antworten in der Reihenfolge, in der gefragt wurde; jede einzeln
  löschbar, die Fläche wächst dann wieder
- Alle 459 bespielbaren Halte — Bahn, Metro, Tram, Bus und Fähre —, gefiltert auf die
  noch möglichen, nach Entfernung sortiert und durchsuchbar
- **Drei Basiskarten**: Standard, ÖPNV-Karte (zeigt die Linien) und Satellit
- **Fragenliste** mit allen 69 Karten, durchsuchbar, mit Zeitlimit und Kartenkosten
- **Fragen auf der Karte**: 45 der 69 Karten zeichnen, worüber sie reden, bevor man fragt
- Halte ausserhalb des Ticketgebiets (Utrecht, Alkmaar, Hilversum …) sind als
  „Aufpreis" markiert — bespielbar, aber die Fahrt dorthin kostet extra
- Eigener Standort per GPS oder von Hand gesetzt (praktisch zum Planen zu Hause und
  wenn das GPS im Zug daneben liegt); er überlebt einen Neustart

## Loslegen

```bash
npm install
npm run dev
```

Zum Testen auf dem Handy im selben WLAN:

```bash
npm run dev -- --host
```

Die **Ortung braucht HTTPS** — Ausnahme ist `localhost`. Über eine `http://192.168.x.x`-Adresse
bleibt der Standort deshalb aus; zum Testen unterwegs die Seite deployen (s. u.).

## Fragekarten

Der Reiter „Fragen" listet alle Karten aus `jetlag_questions_medium.json`, nach Kategorie
gruppiert, mit Zeitlimit und Karten-Belohnung.

Das **Häkchen-Symbol** öffnet die Antwort-Eingabe. Das **Karten-Icon** legt vorab die
Geometrie der Frage auf die Karte: worüber die Frage redet, nicht was die Antwort ist.

### Welche Frage was ausschliesst

| Kategorie | Was die Antwort ausschliesst |
|---|---|
| **Radar** | alles ausserhalb bzw. innerhalb des Kreises |
| **Thermometer** | die Hälfte jenseits der Mittelsenkrechten (s. u.) |
| **Matching** (Orte) | alle Halte mit einem anderen bzw. demselben nächsten Ort |
| **Matching** (Verwaltung) | alle Halte ausserhalb bzw. innerhalb derselben Fläche |
| **Measuring** | alle Halte, deren Abstand zum eigenen nächsten Ort auf der falschen Seite liegt |
| **Measuring** (Grenzen) | dasselbe für den Abstand zur Landes- oder Verwaltungsgrenze |
| **Tentacles** | alles ausserhalb des Kreises, und darin alles, was einem anderen Ort näher liegt |
| **Photos** u. a. | nichts — sie werden protokolliert, aber nicht ausgewertet |

Was mit den vorhandenen Daten nicht auszuwerten ist (Küstenlinie, Gewässer, Meereshöhe,
Transitlinie, Strassen, Berge), wird als „schliesst nichts aus" gekennzeichnet, statt still
durchgereicht zu werden — sonst sucht man den Fehler in der Zahl darüber.

### Das Thermometer

Die stärkste Karte im Spiel, und die billigste (der Verstecker zieht nur 2 Karten).

Gefahren wird nicht: man wählt eine **Richtung**, und der Zielpunkt liegt die
Kartendistanz davon entfernt. „Wärmer" heisst näher am Ziel als am Start — und die Menge
dieser Punkte ist genau die Halbebene jenseits der **Mittelsenkrechten**.

Die liegt auf der **halben** Strecke. Deshalb schneidet die *kürzeste* Karte am
schärfsten: bei 1 km läuft die Trennlinie 500 m neben euch durch und halbiert das Feld,
bei 15 km liegt sie 7,5 km weg und nimmt nur noch eine Ecke mit. Vom Amsterdam Centraal aus:

| Distanz | beste Richtung | Aufteilung |
|---|---|---|
| **1 km** | SW | 227 / 232 |
| 5 km | W | 200 / 259 |
| 15 km | NW | 124 / 335 |

Die Trennlinie wird beim Drehen der Richtung live auf der Karte mitgezeichnet.

### Ein Wort zu den Ortskategorien

Die Hausregel sagt: Ortskategorien werden **über Google Maps** entschieden. Die App rechnet
aber mit OpenStreetMap-Daten, und die weichen ab — `poi.json` kennt 93 „Zoos" und 1003
„Parks". Rechnerisch sind das starke Fragen (nächster Zoo teilt 227/232), praktisch ist die
Antwort unzuverlässig.

**Verlässlich sind Radar, Thermometer, die Verwaltungsebenen und die Landesgrenze** — die
sind reine Geometrie oder amtliche Daten und kennen keinen Google-Maps-Streit. Erweist sich
eine Ortsantwort als falsch, löscht man sie im Protokoll wieder heraus.

### Eine Antwort eintragen

Häkchen-Symbol an der Karte antippen. Der Dialog zeigt:

- den Fragesatz und den Bezugspunkt (euer Standort, ohne Ortung die Kartenmitte),
- beim Thermometer das Richtungsrad mit 16 Kompasspunkten,
- die Antwortmöglichkeiten als Knöpfe, **je mit der Zahl der danach noch möglichen
  Verstecke**,
- bei Tentacles die Orte im Kreis, nach Entfernung sortiert, plus „ausser Reichweite".

Ein Tipp auf die Antwort trägt sie ein, hakt die Karte ab und wechselt in den Reiter
„Suchgebiet" — dorthin, wo man jetzt hinschaut.

## Stationsdaten pflegen

```bash
npm run data            # alles neu erzeugen
npm run data:stations   # Haltestellen aus data/artt_verstecke.geojson
npm run data:area       # Spielgebiet aus der Haltestellenliste
npm run data:pois       # Orte für die Fragekarten (~2200 Objekte)
npm run data:divisions  # Verwaltungsebenen (COROP · Gemeente · Wijk · Buurt)
npm run data:borders    # Landesgrenze zu Deutschland und Belgien
npm run data:questions  # Fragekarten mit Zeichen-Metadaten
```

`data:questions` liest `jetlag_questions_medium.json` im Projektwurzelverzeichnis und
braucht `poi.json`, `stations.json` und die Dateien aus `divisions/` und `borders/`, um die
schwachen Fragen zu erkennen — also zuletzt laufen lassen (`npm run data` macht das in der
richtigen Reihenfolge).

Die Verwaltungsflächen kommen von den **CBS Gebiedsindelingen** über den PDOK-WFS
(CC BY 4.0) — eine Adresse für alle vier Ebenen, amtlich und als fertiges GeoJSON. Die
Rahmen, in denen beschafft wird, stehen gemeinsam in `scripts/lib/region.mjs` und werden
dort aus `public/data/area.geojson` gepuffert — `data:area` muss also vor `data:pois` und
`data:divisions` gelaufen sein.

Die Landesgrenze kommt aus OpenStreetMap. Der Kniff steckt in der Abfrage: ein Weg, der
zugleich zur Grenzrelation der Niederlande *und* zu der eines Nachbarlands gehört, liegt
auf der gemeinsamen Grenze — die Küste fällt damit von selbst heraus, weil sie nur zu
einer der beiden Relationen gehört.

Quelle der Halte ist `data/artt_verstecke.geojson` — die kuratierte Liste aller mit dem
Amsterdam & Region Travel Ticket erreichbaren Halte (Bahn, Metro und Fähre vollständig,
Bus und Tram auf 650 m Abstand ausgedünnt, mit den bedienenden Linien). Wer die Liste
ändern will, ändert diese Datei und lässt `npm run data:stations && npm run data:area`
laufen.

`public/data/stations.json` wird zur Laufzeit geladen und kann **direkt editiert werden,
ohne neu zu bauen**. Alle Halte der Quelle sind bespielbar. Soll einer doch nicht dabei
sein, `ticketValid: false` setzen — er verschwindet dann aus Karte und Liste.

`ticketValid` und `notes` überleben ein erneutes `npm run data`; die vorhandene Datei
wird gemerged, nicht überschrieben.

Nach dem Bearbeiten `npm run data:area` laufen lassen, damit das Spielgebiet zur
Haltestellenliste passt. Alle bespielbaren Halte zählen dafür, auch die mit `extraCost`.

## Auf dem Handy installieren

Nach dem Deploy die Seite im Browser öffnen und zum Homescreen hinzufügen (iOS: Teilen →
„Zum Home-Bildschirm"; Android: Menü → „App installieren"). Sie startet dann ohne
Browserleiste, was beim Spielen spürbar Kartenfläche spart.

Das ist reine Homescreen-Integration über `public/manifest.webmanifest` — **kein
Offline-Modus**. Ohne Netz bleibt die Karte weiss, dafür gibt es keine Service-Worker-
Cache-Fallen beim Deployen. `start_url` und die Icon-Pfade im Manifest sind relativ und
machen einen anderen Repo-Namen ohne Anpassung mit.

## Deploy

Statisches Bündel, läuft auf GitHub Pages, Netlify oder Cloudflare Pages:

```bash
npm run build     # -> dist/
npm run preview   # lokal gegenprüfen
```

Die Asset-Pfade sind **relativ** (`base: './'` in `vite.config.ts`), das Bündel läuft
deshalb unter jedem Repo-Namen, in jedem Unterverzeichnis und auch im Wurzelverzeichnis —
ohne Anpassung. Vorher stand der Repo-Name dort fest verdrahtet; jeder Fork deployte
dadurch mit 404-Fehlern auf `index-*.js` und `index-*.css`.

**HTTPS ist Pflicht**, sonst funktioniert die Ortung nicht.

## Aufbau

```
public/data/            stations.json · area.geojson · config.json
                        poi.json · questions.json      ← alle beim Start geladen
public/data/divisions/  corop · gemeente · wijk · buurt ← erst wenn eine Frage sie braucht
public/data/borders/    international.json             ← ebenso
scripts/                Datenerzeugung; scripts/lib/overpass.mjs teilen sich die Skripte
scripts/check-eliminate.mts   Gegenprobe der Auswertung (npm run check)
src/lib/eliminate.ts    aus einer Antwort wird ein Filter über den Halten  ← das Herz
src/composables/        Leaflet-Instanz, Stationsebenen, Restgebiet, Fragen-Geometrie
src/stores/game.ts      Stationen, Karte, Standort, Kandidatenmenge
src/stores/questions.ts Fragekarten, Antworten, Kartenvorschau
```

`config.json` enthält den Versteck-Radius, den Kartenausschnitt, die Liste der Basiskarten
und die Farben pro Verkehrsmittel — ohne Rebuild änderbar. Eine weitere Basiskarte
ist ein Eintrag mehr in `basemaps`; `photo: true` nimmt sie vom Entsättigungsfilter aus.

Die Karte zoomt bis Stufe 21. `maxZoom` je Basiskarte ist dabei die Stufe, bis zu der die
Quelle echte Kacheln hat (OpenStreetMap 19, ÖPNVKarte 18, Esri-Luftbild 21); darüber
skaliert Leaflet hoch, statt graue Flächen zu zeigen.

## Die Auswertung prüfen

```bash
npm run check
```

Rechnet 21 Fälle vom Amsterdam Centraal aus gegen unabhängig ermittelte Sollwerte —
je Fragetyp einen. Verrutscht eine Formel, etwa die Mittelsenkrechte des Thermometers von
der halben auf die ganze Strecke, fällt es hier auf und nicht erst beim Spielen.

Karten von [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL), Stationsdaten
ebenfalls aus OSM.
