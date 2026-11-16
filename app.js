// Bildschirm der Aufmaß-App: Baustellen → Etagen → Räume, Skizze, Maßfelder, Export/Import.
import * as G from './geo.js';
import * as Laser from './laser.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const de = (v, n = 2) => v.toFixed(n).replace('.', ',');
const feldText = v => v == null ? '' : String(+v.toFixed(3)).replace('.', ',');

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

// ---------- Seitenwechsel über die Adresse (#b/id, #r/id/etage/raum), damit die Zurück-Taste geht ----------
const ort = () => location.hash.slice(1).split('/').map(decodeURIComponent);
const geh = (...teile) => { location.hash = teile.map(encodeURIComponent).join('/'); };
function zeigen() {
  const [art, id, e, r, i, anteil] = ort();
  const b = alle.find(x => x.id === id);
  zeichnen = null;
  app.onchange = null;
  if (art === 'w' && b?.etagen[e]?.raeume[r]?.waende[i]) wandSeite(b, +e, +r, +i, anteil == null ? null : +anteil);
  else if (art === 'r' && b?.etagen[e]?.raeume[r]) raumSeite(b, +e, +r);
  else if (art === 'b' && b) baustelleSeite(b);
  else startSeite();
}
addEventListener('hashchange', () => { zeigen(); scrollTo(0, 0); });
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
    if (!confirm(`„${alt.baustelle}“ ist schon auf diesem Gerät (zuletzt geändert ${stand}).
`
      + `Durch die Datei vom ${d.erstellt.replace('T', ' ')} ersetzen? Änderungen hier seit dem Export gehen dabei verloren.`)) return;
    alle = alle.filter(x => x !== alt);
  }
  alle.push(b);
  await speichern(b);
  geh('b', b.id);
}

// ---------- Baustelle: Etagen und Räume ----------
function raumInfo(r) {
  if (!r.waende.length) return 'noch keine Skizze';
  const p = G.pruefen(r.waende);
  if (p.fehlt.length) return `Maß fehlt: ${p.fehlt.join(', ')}`;
  return p.zu ? `${de(p.flaeche)} m²` : `Lücke ${de(p.luecke)} m`;
}

function baustelleSeite(b) {
  kopf(b.baustelle);
  app.innerHTML = b.etagen.map((e, ei) => `
    <section class="etage"><h2><span>${esc(e.name)}</span>
      <button class="klein" data-a="etage-name" data-e="${ei}" aria-label="Etage umbenennen">✎</button>
      <button class="klein weg" data-a="etage-weg" data-e="${ei}" aria-label="Etage löschen">🗑</button></h2>
      <ul class="liste">${e.raeume.map((r, ri) => `<li>
        <a href="#r/${encodeURIComponent(b.id)}/${ei}/${ri}">${esc(r.name)}&nbsp;<span class="hinweis">· ${raumInfo(r)}</span></a>
        <button class="klein" data-a="raum-name" data-e="${ei}" data-r="${ri}" aria-label="Raum umbenennen">✎</button>
        <button class="klein weg" data-a="raum-weg" data-e="${ei}" data-r="${ri}" aria-label="Raum löschen">🗑</button></li>`).join('')}</ul>
      <div class="reihe"><button data-a="raum-neu" data-e="${ei}">+ Raum</button></div>
    </section>`).join('') + `
    <div class="reihe"><button data-a="etage-neu">+ Etage</button></div>
    <div class="reihe"><button class="haupt" data-a="teilen">Teilen / Exportieren</button></div>
    <div class="reihe"><button data-a="name">Baustelle umbenennen</button><button class="weg" data-a="weg">Baustelle löschen</button></div>`;
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
        e.raeume.push({ name: n, hoehe: null, notiz: '', drehung: 0, waende: [] });
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

// ---------- Raum: Skizze und Maße ----------
const kfeld = (ziel, v, label, platz = '') => `<label><small>${label}</small><input data-ziel="${ziel}" inputmode="decimal" enterkeyhint="next" value="${feldText(v)}" placeholder="${platz}"></label>`;
let zeichnen = null; // {pkt: [[x, y] …] im Zeichenfeld (y nach unten), zug: Vorschaupunkt beim Ziehen}
let letztesFeld = null;
let aktiv = null; // {b, e, r, raum}

function raumSeite(b, e, r) {
  const raum = b.etagen[e].raeume[r];
  aktiv = { b, raum, e, r };
  raum.koerper ??= [];
  kopf(`${b.etagen[e].name} · ${raum.name}`);
  if (!raum.waende.length) zeichnen = { pkt: [], zug: null };
  app.onclick = null;
  app.innerHTML = `
    <svg id="skizze" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="reihe" id="zknoepfe"></div>
    <div id="status"></div>
    <label class="feld">Raumhöhe (m)<input data-feld="hoehe" inputmode="decimal" enterkeyhint="next" value="${feldText(raum.hoehe)}"></label>
    <div id="masse">${raum.waende.map((w, i) => `<div class="mass">
      <button class="klein" data-wand="${i}">${G.name(i)}</button>
      <input data-feld="l" data-i="${i}" inputmode="decimal" enterkeyhint="next" aria-label="Länge Wand ${G.name(i)}"
             placeholder="≈ ${de(w.skizze ?? 1, 1)}" value="${feldText(w.laenge)}" class="${w.laenge == null ? 'leer' : ''}">
      <span>m</span>
      <input data-feld="w" data-i="${i}" inputmode="decimal" tabindex="-1" aria-label="Winkel Ecke nach ${G.name(i)}" value="${feldText(Math.round(w.winkel * 10) / 10)}">
      <span>°</span></div>`).join('')}</div>
    ${raum.waende.length ? `<p class="hinweis">Feld antippen, messen, Enter: das nächste Feld ist dran. Winkel = Ecke am Ende der Wand (90 normal, 270 vorspringend); schräge Ecken rechnet die App aus, sobald alle Wände gemessen sind (grün). Buchstabe oder Wand in der Skizze antippen: Wandansicht mit Türen, Fenstern, Anschlüssen.</p>
      <div class="reihe"><button class="haupt" id="r-waende">Wände der Reihe nach bemaßen</button></div>
      <h3>Säulen und Körper</h3>
      <p class="hinweis">Lage: „ab Ecke“ = entlang Wand A ab ihrem Anfang bis zur Säule, „von A“ = quer von Wand A bis zur Säule.</p>
      ${raum.koerper.map((k, j) => `<div class="oe" id="k-${j}">
        <select data-form="${j}"><option value="rechteck" ${k.form === 'rechteck' ? 'selected' : ''}>Säule eckig</option><option value="kreis" ${k.form === 'kreis' ? 'selected' : ''}>Säule rund</option></select>
        <button class="klein weg" data-kweg="${j}" aria-label="löschen">✕</button>
        ${kfeld(`${j}.s`, k.s, 'ab Ecke')}${kfeld(`${j}.a`, k.a, 'von A')}
        ${k.form === 'kreis' ? kfeld(`${j}.d`, k.d, 'Ø') : kfeld(`${j}.b`, k.b, 'Breite') + kfeld(`${j}.t`, k.t, 'Tiefe')}
        ${kfeld(`${j}.h`, k.h, 'Höhe', 'Decke')}</div>`).join('')}
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
  skizzeEinrichten();
  zeichnenNeu();
}

/** Feld lesen und in den Raum schreiben. false = ungültige Eingabe (Feld bleibt rot). */
function uebernehmen(f) {
  const { b, raum } = aktiv;
  const v = G.zahl(f.value);
  const ok = !Number.isNaN(v) && (f.dataset.feld !== 'w' || (v != null && v > 0 && v < 360)) && (v == null || v < 100 || f.dataset.feld === 'w');
  f.classList.toggle('falsch', !ok);
  if (!ok) return false;
  if (f.dataset.feld === 'hoehe') raum.hoehe = v;
  else if (f.dataset.feld === 'l') { raum.waende[f.dataset.i].laenge = v; f.classList.toggle('leer', v == null); }
  else raum.waende[f.dataset.i].winkel = raum.waende[f.dataset.i].skizzeWinkel = v; // neuer Ausgangswert
  if (v != null) f.value = feldText(v);
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

// Laser: Wert ins zuletzt gewählte Maßfeld, dann weiter
function laserWert(m) {
  const f = letztesFeld?.isConnected ? letztesFeld : app.querySelector('input.leer');
  if (!f?._uebernehmen) return;
  f.value = feldText(m);
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

// ---------- Skizze ----------
const svg = () => $('#skizze');
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attr, text) => {
  const x = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attr)) x.setAttribute(k, v);
  if (text != null) x.textContent = text;
  return x;
};
function svgPunkt(ev) {
  const s = svg(), p = s.createSVGPoint();
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
    const i = ev.target.dataset?.i;
    if (zeichnen || i == null) return;
    const [x, y] = svgPunkt(ev), P = punkteAnzeige(), [a, c] = [P[i], P[+i + 1]];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1);
    geh('w', aktiv.b.id, aktiv.e, aktiv.r, i, Math.min(0.9, Math.max(0.1, t)).toFixed(2));
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

const punkteAnzeige = () => G.punkte(aktiv.raum.waende, aktiv.raum.drehung ?? 0).map(([x, y]) => [x, -y]);

function zeichnenNeu() {
  const s = svg(), { raum } = aktiv;
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

  // Sind alle Wände gemessen, rechnet die App die schrägen Ecken passend aus (normale Ecken bleiben 90°)
  const auto = G.winkelAusrechnen(raum.waende);
  app.querySelectorAll('input[data-feld="w"]').forEach(f => {
    const i = +f.dataset.i, ist = auto?.frei.includes(i);
    f.classList.toggle('auto', !!ist);
    if (ist && document.activeElement !== f) f.value = feldText(Math.round(raum.waende[i].winkel * 10) / 10);
  });
  if (auto) speichern(aktiv.b);
  const P = punkteAnzeige(), w = raum.waende, pr = G.pruefen(w);
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
    for (const o of wd.oeffnungen || []) {
      const p1 = [a[0] + u[0] * o.abstand, a[1] + u[1] * o.abstand], p2 = [p1[0] + u[0] * o.breite, p1[1] + u[1] * o.breite];
      s.append(el('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: o.art === 'tuer' ? '#a0522d' : '#2e86de', 'stroke-width': fs * 0.55 }));
    }
    const ab = fs * (1.1 + Math.abs(aussen[0]) * 1.8); // senkrechte Wände: waagrechter Text braucht mehr Platz
    for (const an of wd.anschluesse || [])
      s.append(el('circle', { cx: a[0] + u[0] * an.abstand - aussen[0] * fs * 0.35, cy: a[1] + u[1] * an.abstand - aussen[1] * fs * 0.35, r: fs * 0.18, fill: anschluss(an.art)[2] }));
    const m = [(a[0] + c[0]) / 2 + aussen[0] * ab, (a[1] + c[1]) / 2 + aussen[1] * ab];
    s.append(el('text', { x: m[0], y: m[1] + fs * 0.35, 'font-size': fs, 'text-anchor': 'middle', 'font-weight': 600,
      fill: wd.laenge == null ? '#d68910' : '#1f5f99' }, `${G.name(i)} ${wd.laenge == null ? '?' : de(wd.laenge)}`));
    if (Math.abs(wd.winkel - 90) > 0.05) {
      const ecke = P[i + 1], d = Math.hypot(mx - ecke[0], my - ecke[1]) || 1; // Winkel zur Raummitte hin versetzt
      s.append(el('text', { x: ecke[0] + (mx - ecke[0]) / d * fs * 1.6, y: ecke[1] + (my - ecke[1]) / d * fs * 1.6 + fs * 0.3, 'font-size': fs * 0.8, 'text-anchor': 'middle', fill: '#6b7280' }, `${de(wd.winkel, 0)}°`));
    }
    s.append(el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: 'transparent', 'stroke-width': fs * 2.2, 'data-i': i, style: 'cursor:pointer' }));
  });
  const dr = (raum.drehung ?? 0) * Math.PI / 180, dreh = ([x, y]) => [x * Math.cos(dr) - y * Math.sin(dr), -(x * Math.sin(dr) + y * Math.cos(dr))];
  (raum.koerper || []).forEach(k => {
    const [cx, cy] = G.koerperMitte(k);
    const form = k.form === 'kreis'
      ? el('circle', { cx: dreh([cx, cy])[0], cy: dreh([cx, cy])[1], r: k.d / 2 })
      : el('polygon', { points: [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => dreh([cx + sx * k.b / 2, cy + sy * k.t / 2])).join(' ') });
    form.setAttribute('fill', '#c9ced6');
    form.setAttribute('stroke', '#4b5563');
    form.setAttribute('stroke-width', fs * 0.12);
    s.append(form);
  });
  if (pr.luecke > 0.01) {
    const [e, a] = [P.at(-1), P[0]];
    s.append(el('line', { x1: e[0], y1: e[1], x2: a[0], y2: a[1], stroke: '#c0392b', 'stroke-width': fs * 0.2, 'stroke-dasharray': `${fs * 0.4} ${fs * 0.3}` }));
    s.append(el('circle', { cx: e[0], cy: e[1], r: fs * 0.3, fill: '#c0392b' }));
    s.append(el('text', { x: (e[0] + a[0]) / 2, y: (e[1] + a[1]) / 2 - fs * 0.4, 'font-size': fs * 0.9, 'text-anchor': 'middle', fill: '#c0392b' }, `Lücke ${de(pr.luecke)} m`));
  }
  const teile = [];
  if (pr.fehlt.length) teile.push(`Maß fehlt: ${pr.fehlt.join(', ')}`);
  if (auto) teile.push(`Winkel ausgerechnet: ${auto.frei.map(i => `${G.name(i)} ${de(w[i].winkel, 1)}°`).join(', ')}`);
  if (Math.abs(pr.winkelSumme - pr.winkelSoll) >= 0.5) teile.push(`<span class="fehler">Winkel zusammen ${de(pr.winkelSumme, 0)}°, nötig ${pr.winkelSoll}°</span>`);
  if (!pr.fehlt.length && pr.luecke > 0.01) teile.push(`<span class="fehler">Umriss offen: Lücke ${de(pr.luecke)} m</span>`);
  if (pr.zu && !pr.fehlt.length) teile.push(`Umriss geschlossen · Fläche ${de(pr.flaeche)} m²`);
  $('#status').innerHTML = teile.join(' · ');
  knoepfe.innerHTML = '<button id="z-neu">Neu zeichnen</button>';
  $('#z-neu').onclick = () => {
    if (!confirm('Skizze und alle Wandmaße dieses Raums verwerfen und neu zeichnen?')) return;
    raum.waende = [];
    speichern(aktiv.b);
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

/** Zahlenfeld: Enter = übernehmen und nächstes Feld (auch für den Laser im Tastaturmodus). */
function zahlFelder(wurzel, schreiben, nachher) {
  const felder = () => [...wurzel.querySelectorAll('input[data-ziel]')];
  felder().forEach(f => {
    f._uebernehmen = () => {
      const v = G.zahl(f.value), ok = !Number.isNaN(v) && schreiben(f.dataset.ziel, v);
      f.classList.toggle('falsch', !ok);
      if (ok) { if (v != null) f.value = feldText(v); speichern(aktiv.b); nachher(); }
      return ok;
    };
    f._weiter = () => { const l = felder(), n = l.slice(l.indexOf(f) + 1).find(x => !x.hasAttribute('data-still')); n ? n.focus() : f.blur(); };
    f.onfocus = () => { letztesFeld = f; f.select(); };
    f.onchange = () => f._uebernehmen();
    f.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (f._uebernehmen()) f._weiter(); } };
  });
}

function wandSeite(b, e, r, i, anteil) {
  const raum = b.etagen[e].raeume[r], w = raum.waende[i], n = raum.waende.length;
  aktiv = { b, raum };
  w.oeffnungen ??= [];
  w.anschluesse ??= [];
  kopf(`${raum.name} · Wand ${G.name(i)}`);
  app.onclick = null;
  const feld = (ziel, v, label, platz = '') => `<label><small>${label}</small><input data-ziel="${ziel}" inputmode="decimal" enterkeyhint="next" value="${feldText(v)}" placeholder="${platz}"></label>`;
  app.innerHTML = `
    <div class="reihe wandnav"><button id="w-vor">‹ ${G.name((i - 1 + n) % n)}</button>
      <b>Wand ${G.name(i)} von ${n}</b><button id="w-nach">${G.name((i + 1) % n)} ›</button></div>
    <svg id="ansicht" xmlns="http://www.w3.org/2000/svg"></svg>
    <label class="feld">Länge (m)<input data-ziel="laenge" inputmode="decimal" enterkeyhint="next" value="${feldText(w.laenge)}" placeholder="≈ ${de(w.skizze ?? 1, 1)}" class="${w.laenge == null ? 'leer' : ''}"></label>
    <label class="feld">Winkel am Ende (°)<input data-ziel="winkel" data-still inputmode="decimal" value="${feldText(Math.round(w.winkel * 10) / 10)}"></label>
    <label class="feld" style="grid-template-columns:48px 1fr"><input type="checkbox" id="w-mit" ${w.mitrechnen === false ? '' : 'checked'}>Wandfläche mitrechnen</label>
    <h3>Türen und Fenster</h3>
    <p class="hinweis">Abstand = von der linken Ecke (vom Raum aus auf die Wand gesehen) bis zur Öffnung.</p>
    ${w.oeffnungen.map((o, j) => `<div class="oe" id="o-${j}">
      <select data-art="o.${j}"><option value="tuer" ${o.art === 'tuer' ? 'selected' : ''}>Tür</option><option value="fenster" ${o.art === 'fenster' ? 'selected' : ''}>Fenster</option></select>
      <button class="klein weg" data-weg="o.${j}" aria-label="löschen">✕</button>
      ${feld(`o.${j}.abstand`, o.abstand, 'Abstand')}${feld(`o.${j}.breite`, o.breite, 'Breite')}${feld(`o.${j}.hoehe`, o.hoehe, 'Höhe')}${feld(`o.${j}.bruestung`, o.bruestung, 'Brüstung')}</div>`).join('')}
    <div class="reihe"><button data-neu="tuer">+ Tür</button><button data-neu="fenster">+ Fenster</button></div>
    <h3>Anschlüsse (Elektro, Wasser)</h3>
    <p class="hinweis">Abstand bis Mitte Dose, Höhe = Mitte über Fußboden.</p>
    ${w.anschluesse.map((a, j) => `<div class="oe an" id="a-${j}">
      <select data-art="a.${j}">${Object.entries(ANSCHLUESSE).map(([k, v]) => `<option value="${k}" ${a.art === k ? 'selected' : ''}>${v[0]}</option>`).join('')}
        ${ANSCHLUESSE[a.art] ? '' : `<option selected>${esc(a.art)}</option>`}</select>
      <button class="klein weg" data-weg="a.${j}" aria-label="löschen">✕</button>
      ${feld(`a.${j}.abstand`, a.abstand, 'Abstand')}${feld(`a.${j}.hoehe`, a.hoehe, 'Höhe')}</div>`).join('')}
    <div class="reihe"><button data-neu="steckdose">+ Steckdose</button><button data-neu="schalter">+ Schalter</button><button data-neu="kw">+ Wasser</button></div>
    <h3>Wand teilen ${anteil == null ? '(in der Mitte)' : '(an der angetippten Stelle)'}</h3>
    <div class="reihe"><button data-teilen="ecke">Ecke</button><button data-teilen="vor">Vorsprung</button><button data-teilen="nische">Nische</button></div>
    <div class="reihe"><button class="weg" id="w-weg">Wand löschen</button></div>`;
  const neu = () => wandSeite(b, e, r, i, anteil);
  $('#w-vor').onclick = () => geh('w', b.id, e, r, (i - 1 + n) % n);
  $('#w-nach').onclick = () => geh('w', b.id, e, r, (i + 1) % n);
  $('#w-mit').onchange = ev => { w.mitrechnen = ev.target.checked; speichern(b); ansichtNeu(w, raum); };
  zahlFelder(app, (ziel, v) => {
    const [art, j, k] = ziel.split('.');
    if (ziel === 'laenge') { if (v != null && v >= 100) return false; w.laenge = v; app.querySelector('[data-ziel="laenge"]').classList.toggle('leer', v == null); return true; }
    if (ziel === 'winkel') { if (!(v > 0 && v < 360)) return false; w.winkel = w.skizzeWinkel = v; return true; }
    if (v == null || v >= 100) return false;
    (art === 'o' ? w.oeffnungen : w.anschluesse)[j][k] = v;
    return true;
  }, () => ansichtNeu(w, raum));
  app.onchange = ev => {
    const s = ev.target.dataset.art;
    if (!s) return;
    const [art, j] = s.split('.');
    (art === 'o' ? w.oeffnungen : w.anschluesse)[j].art = ev.target.value;
    speichern(b); ansichtNeu(w, raum);
  };
  app.onclick = ev => {
    const t = ev.target.closest('button');
    if (!t) return;
    const L = w.laenge ?? w.skizze ?? 1;
    if (t.dataset.weg) { const [art, j] = t.dataset.weg.split('.'); (art === 'o' ? w.oeffnungen : w.anschluesse).splice(j, 1); }
    else if (OEFFNUNG[t.dataset.neu]) w.oeffnungen.push({ art: t.dataset.neu, abstand: r2((L - OEFFNUNG[t.dataset.neu].breite) / 2), ...OEFFNUNG[t.dataset.neu] });
    else if (t.dataset.neu) w.anschluesse.push({ art: t.dataset.neu, abstand: r2(L / 2), hoehe: anschluss(t.dataset.neu)[3], leitung: '' });
    else if (t.dataset.teilen) {
      const a = anteil ?? 0.5;
      if (t.dataset.teilen === 'ecke') G.eckeEinfuegen(raum, i, a); else G.vorsprungEinfuegen(raum, i, a, t.dataset.teilen === 'vor' ? 0.3 : -0.3);
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
  };
  ansichtNeu(w, raum);
}
const r2 = v => Math.round(v * 100) / 100;

/** Ansicht der Wand von innen: links = Wandanfang, unten = Fußboden. Mit Maßkette unten und Höhen. */
function ansichtNeu(w, raum) {
  const s = $('#ansicht');
  if (!s) return;
  s.replaceChildren();
  const L = w.laenge ?? w.skizze ?? 1, H = raum.hoehe ?? 2.5, fs = Math.max(L, H) / 20;
  s.setAttribute('viewBox', `${-fs * 3} ${-fs * 1.5} ${L + fs * 4} ${H + fs * 6}`);
  const text = (x, y, t, mehr = {}) => s.append(el('text', { x, y, 'font-size': fs * 0.75, 'text-anchor': 'middle', fill: '#1b1b1b', ...mehr }, t));
  s.append(el('rect', { x: 0, y: 0, width: L, height: H, fill: w.mitrechnen === false ? '#f1f1f1' : '#f4f8fc', stroke: '#1b1b1b', 'stroke-width': fs * 0.12,
    'stroke-dasharray': w.mitrechnen === false ? `${fs * 0.5} ${fs * 0.4}` : 'none' }));
  const kanten = [0, L];
  w.oeffnungen.forEach((o, j) => {
    const y = H - o.bruestung - o.hoehe, tuer = o.art === 'tuer';
    s.append(el('rect', { x: o.abstand, y, width: o.breite, height: o.hoehe, fill: tuer ? '#f3e2d6' : '#dbeafb',
      stroke: tuer ? '#a0522d' : '#2e86de', 'stroke-width': fs * 0.1, 'data-sel': `o-${j}` }));
    text(o.abstand + o.breite / 2, y + o.hoehe / 2, `${de(o.breite)} × ${de(o.hoehe)}`, { 'pointer-events': 'none' });
    if (o.bruestung > 0) text(o.abstand + o.breite / 2, H - o.bruestung / 2 + fs * 0.3, `Br. ${de(o.bruestung)}`, { fill: '#2e86de', 'pointer-events': 'none' });
    kanten.push(o.abstand, o.abstand + o.breite);
  });
  w.anschluesse.forEach((a, j) => {
    const [, kurz, farbe] = anschluss(a.art), x = a.abstand, y = H - a.hoehe;
    s.append(el('circle', { cx: x, cy: y, r: fs * 0.4, fill: '#fff', stroke: farbe, 'stroke-width': fs * 0.1, 'data-sel': `a-${j}` }));
    text(x, y + fs * 0.17, kurz, { fill: farbe, 'font-size': fs * 0.4, 'font-weight': 700, 'pointer-events': 'none' });
    // Maße abwechselnd über/unter dem Zeichen, damit nahe Dosen (Waschtisch) lesbar bleiben
    text(x, j % 2 ? y + fs * 1.0 : y - fs * 0.6, `${de(x)}|${de(a.hoehe)}`, { 'font-size': fs * 0.42, fill: farbe, 'pointer-events': 'none' });
  });
  // Maßkette unten (Abstände zwischen Wandecken und Öffnungskanten)
  const k = [...new Set(kanten.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b), ym = H + fs * 1.6;
  s.append(el('line', { x1: 0, y1: ym, x2: L, y2: ym, stroke: '#6b7280', 'stroke-width': fs * 0.05 }));
  k.forEach((v, j) => {
    s.append(el('line', { x1: v, y1: ym - fs * 0.4, x2: v, y2: ym + fs * 0.4, stroke: '#6b7280', 'stroke-width': fs * 0.05 }));
    if (j) text((k[j - 1] + v) / 2, ym - fs * 0.25, de(v - k[j - 1]), { fill: '#374151' });
  });
  text(L / 2, H + fs * 3.4, `Wand ${de(L)} m${w.laenge == null ? ' (ungefähr)' : ''}`, { 'font-weight': 600, fill: w.laenge == null ? '#d68910' : '#1f5f99', 'font-size': fs * 0.85 });
  text(-fs * 1.4, H / 2, `${de(H)}${raum.hoehe == null ? '?' : ''}`, { transform: `rotate(-90 ${-fs * 1.4} ${H / 2})`, fill: '#374151' });
  s.onclick = ev => {
    const sel = ev.target.dataset?.sel;
    const f = sel && app.querySelector(`#${sel} input`);
    if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
  };
}

// ---------- Start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.(); // Android soll die Daten nicht bei Platzmangel löschen
db = await dbAuf();
alle = await tx('readonly', s => s.getAll());
zeigen();
