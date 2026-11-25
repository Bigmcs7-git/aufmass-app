# Aufmaß-App (Runde GR7)

Web-App für Chrome auf Android (Handy und Tablet): Räume skizzieren, Wände messen, als `.aufmass.json` zum PC schicken.
Das Dateiformat steht in `..\ARBEITSPLAN_Grundriss.md`, Abschnitt 3 (Version 1). Daran hält sich `geo.js` → `exportieren()`.

## Dateien
- `index.html`, `style.css`, `app.js`: Bildschirm (Baustelle → Etagen → Räume, Skizze, Maßfelder, Teilen/Einlesen)
- `geo.js`: Rechnen ohne Bildschirm (Umriss, Lücke, Winkel, Export, Prüfung beim Einlesen)
- `laser.js`: Bluetooth-Laser: Bosch GLM „C“ (Pauls GLM 150-27 C) und Leica DISTO, beide am Gerät noch ungeprüft.
- `sw.js`, `manifest.webmanifest`, `icon-*.png`: Installation und Offline-Betrieb.
  **Bei jeder neuen Version `STAND` in `sw.js` erhöhen**, sonst behalten die Handys die alte Fassung.
- `beispiel.aufmass.json`: Beispieldatei (4 Räume: Rechteck, L-Form, 45°-Ecke)
- `bilder\`: Bildschirmfotos in Handygröße

## Prüfen
```
node tests.mjs
```
Am PC ansehen: `python -m http.server 8765` in diesem Ordner, dann `http://localhost:8765` in Chrome
(F12 → Handy-Ansicht).

## Aufs Handy
Online: **https://bigmcs7-git.github.io/aufmass-app/** (GitHub Pages aus Zweig `main`, Repo Bigmcs7-git/aufmass-app, öffentlich).
Neue Version: committen, `git push`, vorher `STAND` in `sw.js` erhöhen. Die App braucht `https` (Offline, Bluetooth). Nur Code,
ohne Kundendaten. Die Daten bleiben im Handy (IndexedDB) und gehen nur über „Teilen / Exportieren“ weiter.

## Design
Verbindlich seit 24.11.2026: `..\Konzept_Bedienung\DESIGNREGELN.md` (V4-Farben als CSS-Variablen, Ecken 6 px, Knopf-Arten,
2er-/3er-Raster, nichts abgeschnitten). Die App ist noch im alten Blau – bei der nächsten Arbeit an der Oberfläche umstellen.

## Bezeichnungen wie im Grundriss-Editor am PC
Wände heißen wie am PC `Raumkürzel-W<Nr>` (z. B. `WZ-W1`): Nummer 1 ist die oberste Wand der Zeichnung
(bei gleicher Höhe die linke), dann im Uhrzeigersinn. Kürzel aus der Raumart (Wohnzimmer WZ, Bad BAD …);
gibt es ein Kürzel mehrmals, zählt die App wie der PC (`BAD1`, `BAD2`). Beim Anlegen eines Raums wird die
Raumart aus derselben Liste gewählt. Regeln: `geo.js` (`kuerzel`, `wandNummern`) = PC `bezeichnungen.py`.

## Bedienung Skizze und Anschlüsse (25.11.2026)
- Wand in der Skizze einmal antippen = wählen (Messing) und Stelle setzen: dort **Ecke, Vorsprung, Nische** einfügen
  oder **Wandart** wählen. Doppelt antippen = Wandansicht öffnen.
- **Wandarten** wie im Grundriss-Editor (`wandart`, `dicke` je Wand, PC-Feld `WAND_EXTRA`): Außenwand, Tragende Wand,
  Halbsteinwand, Trockenbauwand (hellblau), Raumgrenze (keine Wand, keine Wandfläche). Auch beim Zeichnen wählbar.
- **Automatisch schließen**: fehlen 1–2 Maße, rechnet die App sie aus (`errechnet`, grün, zieht bei Änderungen nach);
  alle gemessen und kleine Lücke: letztes Maß anpassen; sonst Schlusswand einfügen.
- Feld in Bearbeitung → Teil in der Zeichnung messingfarben.
- Anschlüsse klappen nach dem Anlegen zu einer Zeile zusammen; `fach` (Mehrfachdose 1–5, wie Elektro am PC);
  `leitung` = oben | unten | links | rechts (Pfeil in der Ansicht). **PC liest bisher nur oben/unten und kein `fach`.**
