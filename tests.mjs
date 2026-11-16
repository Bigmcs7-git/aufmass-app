// Selbstprüfung ohne Zusatzprogramme: node tests.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { punkte, pruefen, ausPunkten, wandLoeschen, eckeEinfuegen, zahl, exportieren, pruefeDatei, einlesen, name } from './geo.js';

const w = (laenge, winkel = 90, mehr = {}) => ({ laenge, winkel, mitrechnen: true, oeffnungen: [], ...mehr });
const nah = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('Rechteck 4 × 3 schließt, Fläche 12', () => {
  const r = pruefen([w(4), w(3), w(4), w(3)]);
  assert.ok(r.zu); nah(r.flaeche, 12);
  // Wand A nach rechts, B nach unten (Uhrzeigersinn, y nach oben)
  assert.deepEqual(punkte([w(4), w(3)]).map(p => p.map(v => Math.round(v * 1000) / 1000)), [[0, 0], [4, 0], [4, -3]]);
});

test('L-Form mit vorspringender Ecke (270°)', () => {
  // 5 × 4, rechts oben 2 × 2 ausgespart
  const l = [w(3), w(2, 270), w(2), w(2), w(5), w(4)];
  const r = pruefen(l);
  assert.ok(r.zu, JSON.stringify(r)); nah(r.flaeche, 16);
});

test('45°-Ecke (abgeschrägte Ecke, zwei Ecken 135°)', () => {
  const s = Math.SQRT2;
  const r = pruefen([w(3, 135), w(s, 135), w(2), w(4), w(3)]);
  assert.ok(r.zu, JSON.stringify(r)); nah(r.flaeche, 12 - 0.5, 1e-9);
});

test('Lücke wird gemeldet', () => {
  const r = pruefen([w(4), w(3), w(3.8), w(3)]);
  assert.ok(!r.zu); nah(r.luecke, 0.2, 1e-9);
  assert.deepEqual(pruefen([w(4), w(null, 90, { skizze: 3 }), w(4), w(3)]).fehlt, ['B']);
});

test('Skizze gegen den Uhrzeigersinn wird umgedreht, Winkel stimmen', () => {
  const { waende } = ausPunkten([[0, 0], [4, 0], [4, 3], [0, 3]]); // links herum (gegen den Uhrzeigersinn) gezeichnet
  assert.deepEqual(waende.map(x => x.winkel), [90, 90, 90, 90]);
  assert.deepEqual(waende.map(x => x.skizze), [3, 4, 3, 4]); // umgedreht: zuerst nach oben
  const l = ausPunkten([[0, 0], [3, 0], [3, -2], [5, -2], [5, -4], [0, -4]]).waende;
  assert.deepEqual(l.map(x => x.winkel), [90, 270, 90, 90, 90, 90]);
  const sch = ausPunkten([[0, 0], [3, 0], [4, -1], [4, -3], [0, -3]]).waende;
  assert.deepEqual(sch.map(x => x.winkel), [135, 135, 90, 90, 90]);
});

test('Wand löschen und Ecke einfügen', () => {
  const raum = { waende: [w(4), w(3), w(4), w(3)], drehung: 0 };
  eckeEinfuegen(raum, 0, 0.5);
  assert.equal(raum.waende.length, 5);
  raum.waende[0].laenge = raum.waende[1].laenge = 2;
  assert.ok(pruefen(raum.waende).zu);
  wandLoeschen(raum, 1); // Wand B (zweite Hälfte von A) weg: Lücke 2 m
  nah(pruefen(raum.waende).luecke, 2, 1e-9);
  const q = { waende: [w(4), w(3), w(4), w(3)], drehung: 0 };
  wandLoeschen(q, 0);
  assert.equal(q.drehung, -90); // neue Wand A zeigt wie vorher B nach unten
  assert.deepEqual(q.waende.map(x => x.winkel), [90, 90, 360]); // Kehrtwende: Benutzer muss neu messen
});

test('Eingabe vom Laser im Tastaturmodus', () => {
  assert.equal(zahl('3,205'), 3.205);
  assert.equal(zahl('3.205 m'), 3.205);
  assert.equal(zahl('320,5cm'), 3.205);
  assert.equal(zahl('3205 mm'), 3.205);
  assert.equal(zahl(''), null);
  assert.ok(Number.isNaN(zahl('abc')));
  assert.equal(name(0), 'A'); assert.equal(name(26), 'AA');
});

const baustelle = {
  id: 'x', baustelle: 'Musterstraße 1',
  etagen: [{ name: 'EG', raeume: [
    { name: 'Bad', hoehe: 2.5, notiz: '', drehung: 30, waende: [
      w(3.2, 90, { skizze: 3, oeffnungen: [{ art: 'tuer', abstand: 0.3, breite: 0.885, hoehe: 2.01, bruestung: 0 }] }),
      w(2.1), w(3.2), w(null, 90, { mitrechnen: false, skizze: 2 })] },
    { name: 'Flur', hoehe: null, notiz: 'offen', waende: [w(4), w(3), w(4), w(3)] }] }],
};

test('Export entspricht genau Abschnitt 3', () => {
  const d = exportieren(baustelle, new Date(2026, 10, 20, 14, 30));
  assert.equal(pruefeDatei(d), null);
  assert.deepEqual(Object.keys(d), ['format', 'version', 'erstellt', 'id', 'baustelle', 'etagen']);
  assert.equal(d.erstellt, '2026-11-20T14:30');
  const [bad, flur] = d.etagen[0].raeume;
  assert.deepEqual(Object.keys(bad), ['name', 'hoehe', 'waende', 'notiz']);
  assert.deepEqual(Object.keys(flur), ['name', 'waende', 'notiz']); // Höhe fehlt erlaubt
  assert.deepEqual(Object.keys(bad.waende[0]), ['laenge', 'winkel', 'mitrechnen', 'oeffnungen']);
  assert.deepEqual(Object.keys(bad.waende[0].oeffnungen[0]), ['art', 'abstand', 'breite', 'hoehe', 'bruestung']);
  assert.equal(bad.waende[3].laenge, null);
  assert.equal(bad.waende[3].skizze, 2); // ungemessen: Skizzenlänge geht mit, gemessen nicht
  assert.equal('skizze' in bad.waende[0], false);
  assert.equal(bad.waende[3].mitrechnen, false);
  // Hin und zurück ändert nichts
  assert.deepEqual(exportieren(einlesen(d, 'y'), new Date(2026, 10, 20, 14, 30)), d);
});

test('Beispieldatei aus dem Plan und beispiel.aufmass.json sind gültig', () => {
  const plan = {"format": "aufmass", "version": 1, "erstellt": "2026-11-20T14:30", "baustelle": "frei wählbarer Name",
    "etagen": [{"name": "EG", "raeume": [{"name": "Bad", "hoehe": 2.50, "waende": [{"laenge": 3.20, "winkel": 90, "mitrechnen": true,
      "oeffnungen": [{"art": "tuer", "abstand": 0.30, "breite": 0.885, "hoehe": 2.01, "bruestung": 0.0}]}], "notiz": ""}]}]};
  assert.equal(pruefeDatei(plan), null);
  const bsp = JSON.parse(readFileSync(new URL('./beispiel.aufmass.json', import.meta.url), 'utf8'));
  assert.equal(pruefeDatei(bsp), null);
  for (const r of bsp.etagen.flatMap(e => e.raeume)) assert.ok(pruefen(r.waende).zu, r.name);
});

test('Ungültige Dateien werden abgewiesen', () => {
  assert.match(pruefeDatei({ format: 'x' }), /Keine/);
  assert.match(pruefeDatei({ format: 'aufmass', version: 2 }), /Version/);
  const d = exportieren(baustelle);
  d.etagen[0].raeume[0].waende[0].winkel = 400;
  assert.match(pruefeDatei(d), /Winkel/);
});

test('Bosch GLM: Messwert aus dem Bluetooth-Rahmen lesen', async () => {
  const { boschWert } = await import('./laser.js');
  const b = new DataView(new ArrayBuffer(16));
  [0xc0, 0x55, 0x10, 0x06].forEach((v, i) => b.setUint8(i, v));
  b.setFloat32(7, 1.825, true);
  nah(boschWert(b), 1.825, 1e-6);
  assert.equal(boschWert(new DataView(new Uint8Array([0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a]).buffer)), null); // Antwort ohne Messung
  b.setUint8(0, 0x00);
  assert.equal(boschWert(b), null);
});

test('Abgleich PC ↔ Handy: id bleibt, Skizzenlänge aus der PC-Datei', () => {
  const vomPc = { format: 'aufmass', version: 1, erstellt: '2026-11-18T08:00', id: 'pc-123', baustelle: 'Vorbereitet am PC',
    etagen: [{ name: 'EG', raeume: [{ name: 'Bad', waende: [
      { laenge: null, winkel: 90, skizze: 3.2 }, { laenge: null, winkel: 90, skizze: 2.1 },
      { laenge: null, winkel: 90, skizze: 3.2 }, { laenge: null, winkel: 90, skizze: 2.1 }] }] }] };
  assert.equal(pruefeDatei(vomPc), null);
  const b = einlesen(vomPc, 'neu');
  assert.equal(b.id, 'pc-123');
  const r = b.etagen[0].raeume[0];
  assert.deepEqual(pruefen(r.waende).fehlt, ['A', 'B', 'C', 'D']);
  nah(pruefen(r.waende).flaeche, 3.2 * 2.1, 1e-9); // Skizze hat die Form vom PC
  r.waende.forEach((w, i) => { w.laenge = [3.21, 2.12, 3.21, 2.12][i]; }); // auf der Baustelle gemessen
  const zurueck = exportieren(b);
  assert.equal(zurueck.id, 'pc-123');
  assert.deepEqual(zurueck.etagen[0].raeume[0].waende.map(w => w.laenge), [3.21, 2.12, 3.21, 2.12]);
  assert.ok(zurueck.etagen[0].raeume[0].waende.every(w => !('skizze' in w)));
  assert.equal(einlesen({ ...vomPc, id: undefined }, 'neu').id, 'neu'); // Datei ohne id: neue Baustelle
  assert.match(pruefeDatei({ ...vomPc, id: 5 }), /Kennung/);
});
