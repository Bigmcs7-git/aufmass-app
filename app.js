// Bildschirm der Aufmaß-App: Baustellen → Etagen → Räume, Skizze, Maßfelder, Wandansicht, Export/Import.
import * as G from './geo.js';
import * as Laser from './laser.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const de = (v, n = 2) => v.toFixed(n).replace('.', ',');

// ---------- Einheit (je Gerät) und Zahlen ----------
const merken = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privates Fenster: dann nur für diese Sitzung */ } };
let einheit = (() => { try { return localStorage.getItem('einheit') || 'm'; } catch { return 'm'; } })();
/** Maß zum Anzeigen: Meter immer mit 2 Nachkommastellen (3 bei Millimetern), Zentimeter mit höchstens einer. */
const massText = v => v == null ? '' : einheit === 'cm'
  ? String(+(v * 100).toFixed(1)).replace('.', ',')
  : (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6 ? v.toFixed(3) : v.toFixed(2)).replace('.', ',');
const rohText = v => v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ','); // Winkel, Laibung in cm
const lies = (text, roh) => G.zahl(text, roh ? 'm' : einheit);
const tol = b => b.toleranz ?? 0.002; // Standard: Lücken bis 2 mm schließt die App selbst (letztes Maß wird gerundet)
const einheitKnopf = $('#einheit');
einheitKnopf.textContent = einheit;
einheitKnopf.onclick = () => { einheit = einheit === 'm' ? 'cm' : 'm'; einheitKnopf.textContent = einheit; merken('einheit', einheit); zeigen(); };

// ---------- Speicher im Gerät (IndexedDB) ----------
let db, alle = [];
const dbAuf = () => new Promise((ok, nein) => {
  const r = indexedDB.open('aufmass', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('baustellen', { keyPath: 'id' });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => nein(r.error);
});
const tx = (modus, f) => new Promise((ok, nein) => {
  const t = db.transaction('baustellen', modus), r = f(t.objectStore('baustellen'));
  t.oncomplete = () => ok(r.result);
  t.onerror = () => nein(t.error);
});
const speichern = b => { b.geaendert = Date.now(); return tx('readwrite', s => s.put(b)).catch(e => alert('Speichern fehlgeschlagen: ' + e)); };
const entfernen = b => { alle = alle.filter(x => x !== b); return tx('readwrite', s => s.delete(b.id)); };

// ---------- Seitenwechsel über die Adresse (#b/id, #r/id/e/r, #w/id/e/r/wand/stelle/teil), damit die Zurück-Taste geht ----------
const ort = () => location.hash.slice(1).split('/').map(decodeURIComponent);
const geh = (...teile) => { location.hash = teile.map(t => encodeURIComponent(t ?? '')).join('/'); };
function zeigen() {
  const [art, id, e, r, i, anteil, sel] = ort();
  const b = alle.find(x => x.id === id);
  zeichnen = null;
  app.onchange = app.onclick = null;
  if (art === 'w' && b?.etagen[e]?.raeume[r]?.waende[i]) wandSeite(b, +e, +r, +i, anteil ? +anteil : null, sel || null);
  else if (art === 'r' && b?.etagen[e]?.raeume[r]) raumSeite(b, +e, +r);
  else if (art === 'b' && b) baustelleSeite(b);
  else startSeite();
}
addEventListener('hashchange', () => { scrollTo(0, 0); zeigen(); }); // erst nach oben, dann darf die Seite ein Feld zeigen
$('#zurueck').onclick = () => {
  const [art, id, e, r] = ort();
  art === 'w' ? geh('r', id, e, r) : art === 'r' ? geh('b', id) : geh('');
};
const kopf = (titel, zurueck = true) => { $('#titel').textContent = titel; $('#zurueck').style.visibility = zurueck ? '' : 'hidden'; };
const frage = (text, vorgabe = '') => { const t = prompt(text, vorgabe); return t == null ? null : t.trim() || null; };

// ---------- Start: Baustellen ----------
function startSeite() {
  kopf('Aufmaß', false);
  alle.sort((a, b) => (b.geaendert || 0) - (a.geaendert || 0));
  app.innerHTML = `
    <div class="reihe"><button class="haupt" id="neu">+ Neue Baustelle</button></div>
    <ul class="liste">${alle.map(b => `<li><a href="#b/${encodeURIComponent(b.id)}">${esc(b.baustelle)}</a>
      <span class="hinweis" style="flex:0">${b.etagen.reduce((n, e) => n + e.raeume.length, 0)}&nbsp;Räume</span></li>`).join('')
      || '<li><span class="hinweis">Noch keine Baustelle angelegt.</span></li>'}</ul>
    <div class="reihe"><label class="knopf">Aufmaß-Datei öffnen<input type="file" id="datei" accept=".json,application/json" hidden></label></div>
    <p class="hinweis">Alle Daten bleiben auf diesem Gerät. Zum PC kommen sie nur über „Teilen / Exportieren“ in der Baustelle.</p>`;
  $('#neu').onclick = async () => {
    const n = frage('Name der Baustelle (z. B. Kunde, Straße):');
    if (!n) return;
    const b = { id: crypto.randomUUID(), baustelle: n, etagen: [{ name: 'EG', raeume: [] }] };
    alle.push(b);
    await speichern(b);
    geh('b', b.id);
  };
  $('#datei').onchange = e => einlesen(e.target.files[0]);
}

async function einlesen(datei) {
  if (!datei) return;
  let d;
  try { d = JSON.parse(await datei.text()); } catch { return alert('Die Datei ist keine Aufmaß-Datei (kein JSON).'); }
  const fehler = G.pruefeDatei(d);
  if (fehler) return alert('Datei kann nicht gelesen werden: ' + fehler);
  const b = G.einlesen(d, crypto.randomUUID());
  const alt = alle.find(x => x.id === b.id);
  if (alt) {
    // Abgleich: dieselbe Baustelle kommt vom PC oder einem anderen Gerät zurück
    const stand = alt.geaendert ? new Date(alt.geaendert).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '?';
    if (!confirm(`„${alt.baustelle}“ ist schon auf diesem Gerät (zuletzt geändert ${stand}).\n`
      + `Durch die Datei vom ${d.erstellt.replace('T', ' ')} ersetzen? Änderungen hier seit dem Export gehen dabei verloren.`)) return;
    alle = alle.filter(x => x !== alt);
  }
  alle.push(b);
  await speichern(b);
  geh('b', b.id);
}

// ---------- Baustelle: Etagen und Räume ----------
function raumInfo(b, r) {
  if (!r.waende.length) return 'noch keine Skizze';
  G.lueckeSchliessen(r, tol(b));
  const p = G.pruefen(r.waende), warn = G.warnungen(r).length;
  if (p.fehlt.length) return `Maß fehlt: ${p.fehlt.join(', ')}`;
  return (p.zu ? `${de(p.flaeche)} m²` : `Lücke ${massText(p.luecke)} ${einheit}`) + (warn ? ` · ⚠ ${warn}` : '');
}
const TOLERANZEN = [[0, 'aus (immer fragen)'], [0.001, '1 mm'], [0.002, '2 mm'], [0.005, '5 mm'], [0.01, '1 cm']];

function baustelleSeite(b) {
  kopf(b.baustelle);
  const t = tol(b), frei = !TOLERANZEN.some(([v]) => Math.abs(v - t) < 1e-9);
  app.innerHTML = b.etagen.map((e, ei) => `
    <section class="etage"><h2><span>${esc(e.name)}</span>
      <button class="klein" data-a="etage-name" data-e="${ei}" aria-label="Etage umbenennen">✎</button>
      <button class="klein weg" data-a="etage-weg" data-e="${ei}" aria-label="Etage löschen">🗑</button></h2>
      <ul class="liste">${e.raeume.map((r, ri) => `<li>
        <a href="#r/${encodeURIComponent(b.id)}/${ei}/${ri}">${esc(r.name)}&nbsp;<span class="hinweis">· ${raumInfo(b, r)}</span></a>
        <button class="klein" data-a="raum-name" data-e="${ei}" data-r="${ri}" aria-label="Raum umbenennen">✎</button>
        <button class="klein weg" data-a="raum-weg" data-e="${ei}" data-r="${ri}" aria-label="Raum löschen">🗑</button></li>`).join('')}</ul>
      <div class="reihe"><button data-a="raum-neu" data-e="${ei}">+ Raum</button></div>
    </section>`).join('') + `
    <div class="reihe"><button data-a="etage-neu">+ Etage</button></div>
    <label class="feld" style="grid-template-columns:1fr 170px">Toleranz: kleine Lücken selbst schließen
      <select id="toleranz">${TOLERANZEN.map(([v, n]) => `<option value="${v}" ${!frei && Math.abs(v - t) < 1e-9 ? 'selected' : ''}>${n}</option>`).join('')}
        <option value="frei" ${frei ? 'selected' : ''}>${frei ? `frei: ${de(t * 1000, 0)} mm` : 'frei eingeben …'}</option></select></label>
    <p class="hinweis">Bleibt nach allen Maßen eine Lücke bis zu dieser Größe, rundet die App das letzte Maß (gekennzeichnet, das gemessene Maß bleibt gespeichert). Größere Lücken fragt sie nach.</p>
    <div class="reihe"><button class="haupt" data-a="teilen">Teilen / Exportieren</button></div>
    <div class="reihe"><button data-a="name">Baustelle umbenennen</button><button class="weg" data-a="weg">Baustelle löschen</button></div>`;
  $('#toleranz').onchange = ev => {
    let v = ev.target.value;
    if (v === 'frei') {
      const t = frage('Toleranz in Millimeter (z. B. 3):', de(tol(b) * 1000, 0));
      v = t == null ? tol(b) : G.zahl(t, 'mm');
      if (!Number.isFinite(v) || v < 0 || v > 0.05) { alert('Bitte 0 bis 50 mm eingeben.'); v = tol(b); }
    }
    b.toleranz = +v;
    speichern(b);
    baustelleSeite(b);
  };
  app.onclick = async ev => {
    const k = ev.target.closest('button[data-a]');
    if (!k) return;
    const e = b.etagen[k.dataset.e], r = e?.raeume[k.dataset.r];
    let n;
    switch (k.dataset.a) {
      case 'etage-neu': if ((n = frage('Name der Etage (z. B. KG, EG, OG, DG):'))) b.etagen.push({ name: n, raeume: [] }); break;
      case 'etage-name': if ((n = frage('Neuer Name der Etage:', e.name))) e.name = n; break;
      case 'etage-weg': if (!confirm(`Etage „${e.name}“ mit ${e.raeume.length} Räumen löschen?`)) return; b.etagen.splice(k.dataset.e, 1); break;
      case 'raum-neu':
        if (!(n = frage('Name des Raums (z. B. Bad, Flur):'))) return;
        e.raeume.push({ name: n, hoehe: null, notiz: '', drehung: 0, waende: [], koerper: [] });
        await speichern(b);
        return geh('r', b.id, k.dataset.e, e.raeume.length - 1);
      case 'raum-name': if ((n = frage('Neuer Name des Raums:', r.name))) r.name = n; break;
      case 'raum-weg': if (!confirm(`Raum „${r.name}“ löschen?`)) return; e.raeume.splice(k.dataset.r, 1); break;
      case 'name': if ((n = frage('Neuer Name der Baustelle:', b.baustelle))) b.baustelle = n; break;
      case 'weg':
        if (!confirm(`Baustelle „${b.baustelle}“ ganz löschen? Das geht nicht rückgängig.`)) return;
        await entfernen(b);
        return geh('');
      case 'teilen': return teilen(b);
    }
    await speichern(b);
    baustelleSeite(b);
  };
}

async function teilen(b) {
  b.etagen.forEach(e => e.raeume.forEach(r => G.lueckeSchliessen(r, tol(b)))); // Stand der Toleranz übernehmen
  const name = (b.baustelle.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'aufmass') + '.aufmass.json';
  const datei = new File([JSON.stringify(G.exportieren(b), null, 1)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [datei] })) {
    try { return await navigator.share({ files: [datei], title: name }); } catch (e) { if (e.name === 'AbortError') return; }
  }
  // Android lässt manche Dateiarten nicht teilen: dann landet sie unter „Downloads“
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(datei), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- Gemeinsam: Zahlenfelder, Lage der Wände ----------
let letztesFeld = null;
let aktiv = null; // {b, raum, e, r}

/** Zahlenfelder mit data-ziel: Enter = übernehmen und nächstes Feld (auch für den Laser im Tastaturmodus).
 *  data-roh = ohne Einheit (Grad, cm), data-still = wird beim Weiterspringen übersprungen. */
function zahlFelder(wurzel, schreiben, nachher) {
  const felder = () => [...wurzel.querySelectorAll('input[data-ziel]')];
  felder().forEach(f => {
    const roh = f.hasAttribute('data-roh');
    f._uebernehmen = () => {
      const v = lies(f.value, roh), ok = !Number.isNaN(v) && schreiben(f.dataset.ziel, v);
      f.classList.toggle('falsch', !ok);
      if (ok) { if (v != null) f.value = roh ? rohText(v) : massText(v); speichern(aktiv.b); nachher(); }
      return ok;
    };
    f._weiter = () => { const l = felder(), n = l.slice(l.indexOf(f) + 1).find(x => !x.hasAttribute('data-still')); n ? n.focus() : f.blur(); };
    f.onfocus = () => { letztesFeld = f; f.select(); };
    f.onchange = () => f._uebernehmen();
    f.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (f._uebernehmen()) f._weiter(); } };
  });
}
const zfeld = (ziel, v, label, mehr = '') => `<label><small>${label}</small><input data-ziel="${ziel}" inputmode="decimal" enterkeyhint="next" value="${massText(v)}" ${mehr}></label>`;

/** Wo liegt die Wand in der Skizze? (Raum im Uhrzeigersinn: Wand nach rechts = oben) */
const LAGEN = ['oben', 'oben links', 'links', 'unten links', 'unten', 'unten rechts', 'rechts', 'oben rechts'];
function lage(raum, i) {
  const P = G.punkte(raum.waende, raum.drehung ?? 0), [a, c] = [P[i], P[i + 1]];
  const w = Math.atan2(c[1] - a[1], c[0] - a[0]) * 180 / Math.PI;
  return LAGEN[((Math.round(w / 45) % 8) + 8) % 8];
}

// Laser: Wert ins zuletzt gewählte Maßfeld, dann weiter
function laserWert(m) {
  const f = letztesFeld?.isConnected ? letztesFeld : app.querySelector('input.leer');
  if (!f?._uebernehmen) return;
  f.value = massText(m);
  if (f._uebernehmen()) f._weiter();
}
if (Laser.moeglich()) {
  const k = $('#laser');
  k.hidden = false;
  let verbindung = null;
  k.onclick = async () => {
    if (verbindung) { verbindung.trennen(); return; }
    try {
      verbindung = await Laser.verbinden(laserWert, () => { verbindung = null; k.classList.remove('an'); k.textContent = 'Laser'; });
      k.classList.add('an');
      k.textContent = 'Laser ✓';
    } catch (e) {
      if (e.name !== 'NotFoundError') alert('Laser nicht verbunden: ' + e.message);
    }
  };
}

// ---------- Raum: Skizze und Maße ----------
let zeichnen = null; // {pkt: [[x, y] …] im Zeichenfeld (y nach unten), zug: Vorschaupunkt beim Ziehen}

function raumSeite(b, e, r) {
  const raum = b.etagen[e].raeume[r];
  aktiv = { b, raum, e, r };
  raum.koerper ??= [];
  kopf(`${b.etagen[e].name} · ${raum.name}`);
  if (!raum.waende.length) zeichnen = { pkt: [], zug: null };
  app.innerHTML = `
    <svg id="skizze" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="reihe" id="zknoepfe"></div>
    <div id="status"></div>
    <label class="feld">Raumhöhe (${einheit})<input data-feld="hoehe" inputmode="decimal" enterkeyhint="next" value="${massText(raum.hoehe)}" class="${raum.hoehe == null ? 'leer' : ''}"></label>
    <div id="masse">${raum.waende.map((w, i) => `<div class="mass">
      <button class="klein wbtn" data-wand="${i}"><b>${G.name(i)}</b><small>${lage(raum, i)}</small></button>
      <input data-feld="l" data-i="${i}" inputmode="decimal" enterkeyhint="next" aria-label="Länge Wand ${G.name(i)}"
             placeholder="≈ ${massText(w.skizze ?? 1)}" value="${massText(w.laenge)}" class="${w.laenge == null ? 'leer' : ''}">
      <span>${einheit}</span>
      <input data-feld="w" data-i="${i}" inputmode="decimal" tabindex="-1" aria-label="Winkel Ecke nach ${G.name(i)}" value="${rohText(w.winkel)}">
      <span>°</span><small class="ger" id="ger-${i}"></small></div>`).join('')}</div>
    ${raum.waende.length ? `<p class="hinweis">Maß in der Zeichnung oder Feld antippen, messen, Enter: das nächste Feld ist dran.
      Winkel = Ecke am Ende der Wand (90 normal, 270 vorspringend); schräge Ecken rechnet die App aus, sobald alle Wände gemessen sind (grün).
      Wand in der Zeichnung oder Buchstabe antippen: Wandansicht mit Türen, Fenstern, Anschlüssen.</p>
      <div class="reihe"><button class="haupt" id="r-waende">Wände der Reihe nach bemaßen</button></div>
      <h3>Säulen und Körper</h3>
      <p class="hinweis">Lage: „ab Ecke“ = entlang Wand A ab ihrem Anfang bis zur Säule, „von A“ = quer von Wand A bis zur Säule.</p>
      ${raum.koerper.map((k, j) => `<div class="oe" id="k-${j}">
        <select data-form="${j}"><option value="rechteck" ${k.form === 'rechteck' ? 'selected' : ''}>Säule eckig</option><option value="kreis" ${k.form === 'kreis' ? 'selected' : ''}>Säule rund</option></select>
        <button class="klein weg" data-kweg="${j}" aria-label="löschen">✕</button>
        ${zfeld(`${j}.s`, k.s, 'ab Ecke')}${zfeld(`${j}.a`, k.a, 'von A')}
        ${k.form === 'kreis' ? zfeld(`${j}.d`, k.d, 'Ø') : zfeld(`${j}.b`, k.b, 'Breite') + zfeld(`${j}.t`, k.t, 'Tiefe')}
        ${zfeld(`${j}.h`, k.h, 'Höhe', 'placeholder="Decke"')}
        <label class="breit"><small>Name</small><input data-kname="${j}" value="${esc(k.name || '')}" placeholder="z. B. Schacht"></label>
        <label class="breit haken"><input type="checkbox" data-kumbau="${j}" ${k.umbauen ? 'checked' : ''}> mit Trockenbau umkleiden</label></div>`).join('')}
      <div class="reihe"><button id="r-saeule">+ Säule / Körper</button></div>` : ''}
    <label>Notiz<textarea id="notiz" rows="2">${esc(raum.notiz)}</textarea></label>`;
  $('#notiz').onchange = ev => { raum.notiz = ev.target.value; speichern(b); };
  app.querySelectorAll('button[data-wand]').forEach(k => { k.onclick = () => geh('w', b.id, e, r, k.dataset.wand); });
  if (raum.waende.length) {
    $('#r-waende').onclick = () => geh('w', b.id, e, r, 0);
    $('#r-saeule').onclick = () => { raum.koerper.push({ form: 'rechteck', s: 0.5, a: 0.5, b: 0.3, t: 0.3, h: null }); speichern(b); raumSeite(b, e, r); };
    app.querySelectorAll('[data-kweg]').forEach(k => { k.onclick = () => { raum.koerper.splice(k.dataset.kweg, 1); speichern(b); raumSeite(b, e, r); }; });
    app.querySelectorAll('[data-form]').forEach(f => { f.onchange = () => {
      const k = raum.koerper[f.dataset.form];
      k.form = f.value;
      if (k.form === 'kreis') k.d ??= k.b ?? 0.3; else { k.b ??= k.d ?? 0.3; k.t ??= k.d ?? 0.3; }
      speichern(b); raumSeite(b, e, r);
    }; });
    app.querySelectorAll('[data-kname]').forEach(f => { f.onchange = () => { raum.koerper[f.dataset.kname].name = f.value.trim(); speichern(b); }; });
    app.querySelectorAll('[data-kumbau]').forEach(f => { f.onchange = () => { raum.koerper[f.dataset.kumbau].umbauen = f.checked; speichern(b); }; });
    zahlFelder(app, (ziel, v) => {
      const [j, k] = ziel.split('.');
      if (k === 'h') { if (v != null && v >= 100) return false; raum.koerper[j].h = v; return true; }
      if (v == null || v >= 100 || (['b', 't', 'd'].includes(k) && v <= 0)) return false;
      raum.koerper[j][k] = v;
      return true;
    }, zeichnenNeu);
  }
  app.querySelectorAll('input[data-feld]').forEach(f => {
    f._uebernehmen = () => uebernehmen(f);
    f._weiter = () => weiter(f);
    f.onfocus = () => { if (f.dataset.feld !== 'w') letztesFeld = f; f.select(); };
    f.onchange = () => uebernehmen(f);
    f.onkeydown = ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      if (uebernehmen(f)) weiter(f);
    };
  });
  $('#status').onclick = ev => {
    const k = ev.target.closest('[data-schluss],[data-warn]');
    if (!k) return;
    if (k.dataset.schluss != null) { raum.schluss = k.dataset.schluss || null; speichern(b); zeichnenNeu(); return; }
    const [wand, ziel] = k.dataset.warn.split(':');
    if (wand !== '') return geh('w', b.id, e, r, wand, '', ziel);
    const f = app.querySelector(`#${ziel} input`);
    if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
  };
  skizzeEinrichten();
  zeichnenNeu();
}

/** Feld lesen und in den Raum schreiben. false = ungültige Eingabe (Feld bleibt rot). */
function uebernehmen(f) {
  const { b, raum } = aktiv, winkel = f.dataset.feld === 'w';
  const v = lies(f.value, winkel);
  const ok = !Number.isNaN(v) && (winkel ? v != null && v > 0 && v < 360 : v == null || (v > 0 && v < 100));
  f.classList.toggle('falsch', !ok);
  if (!ok) return false;
  if (f.dataset.feld === 'hoehe') { G.hoeheSetzen(raum, v); f.classList.toggle('leer', v == null); }
  else if (f.dataset.feld === 'l') { G.laengeSetzen(raum.waende[f.dataset.i], v); f.classList.toggle('leer', v == null); }
  else raum.waende[f.dataset.i].winkel = raum.waende[f.dataset.i].skizzeWinkel = v; // neuer Ausgangswert
  if (v != null) f.value = winkel ? rohText(v) : massText(v);
  speichern(b);
  zeichnenNeu();
  return true;
}

/** Nach Enter: Höhe → Wand A → B → … (Winkel nur, wenn man sie antippt). */
function weiter(f) {
  const n = aktiv.raum.waende.length;
  const i = f.dataset.feld === 'hoehe' ? 0 : +f.dataset.i + 1;
  const naechstes = i < n && app.querySelector(`input[data-feld="l"][data-i="${i}"]`);
  naechstes ? naechstes.focus() : f.blur();
}

// ---------- Skizze ----------
const svg = () => $('#skizze');
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attr, text) => {
  const x = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attr)) x.setAttribute(k, v);
  if (text != null) x.textContent = text;
  return x;
};
function svgPunkt(ev, s = svg()) {
  const p = s.createSVGPoint();
  p.x = ev.clientX; p.y = ev.clientY;
  const q = p.matrixTransform(s.getScreenCTM().inverse());
  return [q.x, q.y];
}

const RASTER_WINKEL = 10; // Grad: so nah an 45/90° rastet die Wand ein
function einrasten(p) {
  const pk = zeichnen.pkt, a = pk.at(-1);
  if (pk.length >= 3 && Math.hypot(p[0] - pk[0][0], p[1] - pk[0][1]) < 0.5) return pk[0];
  let w = Math.atan2(p[1] - a[1], p[0] - a[0]) * 180 / Math.PI;
  const bezug = pk.length >= 2 ? Math.atan2(a[1] - pk.at(-2)[1], a[0] - pk.at(-2)[0]) * 180 / Math.PI : 0;
  const rel = w - bezug, k = Math.round(rel / 45) * 45;
  if (Math.abs(rel - k) < RASTER_WINKEL) w = bezug + k;
  const l = Math.max(0.1, Math.round(Math.hypot(p[0] - a[0], p[1] - a[1]) * 10) / 10);
  return [a[0] + l * Math.cos(w * Math.PI / 180), a[1] + l * Math.sin(w * Math.PI / 180)];
}

function skizzeEinrichten() {
  const s = svg();
  s.onpointerdown = ev => {
    if (!zeichnen) return;
    s.setPointerCapture(ev.pointerId);
    const p = svgPunkt(ev);
    if (!zeichnen.pkt.length) zeichnen.pkt.push(p.map(v => Math.round(v * 10) / 10));
    zeichnen.zug = einrasten(p);
    zeichnenNeu();
  };
  s.onpointermove = ev => { if (zeichnen?.zug) { zeichnen.zug = einrasten(svgPunkt(ev)); zeichnenNeu(); } };
  s.onpointerup = () => {
    if (!zeichnen?.zug) return;
    const q = zeichnen.zug, pk = zeichnen.pkt, a = pk.at(-1);
    zeichnen.zug = null;
    if (Math.hypot(q[0] - a[0], q[1] - a[1]) < 0.2) return zeichnenNeu();
    if (q === pk[0]) return schliessen();
    pk.push(q);
    zeichnenNeu();
  };
  s.onclick = ev => {
    if (zeichnen) return;
    const d = ev.target.dataset || {}, { b, e, r } = aktiv;
    if (d.mass != null) { // Maß in der Zeichnung antippen: Feld ist bereit für den Laser
      const f = app.querySelector(`input[data-feld="l"][data-i="${d.mass}"]`);
      f.scrollIntoView({ block: 'center' });
      return f.focus();
    }
    if (d.teil) { const [i, sel] = d.teil.split(':'); return geh('w', b.id, e, r, i, '', sel); }
    if (d.i == null) return;
    const i = +d.i, [x, y] = svgPunkt(ev), P = punkteAnzeige(), [a, c] = [P[i], P[i + 1]];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1);
    geh('w', b.id, e, r, i, Math.min(0.9, Math.max(0.1, t)).toFixed(2));
  };
}

function schliessen() {
  const pk = zeichnen.pkt;
  if (pk.length < 3) return alert('Ein Raum braucht mindestens 3 Wände.');
  const { b, raum } = aktiv;
  Object.assign(raum, G.ausPunkten(pk.map(([x, y]) => [x, -y])));
  zeichnen = null;
  speichern(b);
  zeigen();
}

const punkteAnzeige = (raum = aktiv.raum) => G.punkte(raum.waende, raum.drehung ?? 0).map(([x, y]) => [x, -y]);

function zeichnenNeu() {
  const s = svg(), { raum, b } = aktiv;
  s.replaceChildren();
  const knoepfe = $('#zknoepfe');
  if (zeichnen) {
    s.setAttribute('viewBox', '0 0 10 10');
    for (let i = 1; i < 10; i++) {
      s.append(el('line', { x1: i, y1: 0, x2: i, y2: 10, stroke: '#e3e8ef', 'stroke-width': 0.02 }));
      s.append(el('line', { x1: 0, y1: i, x2: 10, y2: i, stroke: '#e3e8ef', 'stroke-width': 0.02 }));
    }
    const pk = zeichnen.pkt, alle_ = zeichnen.zug ? [...pk, zeichnen.zug] : pk;
    if (alle_.length > 1) s.append(el('polyline', { points: alle_.join(' '), fill: 'none', stroke: '#1f5f99', 'stroke-width': 0.08, 'stroke-linejoin': 'round' }));
    if (pk.length) s.append(el('circle', { cx: pk[0][0], cy: pk[0][1], r: pk.length >= 3 ? 0.35 : 0.15, fill: '#2ecc71', opacity: 0.8 }));
    if (zeichnen.zug) {
      const a = pk.at(-1), q = zeichnen.zug;
      s.append(el('text', { x: q[0], y: q[1] - 0.35, 'font-size': 0.45, 'text-anchor': 'middle', fill: '#1f5f99' },
        `${G.name(pk.length - 1)} ≈ ${de(Math.hypot(q[0] - a[0], q[1] - a[1]), 1)}`));
    }
    $('#status').textContent = !pk.length ? 'Mit dem Finger Wand für Wand ziehen, im Uhrzeigersinn oder andersherum.'
      : pk.length < 3 ? 'Nächste Wand vom Ende der letzten aus ziehen. Ecken rasten bei 90° und 45° ein.'
      : 'Am grünen Startpunkt loslassen oder „Schließen“ tippen: dann ist der Raum fertig skizziert.';
    knoepfe.innerHTML = `<button id="z-rueck" ${pk.length ? '' : 'disabled'}>Rückgängig</button>
      <button class="haupt" id="z-zu" ${pk.length >= 3 ? '' : 'disabled'}>Schließen</button>`;
    $('#z-rueck').onclick = () => { pk.pop(); zeichnenNeu(); };
    $('#z-zu').onclick = schliessen;
    return;
  }

  // Sind alle Wände gemessen: schräge Ecken ausrechnen, kleine Lücken schließen oder nachfragen
  const zu = G.lueckeSchliessen(raum, tol(b));
  speichern(b);
  const w = raum.waende;
  app.querySelectorAll('input[data-feld="w"]').forEach(f => {
    const i = +f.dataset.i, ist = zu.frei.includes(i);
    f.classList.toggle('auto', ist);
    if (document.activeElement !== f) f.value = rohText(w[i].winkel);
  });
  w.forEach((wd, i) => {
    const g = $(`#ger-${i}`), ger = zu.korrigiert.includes(i);
    if (g) g.textContent = ger ? `gemessen ${massText(wd.laenge)} → gerechnet ${massText(G.wandLaenge(wd))} ${einheit} (gerundet)` : '';
    app.querySelector(`input[data-feld="l"][data-i="${i}"]`)?.classList.toggle('gerundet', ger);
  });
  const P = punkteAnzeige(), pr = G.pruefen(w), warn = G.warnungen(raum);
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const gr = Math.max(x1 - x0, y1 - y0, 1), rand = gr * 0.25, fs = gr / 18;
  s.setAttribute('viewBox', `${x0 - rand} ${y0 - rand} ${x1 - x0 + 2 * rand} ${y1 - y0 + 2 * rand}`);
  s.append(el('polygon', { points: P.slice(0, -1).join(' '), fill: '#e7f0fa' }));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  w.forEach((wd, i) => {
    const [a, c] = [P[i], P[i + 1]], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const u = [(c[0] - a[0]) / l, (c[1] - a[1]) / l], aussen = [u[1], -u[0]]; // links der Laufrichtung (Bildschirm) = außen
    s.append(el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: wd.mitrechnen === false ? '#9aa3ad' : '#1b1b1b',
      'stroke-width': fs * 0.25, 'stroke-dasharray': wd.mitrechnen === false ? `${fs * 0.5} ${fs * 0.4}` : 'none', 'stroke-linecap': 'round' }));
    s.append(el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: 'transparent', 'stroke-width': fs * 2.2, 'data-i': i, style: 'cursor:pointer' }));
    (wd.oeffnungen || []).forEach((o, j) => {
      const p1 = [a[0] + u[0] * o.abstand, a[1] + u[1] * o.abstand], p2 = [p1[0] + u[0] * o.breite, p1[1] + u[1] * o.breite];
      s.append(el('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: o.art === 'tuer' ? '#a0522d' : '#2e86de', 'stroke-width': fs * 0.7, 'data-teil': `${i}:o-${j}` }));
    });
    (wd.anschluesse || []).forEach((an, j) =>
      s.append(el('circle', { cx: a[0] + u[0] * an.abstand - aussen[0] * fs * 0.4, cy: a[1] + u[1] * an.abstand - aussen[1] * fs * 0.4, r: fs * 0.25, fill: anschluss(an.art)[2], 'data-teil': `${i}:a-${j}` })));
    const ab = fs * (1.1 + Math.abs(aussen[0]) * 1.8); // senkrechte Wände: waagrechter Text braucht mehr Platz
    const m = [(a[0] + c[0]) / 2 + aussen[0] * ab, (a[1] + c[1]) / 2 + aussen[1] * ab], ger = zu.korrigiert.includes(i);
    s.append(el('text', { x: m[0], y: m[1] + fs * 0.35, 'font-size': fs, 'text-anchor': 'middle', 'font-weight': 600, 'data-mass': i, style: 'cursor:pointer',
      fill: wd.laenge == null ? '#d68910' : ger ? '#b45309' : '#1f5f99' }, `${G.name(i)} ${wd.laenge == null ? '?' : massText(G.wandLaenge(wd)) + (ger ? '*' : '')}`));
    if (Math.abs(wd.winkel - 90) > 0.05) {
      const ecke = P[i + 1], d = Math.hypot(mx - ecke[0], my - ecke[1]) || 1; // Winkel zur Raummitte hin versetzt
      s.append(el('text', { x: ecke[0] + (mx - ecke[0]) / d * fs * 1.6, y: ecke[1] + (my - ecke[1]) / d * fs * 1.6 + fs * 0.3, 'font-size': fs * 0.8, 'text-anchor': 'middle', fill: zu.frei.includes(i) ? '#2e9d5b' : '#6b7280' }, `${de(wd.winkel, 1)}°`));
    }
  });
  const dr = (raum.drehung ?? 0) * Math.PI / 180, dreh = ([x, y]) => [x * Math.cos(dr) - y * Math.sin(dr), -(x * Math.sin(dr) + y * Math.cos(dr))];
  raum.koerper.forEach((k, j) => {
    const [cx, cy] = G.koerperMitte(k), schlecht = warn.some(x => x.ziel === `k-${j}`);
    const form = k.form === 'kreis'
      ? el('circle', { cx: dreh([cx, cy])[0], cy: dreh([cx, cy])[1], r: k.d / 2 })
      : el('polygon', { points: [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => dreh([cx + sx * k.b / 2, cy + sy * k.t / 2])).join(' ') });
    form.setAttribute('fill', schlecht ? '#f5b7b1' : '#c9ced6');
    form.setAttribute('stroke', schlecht ? '#c0392b' : '#4b5563');
    form.setAttribute('stroke-width', fs * 0.12);
    s.append(form);
  });
  if (pr.luecke > 0.0005) {
    const [e, a] = [P.at(-1), P[0]];
    s.append(el('line', { x1: e[0], y1: e[1], x2: a[0], y2: a[1], stroke: '#c0392b', 'stroke-width': fs * 0.2, 'stroke-dasharray': `${fs * 0.4} ${fs * 0.3}` }));
    s.append(el('circle', { cx: e[0], cy: e[1], r: fs * 0.3, fill: '#c0392b' }));
    s.append(el('text', { x: (e[0] + a[0]) / 2, y: (e[1] + a[1]) / 2 - fs * 0.4, 'font-size': fs * 0.9, 'text-anchor': 'middle', fill: '#c0392b' }, `Lücke ${massText(pr.luecke)}`));
  }
  const teile = [], lk = `${massText(zu.luecke ?? pr.luecke)} ${einheit}`;
  if (pr.fehlt.length) teile.push(`Maß fehlt: ${pr.fehlt.join(', ')}`);
  if (zu.frei.length) teile.push(`Winkel ausgerechnet: ${zu.frei.map(i => `${G.name(i)} ${de(w[i].winkel, 1)}°`).join(', ')}`);
  if (zu.zustand === 'frage') teile.push(`<div class="frage">Alle Maße sind da, aber es bleibt eine Lücke von ${lk}. Wie soll sie geschlossen werden?
    <div class="reihe"><button data-schluss="mass">Letztes Maß anpassen</button><button data-schluss="winkel">Winkel anpassen</button></div></div>`);
  if (zu.zustand === 'gerundet') teile.push(`<span class="ger">Lücke ${lk} geschlossen: ${zu.korrigiert.map(i => G.name(i)).join(' und ')} gerundet${raum.schluss ? '' : ` (Toleranz ${de(tol(b) * 1000, 0)} mm)`}.</span>`);
  if (zu.zustand === 'winkel') teile.push(`<span class="ger">Lücke ${lk} über die letzten Ecken geschlossen.</span>`);
  if (raum.schluss && zu.zustand !== 'frage') teile.push('<button class="klein" data-schluss="">Rückgängig</button>');
  if (pr.zu && !pr.fehlt.length) teile.push(`Umriss geschlossen · Fläche ${de(pr.flaeche)} m²`);
  if (warn.length) teile.push(`<ul class="warnliste">${warn.map(x => `<li data-warn="${x.wand ?? ''}:${x.ziel}">⚠ ${esc(x.text)} Antippen zum Anpassen.</li>`).join('')}</ul>`);
  $('#status').innerHTML = teile.map(t => t.startsWith('<div') || t.startsWith('<ul') ? t : `<div>${t}</div>`).join('');
  knoepfe.innerHTML = '<button id="z-neu">Neu zeichnen</button>';
  $('#z-neu').onclick = () => {
    if (!confirm('Skizze und alle Wandmaße dieses Raums verwerfen und neu zeichnen?')) return;
    raum.waende = [];
    speichern(b);
    zeigen();
  };
}

// ---------- Wandansicht: eine Wand von innen, mit Türen, Fenstern, Anschlüssen und Maßen ----------
const OEFFNUNG = { tuer: { breite: 0.885, hoehe: 2.01, bruestung: 0 }, fenster: { breite: 1.01, hoehe: 1.385, bruestung: 0.9 } };
// wie ANSCHLUSSARTEN in geometrie.py am PC: Name, Kurzzeichen, Farbe, übliche Höhe (m)
const ANSCHLUESSE = {
  steckdose: ['Steckdose', 'S', '#d97706', 0.30], schalter: ['Lichtschalter', 'L', '#d97706', 1.05],
  kw: ['Wasser kalt', 'KW', '#2563eb', 0.55], ww: ['Wasser warm', 'WW', '#dc2626', 0.55],
  abwasser: ['Abwasser DN 50', 'AW', '#78716c', 0.50], wc: ['WC-Abfluss DN 100', 'WC', '#57534e', 0.22],
  dusche: ['Duscharmatur', 'DA', '#0891b2', 1.10], lan: ['LAN-Dose', 'LAN', '#7c3aed', 0.30],
  herd: ['Herdanschlussdose', 'H', '#b91c1c', 0.60], verteiler: ['Verteiler', 'V', '#7c2d12', 1.80],
};
const anschluss = art => ANSCHLUESSE[art] || [art, art, '#555', 0.3];
const TUERTYP = { einfach: 'Drehtür einflügelig', doppelt: 'Drehtür zweiflügelig', schiebe: 'Schiebetür' };
const LEITUNG = { '': 'keine Leitung', oben: 'Leitung nach oben', unten: 'Leitung nach unten' };
const auswahl = (attr, werte, ist) => `<select ${attr}>${Object.entries(werte).map(([k, v]) => `<option value="${k}" ${ist === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
const r3 = v => Math.round(v * 1000) / 1000;

function wandSeite(b, e, r, i, anteil, sel) {
  const raum = b.etagen[e].raeume[r], w = raum.waende[i], n = raum.waende.length;
  aktiv = { b, raum, e, r };
  w.oeffnungen ??= [];
  w.anschluesse ??= [];
  G.lueckeSchliessen(raum, tol(b));
  const L = () => G.wandLaenge(w) ?? w.skizze ?? 1, H = () => raum.hoehe ?? 2.5, ort_ = lage(raum, i);
  kopf(`${raum.name} · Wand ${G.name(i)}`);
  // Abstände so zeigen, wie gemessen wurde (von links/rechts, von unten/oben); gespeichert wird immer ab links/unten
  const oAbst = o => o.bezug === 'rechts' ? L() - o.abstand - o.breite : o.abstand;
  const aSeite = a => a.bezug_s === 'rechts' ? L() - a.abstand : a.abstand;
  const aHoehe = a => a.bezug_h === 'oben' ? H() - a.hoehe : a.hoehe;
  const warn = G.warnungen(raum).filter(x => x.wand === i);
  const schlecht = id => warn.some(x => x.ziel === id) ? 'warn' : '';
  app.innerHTML = `
    <div class="reihe wandnav"><button id="w-vor">‹ ${G.name((i - 1 + n) % n)}</button>
      <div class="wandname"><b>Wand ${G.name(i)}</b><small>${ort_} · ${i + 1}. von ${n} Wänden</small></div>
      <button id="w-nach">${G.name((i + 1) % n)} ›</button></div>
    <svg id="karte" xmlns="http://www.w3.org/2000/svg"></svg>
    ${warn.length ? `<ul class="warnliste">${warn.map(x => `<li data-geh="${x.ziel}">⚠ ${esc(x.text)}</li>`).join('')}</ul>` : ''}
    <svg id="ansicht" xmlns="http://www.w3.org/2000/svg"></svg>
    <label class="feld">Länge (${einheit})<input data-ziel="laenge" inputmode="decimal" enterkeyhint="next" value="${massText(w.laenge)}" placeholder="≈ ${massText(w.skizze ?? 1)}" class="${w.laenge == null ? 'leer' : ''}"></label>
    ${w.korrektur ? `<p class="ger">Gerundet: gerechnet wird mit ${massText(G.wandLaenge(w))} ${einheit}, gemessen sind ${massText(w.laenge)} ${einheit}.</p>` : ''}
    <label class="feld">Winkel am Ende (°)<input data-ziel="winkel" data-still data-roh inputmode="decimal" value="${rohText(w.winkel)}"></label>
    <label class="feld">Raumhöhe (${einheit})<input data-ziel="raumhoehe" data-still inputmode="decimal" value="${massText(raum.hoehe)}" class="${raum.hoehe == null ? 'leer' : ''}"></label>
    <label class="feld haken" style="grid-template-columns:48px 1fr"><input type="checkbox" id="w-mit" ${w.mitrechnen === false ? '' : 'checked'}>Wandfläche mitrechnen</label>
    <h3>Türen und Fenster</h3>
    <p class="hinweis">Abstand bis zur Kante der Öffnung, vom Raum aus auf die Wand gesehen. „von links ⇄“ antippen zum Umschalten.</p>
    ${w.oeffnungen.map((o, j) => `<div class="oe ${schlecht(`o-${j}`)}" id="o-${j}">
      ${auswahl(`data-art="o.${j}"`, { tuer: 'Tür', fenster: 'Fenster' }, o.art)}
      <button class="klein weg" data-weg="o.${j}" aria-label="löschen">✕</button>
      <button class="bez" data-bezug="o.${j}">von ${o.bezug === 'rechts' ? 'rechts' : 'links'} ⇄</button>
      ${zfeld(`o.${j}.abstand`, oAbst(o), 'Abstand')}
      ${zfeld(`o.${j}.breite`, o.breite, 'Breite')}${zfeld(`o.${j}.hoehe`, o.hoehe, 'Höhe')}${zfeld(`o.${j}.bruestung`, o.bruestung, 'Brüstung')}
      ${o.art === 'tuer'
        ? `<label class="breit"><small>Art</small>${auswahl(`data-x="o.${j}.typ"`, TUERTYP, o.typ || 'einfach')}</label>
           <label class="halb"><small>Anschlag</small>${auswahl(`data-x="o.${j}.anschlag"`, { links: 'links', rechts: 'rechts' }, o.anschlag || 'links')}</label>
           <label class="halb"><small>öffnet</small>${auswahl(`data-x="o.${j}.oeffnet"`, { innen: 'nach innen', aussen: 'nach außen' }, o.oeffnet || 'innen')}</label>`
        : `<label class="halb haken"><input type="checkbox" data-fb="${j}" ${o.fb === false ? '' : 'checked'}> Fensterbrett</label>
           <label class="halb"><small>Laibung (cm)</small><input data-ziel="o.${j}.laibung" data-roh data-still inputmode="decimal" value="${rohText(o.laibung)}"></label>`}</div>`).join('')}
    <div class="reihe"><button data-neu="tuer">+ Tür</button><button data-neu="fenster">+ Fenster</button></div>
    <h3>Anschlüsse (Elektro, Wasser)</h3>
    <p class="hinweis">Zuerst die Höhe messen (vom Boden oder von der Decke), dann seitlich (von links oder rechts), jeweils bis Mitte Dose.</p>
    ${w.anschluesse.map((a, j) => `<div class="oe ${schlecht(`a-${j}`)}" id="a-${j}">
      <select data-art="a.${j}">${Object.entries(ANSCHLUESSE).map(([k, v]) => `<option value="${k}" ${a.art === k ? 'selected' : ''}>${v[0]}</option>`).join('')}
        ${ANSCHLUESSE[a.art] ? '' : `<option selected>${esc(a.art)}</option>`}</select>
      <button class="klein weg" data-weg="a.${j}" aria-label="löschen">✕</button>
      <button class="bez" data-bezugh="${j}">von ${a.bezug_h === 'oben' ? 'der Decke' : 'unten'} ⇄</button>${zfeld(`a.${j}.hoehe`, aHoehe(a), '1. Höhe')}
      <button class="bez" data-bezugs="${j}">von ${a.bezug_s === 'rechts' ? 'rechts' : 'links'} ⇄</button>${zfeld(`a.${j}.abstand`, aSeite(a), '2. Seite')}
      <label class="breit"><small>Leitung</small>${auswahl(`data-x="a.${j}.leitung"`, LEITUNG, a.leitung || '')}</label></div>`).join('')}
    <div class="reihe"><button data-neu="steckdose">+ Steckdose</button><button data-neu="schalter">+ Schalter</button><button data-neu="kw">+ Wasser</button></div>
    <h3>Wand teilen ${anteil == null ? '(in der Mitte)' : '(an der angetippten Stelle)'}</h3>
    <div class="reihe"><button data-teilen="ecke">Ecke</button><button data-teilen="vor">Vorsprung</button><button data-teilen="nische">Nische</button></div>
    <div class="reihe"><button class="weg" id="w-weg">Wand löschen</button></div>`;
  const neu = () => { const y = scrollY; wandSeite(b, e, r, i, anteil, null); scrollTo(0, y); };
  $('#w-vor').onclick = () => geh('w', b.id, e, r, (i - 1 + n) % n);
  $('#w-nach').onclick = () => geh('w', b.id, e, r, (i + 1) % n);
  $('#w-mit').onchange = ev => { w.mitrechnen = ev.target.checked; speichern(b); ansichtNeu(w, raum); };
  zahlFelder(app, (ziel, v) => {
    const [art, j, k] = ziel.split('.'), o = w.oeffnungen[j], a = w.anschluesse[j];
    if (ziel === 'laenge') { if (v != null && !(v > 0 && v < 100)) return false; G.laengeSetzen(w, v); return true; }
    if (ziel === 'winkel') { if (!(v > 0 && v < 360)) return false; w.winkel = w.skizzeWinkel = v; return true; }
    if (ziel === 'raumhoehe') { if (v != null && !(v > 0 && v < 100)) return false; G.hoeheSetzen(raum, v); return true; }
    if (k === 'laibung') { if (v != null && v >= 200) return false; o.laibung = v; return true; }
    if (v == null || v >= 100) return false;
    if (art === 'o') {
      const rechts = o.bezug === 'rechts', vonRechts = L() - o.abstand - o.breite;
      if (k === 'abstand') o.abstand = r3(rechts ? L() - v - o.breite : v);
      else { o[k] = v; if (k === 'breite' && rechts) o.abstand = r3(L() - vonRechts - v); }
    } else if (k === 'hoehe') a.hoehe = r3(a.bezug_h === 'oben' ? H() - v : v);
    else a.abstand = r3(a.bezug_s === 'rechts' ? L() - v : v);
    return true;
  }, () => { ansichtNeu(w, raum); karteNeu(raum, i); });
  app.onchange = ev => {
    const t = ev.target, d = t.dataset;
    if (d.art) { const [art, j] = d.art.split('.'); (art === 'o' ? w.oeffnungen : w.anschluesse)[j].art = t.value; }
    else if (d.x) { const [art, j, k] = d.x.split('.'); (art === 'o' ? w.oeffnungen : w.anschluesse)[j][k] = t.value; }
    else if (d.fb != null) w.oeffnungen[d.fb].fb = t.checked;
    else return;
    speichern(b);
    d.art ? neu() : ansichtNeu(w, raum);
  };
  app.onclick = ev => {
    const geh_ = ev.target.closest('[data-geh]');
    if (geh_) return fokus(geh_.dataset.geh);
    const t = ev.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.weg) { const [art, j] = d.weg.split('.'); (art === 'o' ? w.oeffnungen : w.anschluesse).splice(j, 1); }
    else if (d.bezug) { const o = w.oeffnungen[d.bezug.split('.')[1]]; o.bezug = o.bezug === 'rechts' ? 'links' : 'rechts'; }
    else if (d.bezugh != null) {
      const a = w.anschluesse[d.bezugh];
      if (a.bezug_h !== 'oben' && raum.hoehe == null) return alert('Bitte zuerst die Raumhöhe messen, dann kann von der Decke aus gemessen werden.');
      a.bezug_h = a.bezug_h === 'oben' ? 'unten' : 'oben';
    } else if (d.bezugs != null) { const a = w.anschluesse[d.bezugs]; a.bezug_s = a.bezug_s === 'rechts' ? 'links' : 'rechts'; }
    else if (OEFFNUNG[d.neu]) w.oeffnungen.push({ art: d.neu, abstand: r3(Math.max(0, (L() - OEFFNUNG[d.neu].breite) / 2)), ...OEFFNUNG[d.neu] });
    else if (d.neu) w.anschluesse.push({ art: d.neu, abstand: r3(L() / 2), hoehe: anschluss(d.neu)[3], leitung: '' });
    else if (d.teilen) {
      const a = anteil ?? 0.5;
      if (d.teilen === 'ecke') G.eckeEinfuegen(raum, i, a); else G.vorsprungEinfuegen(raum, i, a, d.teilen === 'vor' ? 0.3 : -0.3);
      speichern(b);
      return geh('r', b.id, e, r);
    } else if (t.id === 'w-weg') {
      if (!confirm(`Wand ${G.name(i)} löschen? Die anderen Wände bleiben, die Lücke wird angezeigt.`)) return;
      G.wandLoeschen(raum, i);
      speichern(b);
      return geh('r', b.id, e, r);
    } else return;
    speichern(b);
    neu();
    if (d.neu) fokus(`${OEFFNUNG[d.neu] ? 'o' : 'a'}-${(OEFFNUNG[d.neu] ? w.oeffnungen : w.anschluesse).length - 1}`);
  };
  ansichtNeu(w, raum);
  karteNeu(raum, i);
  if (sel) fokus(sel);
}

/** Zeile eines Teils zeigen und sein erstes Maßfeld wählen (z. B. nach Antippen in der Zeichnung). */
function fokus(id) {
  const zeile = app.querySelector(`#${id}`);
  if (!zeile) return;
  zeile.classList.add('gewaehlt');
  setTimeout(() => zeile.classList.remove('gewaehlt'), 1500);
  const f = zeile.querySelector('input[data-ziel]');
  zeile.scrollIntoView({ block: 'center' });
  f?.focus();
}

/** Kleine Draufsicht: wo ist die Wand? */
function karteNeu(raum, i) {
  const s = $('#karte');
  if (!s) return;
  s.replaceChildren();
  const P = punkteAnzeige(raum), xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], gr = Math.max(x1 - x0, y1 - y0, 1), r = gr * 0.08;
  s.setAttribute('viewBox', `${x0 - r} ${y0 - r} ${x1 - x0 + 2 * r} ${y1 - y0 + 2 * r}`);
  s.append(el('polygon', { points: P.slice(0, -1).join(' '), fill: '#e7f0fa', stroke: '#9aa3ad', 'stroke-width': gr * 0.02 }));
  s.append(el('line', { x1: P[i][0], y1: P[i][1], x2: P[i + 1][0], y2: P[i + 1][1], stroke: '#c0392b', 'stroke-width': gr * 0.06, 'stroke-linecap': 'round' }));
  s.append(el('circle', { cx: P[i][0], cy: P[i][1], r: gr * 0.045, fill: '#c0392b' })); // Wandanfang = links in der Ansicht
}

/** Ansicht der Wand von innen: links = Wandanfang, unten = Fußboden. Mit Maßkette unten und Höhen. */
function ansichtNeu(w, raum) {
  const s = $('#ansicht');
  if (!s) return;
  s.replaceChildren();
  const L = G.wandLaenge(w) ?? w.skizze ?? 1, H = raum.hoehe ?? 2.5, fs = Math.max(L, H) / 20;
  // auch Teile zeigen, die über die Wand hinausragen (rot)
  const xs = [0, L, ...w.oeffnungen.flatMap(o => [o.abstand, o.abstand + o.breite]), ...w.anschluesse.map(a => a.abstand)];
  const ys = [0, ...w.oeffnungen.map(o => H - o.bruestung - o.hoehe), ...w.anschluesse.map(a => H - a.hoehe)];
  const [xa, xb, ya] = [Math.min(...xs), Math.max(...xs), Math.min(...ys)];
  s.setAttribute('viewBox', `${xa - fs * 3} ${ya - fs * 1.5} ${xb - xa + fs * 4.5} ${H - ya + fs * 6}`);
  const text = (x, y, t, mehr = {}) => s.append(el('text', { x, y, 'font-size': fs * 0.75, 'text-anchor': 'middle', fill: '#1b1b1b', ...mehr }, t));
  s.append(el('rect', { x: 0, y: 0, width: L, height: H, fill: w.mitrechnen === false ? '#f1f1f1' : '#f4f8fc', stroke: '#1b1b1b', 'stroke-width': fs * 0.12,
    'stroke-dasharray': w.mitrechnen === false ? `${fs * 0.5} ${fs * 0.4}` : 'none' }));
  const kanten = [0, L];
  w.oeffnungen.forEach((o, j) => {
    const y = H - o.bruestung - o.hoehe, tuer = o.art === 'tuer', raus = o.abstand < -0.005 || o.abstand + o.breite > L + 0.005 || y < -0.005;
    s.append(el('rect', { x: o.abstand, y, width: o.breite, height: o.hoehe, fill: raus ? '#f5b7b1' : tuer ? '#f3e2d6' : '#dbeafb',
      stroke: raus ? '#c0392b' : tuer ? '#a0522d' : '#2e86de', 'stroke-width': fs * 0.1, 'data-sel': `o-${j}` }));
    text(o.abstand + o.breite / 2, y + o.hoehe / 2, `${massText(o.breite)} × ${massText(o.hoehe)}`, { 'pointer-events': 'none' });
    if (o.bruestung > 0) text(o.abstand + o.breite / 2, H - o.bruestung / 2 + fs * 0.3, `Br. ${massText(o.bruestung)}`, { fill: '#2e86de', 'pointer-events': 'none' });
    kanten.push(o.abstand, o.abstand + o.breite);
  });
  w.anschluesse.forEach((a, j) => {
    const [, kurz, f0] = anschluss(a.art), x = a.abstand, y = H - a.hoehe;
    const farbe = x < -0.005 || x > L + 0.005 || y < -0.005 ? '#c0392b' : f0;
    s.append(el('circle', { cx: x, cy: y, r: fs * 0.4, fill: '#fff', stroke: farbe, 'stroke-width': fs * 0.1, 'data-sel': `a-${j}` }));
    text(x, y + fs * 0.17, kurz, { fill: farbe, 'font-size': fs * 0.4, 'font-weight': 700, 'pointer-events': 'none' });
    // Maße so, wie gemessen (Höhe | Seite), abwechselnd über/unter dem Zeichen, damit nahe Dosen lesbar bleiben
    const h = a.bezug_h === 'oben' ? `↓${massText(H - a.hoehe)}` : `↑${massText(a.hoehe)}`, sx = a.bezug_s === 'rechts' ? `${massText(L - a.abstand)}→` : `←${massText(a.abstand)}`;
    text(x, j % 2 ? y + fs * 1.0 : y - fs * 0.6, `${h} ${sx}`, { 'font-size': fs * 0.42, fill: farbe, 'pointer-events': 'none' });
  });
  // Maßkette unten (Abstände zwischen Wandecken und Öffnungskanten)
  const k = [...new Set(kanten.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b), ym = H + fs * 1.6;
  s.append(el('line', { x1: 0, y1: ym, x2: L, y2: ym, stroke: '#6b7280', 'stroke-width': fs * 0.05 }));
  k.forEach((v, j) => {
    s.append(el('line', { x1: v, y1: ym - fs * 0.4, x2: v, y2: ym + fs * 0.4, stroke: '#6b7280', 'stroke-width': fs * 0.05 }));
    if (j) text((k[j - 1] + v) / 2, ym - fs * 0.25, massText(v - k[j - 1]), { fill: '#374151' });
  });
  const ger = !!w.korrektur;
  text(L / 2, H + fs * 3.4, `Wand ${massText(L)} ${einheit}${w.laenge == null ? ' (ungefähr)' : ger ? ' (gerundet)' : ''}`,
    { 'font-weight': 600, fill: w.laenge == null ? '#d68910' : ger ? '#b45309' : '#1f5f99', 'font-size': fs * 0.85, 'data-sel': 'laenge', style: 'cursor:pointer' });
  text(-fs * 1.4, H / 2, `${massText(H)}${raum.hoehe == null ? '?' : ''}`, { transform: `rotate(-90 ${-fs * 1.4} ${H / 2})`, fill: '#374151', 'data-sel': 'raumhoehe', style: 'cursor:pointer' });
  s.onclick = ev => {
    const sel = ev.target.dataset?.sel;
    if (!sel) return;
    if (sel === 'laenge' || sel === 'raumhoehe') { const f = app.querySelector(`[data-ziel="${sel}"]`); f.scrollIntoView({ block: 'center' }); return f.focus(); }
    fokus(sel);
  };
}

// ---------- Start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.(); // Android soll die Daten nicht bei Platzmangel löschen
db = await dbAuf();
alle = await tx('readonly', s => s.getAll());
zeigen();
