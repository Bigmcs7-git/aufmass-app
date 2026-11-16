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

test('Winkel ausrechnen: Trapez mit zwei schrägen Ecken', async () => {
  const { winkelAusrechnen } = await import('./geo.js');
  // grob gezeichnet: oben 4,2 lang, rechts schräg nach unten links
  const { waende } = ausPunkten([[0, 0], [4.2, 0], [3.2, -3], [0, -3]]);
  waende.forEach((w, i) => { w.laenge = [4, Math.sqrt(10), 3, 3][i]; });
  const r = winkelAusrechnen(waende);
  assert.deepEqual(r.frei, [0, 1]);
  nah(waende[0].winkel, 71.565, 1e-3); nah(waende[1].winkel, 108.435, 1e-3);
  assert.equal(waende[2].winkel, 90); assert.equal(waende[3].winkel, 90);
  assert.ok(r.luecke < 1e-4, String(r.luecke));
});

test('Winkel ausrechnen: 45°-Ecke grob gezeichnet, drei und mehr schräge Ecken', async () => {
  const { winkelAusrechnen } = await import('./geo.js');
  const k = [w(3, 128), w(1.414, 142), w(2), w(4), w(3)]; // Skizze ungenau
  const r = winkelAusrechnen(k);
  nah(k[0].winkel, 135, 0.05); nah(k[1].winkel, 135, 0.05);
  assert.ok(r.luecke < 1e-3);
  // Viereck mit drei schrägen Ecken (z. B. Dachgeschoss): exakt lösbar
  const v = [w(4, 100), w(3, 85), w(3.5, 95), w(2.8)];
  const r2 = winkelAusrechnen(v);
  assert.equal(r2.frei.length, 3); assert.ok(r2.luecke < 1e-4, String(r2.luecke)); // Winkel auf 0,001° gerundet
  nah(v.reduce((s, x) => s + x.winkel, 0), 360, 1e-6);
});

test('Winkel ausrechnen: rechtwinkliger Raum bleibt bei 90°, fehlende Maße -> nichts', async () => {
  const { winkelAusrechnen } = await import('./geo.js');
  const r = [w(4), w(3), w(3.98), w(3)];
  assert.equal(winkelAusrechnen(r), null);
  assert.deepEqual(r.map(x => x.winkel), [90, 90, 90, 90]);
  assert.equal(winkelAusrechnen([w(4, 100), w(null, 80), w(4), w(3)]), null);
});

test('Vorsprung und Nische einfügen', async () => {
  const { vorsprungEinfuegen } = await import('./geo.js');
  for (const tiefe of [0.3, -0.3]) {
    const raum = { waende: [w(4), w(3), w(4), w(3)] };
    vorsprungEinfuegen(raum, 0, 0.5, tiefe);
    assert.equal(raum.waende.length, 8);
    const p = pruefen(raum.waende);
    assert.ok(p.zu, JSON.stringify(p));
    nah(p.flaeche, 12 + (tiefe > 0 ? -1 : 1) * 0.3 * 1.2, 1e-9); // Breite 0,3 × 4 m
    assert.deepEqual(p.fehlt, ['A', 'B', 'C', 'D', 'E']);
  }
});

test('PC-Plan hin und zurück: Säulen, Anschlüsse und unbekannte Felder bleiben erhalten', () => {
  const vomPc = { format: 'aufmass', version: 1, erstellt: '2026-11-18T08:00', id: 'p1', baustelle: 'Plan', planer: 'PC',
    etagen: [{ name: 'EG', dicke: 0.4, raeume: [{ name: 'Bad', hoehe: 2.5, raumart: 'bad', waende: [
      { laenge: 4, winkel: 90, mitrechnen: true, dicke: 0.115, oeffnungen: [{ art: 'tuer', abstand: 0.3, breite: 0.885, hoehe: 2.01, bruestung: 0, anschlag: 'links', typ: 'einfach' }],
        anschluesse: [{ art: 'steckdose', abstand: 1.2, hoehe: 0.3, leitung: 'oben' }, { art: 'kw', abstand: 2.5, hoehe: 0.55, leitung: '' }] },
      { laenge: 3, winkel: 90, mitrechnen: true, oeffnungen: [] },
      { laenge: 4, winkel: 90, mitrechnen: true, oeffnungen: [] },
      { laenge: 3, winkel: 90, mitrechnen: true, oeffnungen: [] }],
      notiz: '', koerper: [{ form: 'rechteck', x: 1.15, y: 2.35, b: 0.3, t: 0.3, h: null, umbauen: true, name: 'Schacht' },
                            { form: 'kreis', x: 3, y: 1, d: 0.4, h: 2.2 }] }] }] };
  assert.equal(pruefeDatei(vomPc), null);
  const b = einlesen(vomPc, 'x');
  const k = b.etagen[0].raeume[0].koerper[0];
  nah(k.s, 1, 1e-9); nah(k.a, 0.5, 1e-9); // ab Anfang von Wand A 1,00 m, von Wand A 0,50 m
  assert.deepEqual(exportieren(b, new Date(2026, 10, 18, 8, 0)), vomPc);
  assert.match(pruefeDatei({ ...vomPc, etagen: [{ name: 'EG', raeume: [{ name: 'X', waende: [], koerper: [{ form: 'kreis', x: 1, y: 1 }] }] }] }), /Säule/);
});

test('Lücke schließen: Toleranz passt das letzte Maß an, gemessenes Maß bleibt', async () => {
  const { lueckeSchliessen, wandLaenge } = await import('./geo.js');
  const raum = { waende: [w(4), w(3), w(3.998), w(3.003)] };
  let r = lueckeSchliessen(raum, 0.002);
  assert.equal(r.zustand, 'frage'); // Lücke 3,6 mm > 2 mm Toleranz
  r = lueckeSchliessen(raum, 0.005);
  assert.equal(r.zustand, 'gerundet');
  assert.deepEqual(r.korrigiert.sort(), [2, 3]); // wie am PC: letzte senkrechte und waagrechte Wand
  nah(wandLaenge(raum.waende[2]), 4, 1e-6); nah(wandLaenge(raum.waende[3]), 3, 1e-6);
  assert.equal(raum.waende[2].laenge, 3.998); // echtes Maß bleibt
  assert.ok(pruefen(raum.waende).zu);
  const d = exportieren({ id: 'x', baustelle: 'x', etagen: [{ name: 'EG', raeume: [{ name: 'R', ...raum }] }] });
  const wd = d.etagen[0].raeume[0].waende[2];
  assert.equal(wd.laenge, 4); assert.equal(wd.gemessen, 3.998);
  const zurueck = einlesen(d, 'y').etagen[0].raeume[0].waende[2];
  assert.equal(zurueck.laenge, 3.998); nah(zurueck.korrektur, 0.002, 1e-9);
  // Wahl „Winkel“: die letzten Ecken nehmen die Lücke auf, Maße bleiben
  const r2 = { waende: [w(4), w(3), w(3.95), w(3)], schluss: 'winkel' };
  const e2 = lueckeSchliessen(r2, 0);
  assert.equal(e2.zustand, 'winkel');
  assert.ok(pruefen(r2.waende).zu);
  assert.deepEqual(r2.waende.map(x => x.laenge), [4, 3, 3.95, 3]);
  // zurück auf „fragen“: Winkel wieder 90°
  r2.schluss = null;
  assert.equal(lueckeSchliessen(r2, 0).zustand, 'frage');
  assert.deepEqual(r2.waende.map(x => x.winkel), [90, 90, 90, 90]);
});

test('Warnungen: Teile außerhalb der Wand oder des Raums', async () => {
  const { warnungen } = await import('./geo.js');
  const raum = { hoehe: 2.5, waende: [
    w(4, 90, { oeffnungen: [{ art: 'tuer', abstand: 3.5, breite: 0.885, hoehe: 2.01, bruestung: 0 }], anschluesse: [{ art: 'steckdose', abstand: 4.2, hoehe: 0.3 }] }),
    w(3, 90, { oeffnungen: [{ art: 'fenster', abstand: 1, breite: 1, hoehe: 1.8, bruestung: 0.9 }] }), w(4), w(3)],
    koerper: [{ form: 'rechteck', s: 3.9, a: 1, b: 0.3, t: 0.3, h: null }, { form: 'kreis', s: 1, a: 1, d: 0.3, h: null }] };
  const t = warnungen(raum).map(x => x.ziel);
  assert.deepEqual(t, ['o-0', 'a-0', 'o-0', 'k-0']);
});

test('Eingabe in Zentimeter', () => {
  assert.equal(zahl('320,5', 'cm'), 3.205);
  assert.equal(zahl('3,205 m', 'cm'), 3.205);
  assert.equal(zahl('3205 mm', 'cm'), 3.205);
});

test('Vom PC zurück: schon gerundete Maße bleiben gerundet (auch bei kleinerer Toleranz)', async () => {
  const { lueckeSchliessen } = await import('./geo.js');
  const d = JSON.parse(readFileSync(new URL('./beispiel_voll.aufmass.json', import.meta.url), 'utf8'));
  assert.equal(pruefeDatei(d), null);
  const r = einlesen(d, 'x').etagen[0].raeume.find(q => q.name === 'Test gerundet');
  assert.equal(r.schluss, 'mass');
  assert.equal(lueckeSchliessen(r, 0.002).zustand, 'gerundet');
  assert.ok(pruefen(r.waende).zu);
});
