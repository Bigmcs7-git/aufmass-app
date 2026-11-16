# Aufmaß-App (Runde GR7)

Web-App für Chrome auf Android (Handy und Tablet): Räume skizzieren, Wände messen, als `.aufmass.json` zum PC schicken.
Das Dateiformat steht in `..\ARBEITSPLAN_Grundriss.md`, Abschnitt 3 (Version 1). Daran hält sich `geo.js` → `exportieren()`.

## Dateien
- `index.html`, `style.css`, `app.js`: Bildschirm (Baustelle → Etagen → Räume, Skizze, Maßfelder, Teilen/Einlesen)
- `geo.js`: Rechnen ohne Bildschirm (Umriss, Lücke, Winkel, Export, Prüfung beim Einlesen)
- `laser.js`: Bluetooth-Laser (zunächst Leica DISTO, ungeprüft). Der Tastaturmodus des Lasers geht immer.
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
Die App braucht eine `https`-Adresse (wegen Offline und Bluetooth). Vorschlag: GitHub Pages, nur dieser Ordner,
ohne Kundendaten. Die Daten bleiben im Handy (IndexedDB) und gehen nur über „Teilen / Exportieren“ weiter.
