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
  else if (art === 'h' && b?.etagen[e]) hausSeite(b, +e);
  else if (art === 'b' && b) baustelleSeite(b);
  else startSeite();
}
addEventListener('hashchange', () => { scrollTo(0, 0); zeigen(); }); // erst nach oben, dann darf die Seite ein Feld zeigen
$('#zurueck').onclick = () => {
  const [art, id, e, r] = ort();
  art === 'w' ? geh('r', id, e, r) : art === 'r' || art === 'h' ? geh('b', id) : geh('');
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
    b.toleranz ??= alt.toleranz; // Einstellung dieses Geräts behalten, der PC schreibt sie nicht mit
  }
  alle.push(b);
  await speichern(b);
  geh('b', b.id);
}

// ---------- Baustelle: Etagen und Räume ----------
// Wandbezeichnung wie im Grundriss-Editor am PC: Raumkürzel-W<Nr> (WZ-W1), Kürzel über alle Räume der Baustelle
const wb = (b, raum) => G.wandBezeichnungen(raum, G.kuerzel(b.etagen.flatMap(e => e.raeume.map(q => q.name)))[raum.name]);
const mitBez = (b, raum) => { const B = wb(b, raum); return [i => B[i], i => `Wand ${B[i]}`]; };

function raumInfo(b, r) {
  if (!r.waende.length) return 'noch keine Skizze';
  G.lueckeSchliessen(r, tol(b));
  const [nm, wn] = mitBez(b, r), p = G.pruefen(r.waende, nm), warn = G.warnungen(r, wn).length;
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
      <div class="reihe"><button data-a="raum-neu" data-e="${ei}">+ Raum</button>${e.raeume.some(q => q.waende.length) ? `<a class="knopf" href="#h/${encodeURIComponent(b.id)}/${ei}">Hausgrundriss / Räume anordnen</a>` : ''}</div>
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
      case 'raum-neu': { // Raumart wie am PC wählen (gibt das Kürzel für WZ-W1 …), sonst eigener Name
        const ei = k.dataset.e;
        k.parentElement.innerHTML = `<select data-raumart="${ei}" aria-label="Raumart"><option value="">Raumart wählen …</option>
          ${Object.entries(G.RAUMARTEN).map(([n, kz]) => `<option>${n}</option>`).join('')}<option value="*">Anderer Name …</option></select>`;
        const s = app.querySelector(`select[data-raumart="${ei}"]`);
        s.focus();
        s.onchange = async () => {
          let n = s.value === '*' ? frage('Name des Raums:') : s.value;
          if (!n) return baustelleSeite(b);
          const da = b.etagen.flatMap(q => q.raeume.map(x => x.name)), roh = n.replace(/\s*\d+$/, '');
          for (let z = 2; da.includes(n); z++) n = `${roh} ${z}`; // wie am PC: Wohnzimmer, Wohnzimmer 2 …
          e.raeume.push({ name: n, hoehe: null, notiz: '', drehung: 0, waende: [], koerper: [] });
          await speichern(b);
          geh('r', b.id, ei, e.raeume.length - 1);
        };
        return;
      }
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
    f._weiter = () => { const l = felder(), n = l.slice(l.indexOf(f) + 1).find(x => !x.hasAttribute('data-still')); n ? zeig(n) : f.blur(); };
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
let zeichnen = null; // {pkt: [[x, y] …] im Zeichenfeld (y nach unten), zug: Vorschaupunkt, arten: Wandart je Wand, art: aktuelle}
let gewaehlt = null; // {i, anteil}: in der Skizze angetippte Wand und Stelle (für Ecke, Vorsprung, Nische, Wandart)
let hervor = null; // Teil in Bearbeitung, farbig: 'w-3' Wand, 'k-1' Säule, 'o-0' / 'a-2' in der Wandansicht, 'laenge', 'raumhoehe'
let tipp = { i: -1, t: 0 }; // Doppeltipp auf eine Wand öffnet sie
let autoMeldung = '';
// Wandarten wie im Grundriss-Editor am PC; Farben wie dort (Trockenbau hellblau, Mauerwerk grau)
const WANDFARBE = art => art === 'Trockenbauwand' ? '#bfdbfe' : art === 'Außenwand' ? '#6b7280' : '#9ca3af';
const WANDART_OPT = { '': 'Wandart offen', ...Object.fromEntries(Object.entries(G.WANDARTEN).map(([k, d]) => [k, d ? `${k} ${de(d * 100, 1)} cm` : `${k} (ohne Wand)`])) };
function wandartSetzen(w, art) {
  if (!art) { delete w.wandart; delete w.dicke; }
  else {
    if (w.wandart === 'Raumgrenze' && art !== 'Raumgrenze') w.mitrechnen = true;
    Object.assign(w, { wandart: art, dicke: G.WANDARTEN[art] });
    if (art === 'Raumgrenze') w.mitrechnen = false; // keine Wand, keine Wandfläche
  }
}
// Farbig markieren, woran gerade gearbeitet wird (Feld mit dem Finger oder Laser gewählt)
app.addEventListener('focusin', ev => { if (!ev.target.closest('#zknoepfe')) markieren(ev.target); });
app.addEventListener('focusout', ev => { if (!ev.relatedTarget || !app.contains(ev.relatedTarget)) markieren(null); });
function markieren(t) {
  const d = t?.dataset || {};
  const neu = !t ? null : d.feld === 'l' ? `w-${d.i}` : d.ziel === 'laenge' || d.ziel === 'raumhoehe' ? d.ziel : t.closest('.oe')?.id || null;
  if (neu === hervor) return;
  hervor = neu;
  if ($('#skizze') && !zeichnen) zeichnenNeu();
  else if ($('#ansicht') && aktiv?.w) ansichtNeu(aktiv.w, aktiv.raum);
}

function raumSeite(b, e, r) {
  const raum = b.etagen[e].raeume[r];
  aktiv = { b, raum, e, r };
  zoomKey(`r/${b.id}/${e}/${r}`);
  raum.koerper ??= [];
  kopf(`${b.etagen[e].name} · ${raum.name}`);
  if (!raum.waende.length) zeichnen = { pkt: [], zug: null, arten: [], art: '' };
  gewaehlt = null; hervor = null;
  const WB = wb(b, raum);
  app.innerHTML = `
    <svg id="skizze" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="reihe" id="zknoepfe"></div>
    <div id="status"></div>
    <label class="feld">Raumhöhe (${einheit})<input data-feld="hoehe" inputmode="decimal" enterkeyhint="next" value="${massText(raum.hoehe)}" class="${raum.hoehe == null ? 'leer' : ''}"></label>
    <div id="masse">${raum.waende.map((w, i) => `<div class="mass">
      <button class="klein wbtn" data-wand="${i}"><b>${WB[i]}</b><small>${lage(raum, i)}</small></button>
      <input data-feld="l" data-i="${i}" inputmode="decimal" enterkeyhint="next" aria-label="Länge Wand ${WB[i]}"
             placeholder="≈ ${massText(w.skizze ?? 1)}" value="${massText(w.laenge)}" class="${w.laenge == null ? 'leer' : w.errechnet ? 'auto' : ''}">
      <span>${einheit}</span>
      <input data-feld="w" data-i="${i}" inputmode="decimal" tabindex="-1" aria-label="Winkel Ecke nach ${WB[i]}" value="${rohText(w.winkel)}">
      <span>°</span><button class="klein ent" data-wweg="${i}" aria-label="Wand ${WB[i]} löschen">✕</button><small class="ger" id="ger-${i}"></small></div>`).join('')}</div>
    ${raum.waende.length ? `<p class="hinweis">Maß in der Zeichnung oder Feld antippen, messen, Enter: das nächste Feld ist dran.
      Winkel = Ecke am Ende der Wand (90 normal, 270 vorspringend); schräge Ecken rechnet die App aus, sobald alle Wände gemessen sind (grün).
      Wand in der Zeichnung antippen = wählen (Ecke, Vorsprung, Nische, Wandart an der angetippten Stelle);
      doppelt antippen oder Wandnamen links = Wandansicht mit Türen, Fenstern, Anschlüssen. Grün = ausgerechnet.</p>
      <div class="reihe"><button class="haupt" id="r-waende">Wände der Reihe nach bemaßen</button></div>
      <h3>Säulen und Körper</h3>
      <p class="hinweis">Lage: „ab Ecke“ = entlang ${WB[0] ?? "der ersten Wand"} ab ihrem Anfang bis zur Säule, „von ${WB[0] ?? "Wand"}“ = quer von ${WB[0] ?? "der ersten Wand"} bis zur Säule.</p>
      ${raum.koerper.map((k, j) => `<div class="oe" id="k-${j}">
        <select data-form="${j}"><option value="rechteck" ${k.form === 'rechteck' ? 'selected' : ''}>Säule eckig</option><option value="kreis" ${k.form === 'kreis' ? 'selected' : ''}>Säule rund</option></select>
        <button class="klein ent" data-kweg="${j}" aria-label="löschen">✕</button>
        ${zfeld(`${j}.s`, k.s, 'ab Ecke')}${zfeld(`${j}.a`, k.a, `von ${WB[0]}`)}
        ${k.form === 'kreis' ? zfeld(`${j}.d`, k.d, 'Ø') : zfeld(`${j}.b`, k.b, 'Breite') + zfeld(`${j}.t`, k.t, 'Tiefe')}
        ${zfeld(`${j}.h`, k.h, 'Höhe', 'placeholder="Decke"')}
        <label class="breit"><small>Name</small><input data-kname="${j}" value="${esc(k.name || '')}" placeholder="z. B. Schacht"></label>
        <button class="breit schalt ${k.umbauen ? 'an' : ''}" data-kumbau="${j}">${k.umbauen ? '✓' : '＋'} mit Trockenbau umkleiden</button></div>`).join('')}
      <div class="reihe"><button id="r-saeule">+ Säule / Körper</button></div>` : ''}
    <label>Notiz<textarea id="notiz" rows="2">${esc(raum.notiz)}</textarea></label>`;
  $('#notiz').onchange = ev => { raum.notiz = ev.target.value; speichern(b); };
  app.querySelectorAll('button[data-wand]').forEach(k => { k.onclick = () => geh('w', b.id, e, r, k.dataset.wand); });
  app.querySelectorAll('button[data-wweg]').forEach(k => { k.onclick = () => wandWeg(+k.dataset.wweg); });
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
    app.querySelectorAll('[data-kumbau]').forEach(f => { f.onclick = () => { const k = raum.koerper[f.dataset.kumbau]; k.umbauen = !k.umbauen; speichern(b); raumSeite(b, e, r); }; });
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
    if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'start' }); }
  };
  skizzeEinrichten();
  zeichnenNeu();
}

/** Hausgrundriss einer Etage: Räume verschieben (rasten an anderen Räumen ein) und drehen. */
function hausSeite(b, e) {
  const et = b.etagen[e];
  kopf(`${et.name} · Hausgrundriss`);
  zoomKey(`h/${b.id}/${e}`);
  aktiv = { b, e, raum: null };
  G.hausLage(et.raeume).forEach(t => { if (!t.raum.lage) { const [x0, y0] = kasten(t.P.slice(0, -1)); t.raum.lage = [r3(x0), r3(y0)]; } }); // jetzige Stelle festhalten
  speichern(b);
  let wahl = null, tipp2 = { i: -1, t: 0 };
  app.innerHTML = `<svg id="skizze" xmlns="http://www.w3.org/2000/svg"></svg><div class="reihe" id="hk"></div>
    <p class="hinweis">Raum antippen = wählen; mit dem Finger verschieben, er rastet an den anderen Räumen ein (Wanddicke dazwischen).
      Doppelt antippen = Raum öffnen. Zwei Finger = zoomen. Neue Räume zeichnet man im Raum direkt neben die anderen.</p>`;
  const s = svg();
  const zeichne = () => {
    const liste = G.hausLage(et.raeume), alle = liste.flatMap(t => anzeige(t.P));
    if (!s._basis) { const [x0, y0, x1, y1] = kasten(alle), rd = Math.max(x1 - x0, y1 - y0, 2) * 0.1; sicht(s, [x0 - rd, y0 - rd, x1 - x0 + 2 * rd, y1 - y0 + 2 * rd]); }
    const fs = Math.max(s._basis[2], s._basis[3]) / 40;
    s.replaceChildren();
    liste.forEach(({ raum, P }) => {
      const A = anzeige(P), ri = et.raeume.indexOf(raum), [x0, y0, x1, y1] = kasten(A), an = ri === wahl;
      s.append(el('polygon', { points: A.slice(0, -1).join(' '), fill: an ? '#ead9bb' : '#f4ead9', stroke: an ? '#a77f45' : '#5c554a', 'stroke-width': fs * (an ? 0.35 : 0.2), 'data-ri': ri, style: 'cursor:move' }));
      s.append(el('text', { x: (x0 + x1) / 2, y: (y0 + y1) / 2, 'font-size': Math.min(fs * 1.2, (x1 - x0) / Math.max(3, raum.name.length) * 1.6), 'text-anchor': 'middle', fill: '#17140f', 'pointer-events': 'none' }, raum.name));
    });
    zoomAnwenden(s);
    $('#hk').innerHTML = wahl == null ? '<div class="wahl">Raum antippen, um ihn zu wählen.</div>'
      : `<div class="wahl"><b>${esc(et.raeume[wahl].name)}</b> gewählt</div><button id="h-dreh">⟳ 90° drehen</button><button class="haupt zwei" id="h-auf">Raum öffnen ›</button>`;
    if (wahl != null) {
      $('#h-dreh').onclick = () => { const q = et.raeume[wahl]; q.drehung = ((q.drehung ?? 0) - 90) % 360; speichern(b); zeichne(); };
      $('#h-auf').onclick = () => geh('r', b.id, e, wahl);
    }
  };
  const einrasten2 = (raum, lage) => { // Kanten auf Kanten der anderen Räume, mit oder ohne Wanddicke dazwischen
    const P = G.punkte(raum.waende, raum.drehung ?? 0).slice(0, -1), [x0, y0] = kasten(P);
    const eig = P.map(([x, y]) => [x - x0 + lage[0], y - y0 + lage[1]]);
    const andere = G.hausLage(et.raeume).filter(t => t.raum !== raum).flatMap(t => t.P);
    const dk = Math.max(0, ...raum.waende.map(w => w.dicke || 0)) || 0.115;
    const best = k => { let m = null;
      for (const p of eig) for (const q of andere) for (const off of [0, dk, -dk]) { const dv = q[k] + off - p[k]; if (Math.abs(dv) < 0.2 && (m == null || Math.abs(dv) < Math.abs(m))) m = dv; }
      return m ?? 0; };
    return [r3(lage[0] + best(0)), r3(lage[1] + best(1))];
  };
  gesten(s, { greifen: ziel => {
    if (ziel.dataset?.ri == null) return null;
    const raum = et.raeume[+ziel.dataset.ri], l0 = [...raum.lage];
    wahl = +ziel.dataset.ri;
    return { zieh: (dx, dy) => { raum.lage = einrasten2(raum, [l0[0] + dx, l0[1] - dy]); zeichne(); }, los: () => speichern(b) };
  } });
  s.onclick = ev => {
    if (!angetippt(s) || zoomKnopf(s, ev, zeichne)) return;
    const ri = ev.target.dataset?.ri;
    if (ri == null) { wahl = null; return zeichne(); }
    const jetzt = Date.now();
    if (tipp2.i === +ri && jetzt - tipp2.t < 450) return geh('r', b.id, e, ri);
    tipp2 = { i: +ri, t: jetzt };
    wahl = +ri;
    zeichne();
  };
  zeichne();
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
// Feld fokussieren und direkt unter die stehende Zeichnung holen (sonst verdeckt es die Handytastatur)
const zeig = f => { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'start' }); };

function weiter(f) {
  const n = aktiv.raum.waende.length;
  const i = f.dataset.feld === 'hoehe' ? 0 : +f.dataset.i + 1;
  const naechstes = i < n && app.querySelector(`input[data-feld="l"][data-i="${i}"]`);
  naechstes ? zeig(naechstes) : f.blur();
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

// ---------- Zoomen und Verschieben (zwei Finger, Mausrad, Knöpfe in der Zeichnung) ----------
let zoomZ = { key: '', f: 1, dx: 0, dy: 0 };
const zoomKey = k => { if (zoomZ.key !== k) zoomZ = { key: k, f: 1, dx: 0, dy: 0 }; };
const zoomGrenze = f => Math.min(12, Math.max(0.2, f));
/** Grundausschnitt [x, y, w, h] setzen; Zoom und Verschiebung kommen dazu, Knöpfe oben rechts. */
function sicht(s, box, knoepfe = {}) { s._basis = box; s._knoepfe = knoepfe; zoomAnwenden(s); }
function zoomAnwenden(s) {
  const [x, y, w, h] = s._basis, W = w / zoomZ.f, H = h / zoomZ.f, cx = x + w / 2 + zoomZ.dx, cy = y + h / 2 + zoomZ.dy;
  s.setAttribute('viewBox', `${cx - W / 2} ${cy - H / 2} ${W} ${H}`);
  s.querySelector('#zk')?.remove();
  const cw = s.clientWidth || 300, ch = s.clientHeight || 300, u = Math.max(W / cw, H / ch); // m je Bildschirmpunkt
  const g = el('g', { id: 'zk' }), k = 38 * u, rechts = cx + cw * u / 2 - 6 * u, oben = cy - ch * u / 2 + 6 * u;
  const knopf = (x0, y0, b, text, z) => {
    g.append(el('rect', { x: x0, y: y0, width: b, height: k, rx: 6 * u, fill: '#fbfaf7', stroke: '#cfc7b7', 'stroke-width': u, 'data-zoom': z, opacity: 0.92 }));
    g.append(el('text', { x: x0 + b / 2, y: y0 + k * 0.68, 'font-size': 17 * u, 'text-anchor': 'middle', fill: '#17140f', 'data-zoom': z, 'font-weight': 600 }, text));
  };
  [['+', '+'], ['−', '-'], ['⤢', '0'], ...(s._knoepfe.haus ? [['⌂', 'haus']] : [])].forEach(([t, z], n) => knopf(rechts - k, oben + n * (k + 4 * u), k, t, z));
  if (s._knoepfe.bau != null) knopf(cx - cw * u / 2 + 6 * u, oben, 128 * u, s._knoepfe.bau ? 'Skizze' : 'Bauzeichnung', 'bau');
  s.append(g);
  queueMicrotask(() => { if (g.isConnected) s.append(g); }); // Knöpfe über allem, was danach gezeichnet wird
}
/** Knopf in der Zeichnung angetippt? true = erledigt. */
function zoomKnopf(s, ev, neu) {
  const z = ev.target.dataset?.zoom;
  if (!z) return false;
  if (z === '+' || z === '-') zoomZ.f = zoomGrenze(zoomZ.f * (z === '+' ? 1.4 : 1 / 1.4));
  else if (z === '0') Object.assign(zoomZ, { f: 1, dx: 0, dy: 0 });
  else if (z === 'haus') { const [x, y, w, h] = s._basis, [hx, hy, hw, hh] = s._knoepfe.haus;
    Object.assign(zoomZ, { f: zoomGrenze(Math.min(w / hw, h / hh)), dx: hx + hw / 2 - x - w / 2, dy: hy + hh / 2 - y - h / 2 }); }
  else if (z === 'bau') { bauAnsicht = !bauAnsicht; merken('bau', bauAnsicht ? '1' : ''); return neu(), true; }
  zoomAnwenden(s);
  return true;
}
/** Finger-Gesten: ein Finger schiebt (oder zieht, was greifen() liefert), zwei Finger zoomen, lange drücken = lang(). */
function gesten(s, o = {}) {
  const f = new Map();
  let g = null;
  s.addEventListener('pointerdown', ev => {
    s._klickWeg = false;
    if (o.aus?.()) return;
    f.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (f.size === 2) { clearTimeout(g?.lt); const [a, b] = [...f.values()]; g = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, f0: zoomZ.f, bewegt: true }; return; }
    const vb = s.viewBox.baseVal, ziel = ev.target;
    g = { x: ev.clientX, y: ev.clientY, dx0: zoomZ.dx, dy0: zoomZ.dy, u: Math.max(vb.width / s.clientWidth, vb.height / s.clientHeight), bewegt: false,
          zug: ziel.dataset?.zoom ? null : o.greifen?.(ziel) || null };
    if (o.lang) g.lt = setTimeout(() => { if (g && !g.bewegt) { g.lang = true; navigator.vibrate?.(30); o.lang(ziel, ev); } }, 550);
  });
  s.addEventListener('pointermove', ev => {
    if (!g || !f.has(ev.pointerId)) return;
    f.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (g.pinch) { const [a, b] = [...f.values()]; zoomZ.f = zoomGrenze(g.f0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / g.pinch); return zoomAnwenden(s); }
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y;
    if (!g.bewegt && Math.hypot(dx, dy) < 8) return;
    g.bewegt = true; clearTimeout(g.lt);
    if (g.zug) return g.zug.zieh(dx * g.u, dy * g.u);
    zoomZ.dx = g.dx0 - dx * g.u; zoomZ.dy = g.dy0 - dy * g.u;
    zoomAnwenden(s);
  });
  const ende = ev => {
    f.delete(ev.pointerId);
    if (!g) return;
    clearTimeout(g.lt);
    if (g.bewegt || g.lang) s._klickWeg = true; // kein Antippen nach Schieben oder langem Drücken
    if (g.bewegt) g.zug?.los?.();
    if (g.pinch || !f.size) g = null;
  };
  s.addEventListener('pointerup', ende);
  s.addEventListener('pointercancel', ende);
  s.addEventListener('wheel', ev => { if (o.aus?.()) return; ev.preventDefault(); zoomZ.f = zoomGrenze(zoomZ.f * (ev.deltaY < 0 ? 1.2 : 1 / 1.2)); zoomAnwenden(s); }, { passive: false });
}
const angetippt = s => { if (!s._klickWeg) return true; s._klickWeg = false; return false; };

// ---------- Hausgrundriss: alle Räume der Etage, Raum in Bearbeitung hervorgehoben ----------
const ROT = '#c62828'; // Wand in Bearbeitung (Pauls Wunsch: rot)
let bauAnsicht = (() => { try { return localStorage.getItem('bau') === '1'; } catch { return false; } })();
const haus = (b, e) => G.hausLage(b.etagen[e].raeume);
const anzeige = P => P.map(([x, y]) => [x, -y]);
const kasten = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
/** Andere Räume grau zeichnen (blass = es wird gerade eine Wand bearbeitet). Antippen öffnet den Raum. */
function andereRaeume(s, liste, raum, fs, blass) {
  liste.forEach(({ raum: q, P }) => {
    if (q === raum) return;
    const A = anzeige(P);
    s.append(el('polygon', { points: A.slice(0, -1).join(' '), fill: '#ece8e0', stroke: '#b9b1a3', 'stroke-width': fs * 0.12, opacity: blass ? 0.45 : 0.9, 'data-raum': q.name }));
    const [x0, y0, x1, y1] = kasten(A);
    s.append(el('text', { x: (x0 + x1) / 2, y: (y0 + y1) / 2, 'font-size': fs * 0.8, 'text-anchor': 'middle', fill: '#9a9284', opacity: blass ? 0.5 : 1, 'pointer-events': 'none' }, q.name));
  });
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
    zeichnen.arten.push(zeichnen.art);
    zeichnenNeu();
  };
  const stelle = (ev, i) => { // angetippte Stelle 0…1 auf Wand i
    const [x, y] = svgPunkt(ev), P = punkteAnzeige(), [a, c] = [P[i], P[i + 1]], dx = c[0] - a[0], dy = c[1] - a[1];
    return Math.min(0.9, Math.max(0.1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  };
  gesten(s, { aus: () => !!zeichnen, lang: (ziel, ev) => { // lange drücken: Wand wählen (mit „Wand löschen“)
    if (ziel.dataset?.i == null) return;
    gewaehlt = { i: +ziel.dataset.i, anteil: stelle(ev, +ziel.dataset.i) };
    zeichnenNeu();
  } });
  s.onclick = ev => {
    if (zeichnen || !angetippt(s) || zoomKnopf(s, ev, zeichnenNeu)) return;
    const d = ev.target.dataset || {}, { b, e, r } = aktiv;
    if (d.raum != null) { const ri = b.etagen[e].raeume.findIndex(q => q.name === d.raum); if (ri >= 0) return geh('r', b.id, e, ri); }
    if (d.mass != null) { // Maß in der Zeichnung antippen: Feld ist bereit für den Laser
      gewaehlt = { i: +d.mass, anteil: 0.5 };
      return zeig(app.querySelector(`input[data-feld="l"][data-i="${d.mass}"]`));
    }
    if (d.teil) { const [i, sel] = d.teil.split(':'); return geh('w', b.id, e, r, i, '', sel); }
    if (d.i == null) { gewaehlt = null; return zeichnenNeu(); } // daneben getippt: Auswahl weg
    const i = +d.i, t = stelle(ev, i), n = aktiv.raum.waende.length;
    const jetzt = Date.now(), doppelt = tipp.i === i && jetzt - tipp.t < 450;
    tipp = { i, t: jetzt };
    if (doppelt) return geh('w', b.id, e, r, i, (gewaehlt?.i === i ? gewaehlt.anteil : t).toFixed(2));
    const g = gewaehlt;
    if (g && g.j == null && g.i !== i && ((g.i + 1) % n === i || (i + 1) % n === g.i)) g.j = i; // Nachbarwand dazu: Ecke dazwischen
    else gewaehlt = { i, anteil: t }; // erster Tipp wählt die Wand und die Stelle
    zeichnenNeu();
  };
}

function schliessen() {
  const pk = zeichnen.pkt;
  if (pk.length < 3) return alert('Ein Raum braucht mindestens 3 Wände.');
  const { b, raum } = aktiv, pts = pk.map(([x, y]) => [x, -y]), arten = [...zeichnen.arten, zeichnen.art];
  if (zeichnen.fest) { if (!G.anhaengen(raum, pts, arten)) return alert('Bitte in derselben Richtung weiterzeichnen wie die bestehenden Wände (bis zum grünen Anfang).'); }
  else Object.assign(raum, G.ausPunkten(pts, arten));
  const [x0, y0] = kasten(pts);
  raum.lage = [Math.round(x0 * 1000) / 1000, Math.round(y0 * 1000) / 1000]; // da, wo gezeichnet wurde (wie am PC)
  zeichnen = null;
  speichern(b);
  zeigen();
}

/** Eckpunkte des Raums auf dem Bildschirm (y nach unten), in Hauskoordinaten der Etage. */
const punkteAnzeige = (raum = aktiv.raum) => anzeige(versatz(raum).P);
const versatz = (raum = aktiv.raum) => haus(aktiv.b, aktiv.e).find(t => t.raum === raum) ?? { ox: 0, oy: 0, P: G.punkte(raum.waende, raum.drehung ?? 0) };

// ---------- Bauzeichnung (übliche Darstellung nach DIN 1356-1 / DIN 406) ----------
/** Maßzahl wie in Bauzeichnungen: unter 1 m in cm, sonst in m; der Millimeter hochgestellt (88⁵, 1,38⁵). */
function din(v) {
  const mm = Math.round(v * 1000), cm = Math.floor(mm / 10), rest = mm % 10;
  return [mm < 1000 ? String(cm) : (cm / 100).toFixed(2).replace('.', ','), rest ? String(rest) : ''];
}
function dinText(x, y, v, attr, vor = '') {
  const [h, hoch] = din(v), t = el('text', attr);
  t.setAttribute('x', x); t.setAttribute('y', y);
  t.append(el('tspan', {}, vor + h));
  if (hoch) t.append(el('tspan', { dy: '-0.4em', 'font-size': '70%' }, hoch));
  return t;
}
const MAUERWERK = ['Außenwand', 'Tragende Wand', 'Halbsteinwand'];
/** Wände mit echter Dicke: Mauerwerk schräg schraffiert, Trockenbau mit Dämmstoff-Zickzack, Öffnungen ausgespart,
 *  Türen mit Aufschlag, Fenster mit Glaslinien; innen je Wand eine Maßkette mit Schrägstrichen; Raumstempel. */
function bauZeichnen(s, raum, P, fs, akt, akt2, pr) {
  const w = raum.waende, n = w.length, zu = pr.luecke <= 0.01 && n >= 3, L = 0.018; // Linienstärke in m
  const defs = el('defs', {});
  defs.innerHTML = `<pattern id="mw" patternUnits="userSpaceOnUse" width="0.06" height="0.06" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="0.06" stroke="#17140f" stroke-width="0.008"/></pattern>`;
  s.append(defs);
  const U = i => { const [a, c] = [P[i], P[i + 1]], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; };
  const N = i => { const u = U(i); return [u[1], -u[0]]; }; // nach außen
  const d = i => w[i].dicke || 0;
  const Q = k => { // Außenecke am Punkt k: Schnitt der versetzten Außenkanten der Wände k-1 und k (Gehrung)
    const hat = j => j >= 0 && j < n, vor = zu ? (k - 1 + n) % n : k - 1, nach = zu ? k % n : k;
    if (!hat(nach)) return [P[k][0] + N(vor)[0] * d(vor), P[k][1] + N(vor)[1] * d(vor)];
    const B = [P[k][0] + N(nach)[0] * d(nach), P[k][1] + N(nach)[1] * d(nach)];
    if (!hat(vor)) return B;
    const A = [P[k][0] + N(vor)[0] * d(vor), P[k][1] + N(vor)[1] * d(vor)], u1 = U(vor), u2 = U(nach), kr = u1[0] * u2[1] - u1[1] * u2[0];
    if (Math.abs(kr) < 1e-6) return B;
    const t = ((B[0] - A[0]) * u2[1] - (B[1] - A[1]) * u2[0]) / kr;
    return [A[0] + u1[0] * t, A[1] + u1[1] * t];
  };
  const innen = [];
  w.forEach((wd, i) => {
    const [a, c] = [P[i], P[i + 1]], u = U(i), nn = N(i), dd = d(i), an = i === akt || i === akt2, lg = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const auf = (p, t, q = 0) => [p[0] + u[0] * t + nn[0] * q, p[1] + u[1] * t + nn[1] * q];
    if (wd.wandart === 'Raumgrenze') s.append(el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: an ? ROT : '#5c554a', 'stroke-width': L, 'stroke-dasharray': '0.25 0.06 0.03 0.06' }));
    else if (dd > 0) {
      const q1 = Q(i), q2 = Q(i + 1);
      s.append(el('polygon', { points: [a, c, q2, q1].join(' '), fill: MAUERWERK.includes(wd.wandart) ? 'url(#mw)' : '#fff', stroke: an ? ROT : '#17140f', 'stroke-width': an ? L * 2.5 : L }));
      if (wd.wandart === 'Trockenbauwand') { // Beplankung innen/außen, dazwischen Dämmstoff (Zickzack)
        const pl = Math.min(0.0125, dd * 0.15), zz = [], sch = dd * 0.6;
        [pl, dd - pl].forEach(q => s.append(el('line', { x1: auf(a, 0, q)[0], y1: auf(a, 0, q)[1], x2: auf(c, 0, q)[0], y2: auf(c, 0, q)[1], stroke: '#17140f', 'stroke-width': L * 0.5 })));
        for (let t = 0, k = 0; t <= lg; t += sch / 2, k++) zz.push(auf(a, t, k % 2 ? dd - pl * 1.5 : pl * 1.5));
        s.append(el('polyline', { points: zz.join(' '), fill: 'none', stroke: '#5c554a', 'stroke-width': L * 0.4 }));
      }
    } else s.append(el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: an ? ROT : '#17140f', 'stroke-width': an ? L * 5 : L * 3 })); // Wandart offen
    const dz = dd || 0.1;
    for (const o of wd.oeffnungen || []) {
      const p1 = auf(a, o.abstand), p2 = auf(a, o.abstand + o.breite);
      s.append(el('polygon', { points: [p1, p2, auf(p2, 0, dz), auf(p1, 0, dz)].join(' '), fill: '#fffdf8', stroke: 'none' }));
      [p1, p2].forEach(p => s.append(el('line', { x1: p[0], y1: p[1], x2: auf(p, 0, dz)[0], y2: auf(p, 0, dz)[1], stroke: '#17140f', 'stroke-width': L })));
      if (o.art === 'fenster') [0.35, 0.5, 0.65].forEach(f => { const g1 = auf(p1, 0, dz * f), g2 = auf(p2, 0, dz * f);
        s.append(el('line', { x1: g1[0], y1: g1[1], x2: g2[0], y2: g2[1], stroke: '#17140f', 'stroke-width': L * (f === 0.5 ? 0.4 : 0.7) })); });
      else { // Tür: Blatt und Aufschlag in den Raum
        const r = o.breite, ende = [p1[0] - nn[0] * r, p1[1] - nn[1] * r];
        s.append(el('line', { x1: p1[0], y1: p1[1], x2: ende[0], y2: ende[1], stroke: '#17140f', 'stroke-width': L }));
        s.append(el('path', { d: `M ${p2[0]} ${p2[1]} A ${r} ${r} 0 0 1 ${ende[0]} ${ende[1]}`, fill: 'none', stroke: '#5c554a', 'stroke-width': L * 0.5 }));
      }
    }
    // Maßkette innen: Wandstücke und Öffnungen, Breite über, Höhe unter der Maßlinie
    const ab = fs * 1.9, ins = [-nn[0], -nn[1]], kette = (abst, pkt, texte) => {
      const at = t => [a[0] + u[0] * t + ins[0] * abst, a[1] + u[1] * t + ins[1] * abst];
      const [s0, s1] = [at(pkt[0]), at(pkt.at(-1))];
      s.append(el('line', { x1: s0[0], y1: s0[1], x2: s1[0], y2: s1[1], stroke: '#17140f', 'stroke-width': L * 0.6 }));
      const sl = fs * 0.28, sx = (u[0] + ins[0]) * sl, sy = (u[1] + ins[1]) * sl;
      pkt.forEach(t => { const m = at(t), h = auf(a, t);
        s.append(el('line', { x1: h[0] + ins[0] * fs * 0.3, y1: h[1] + ins[1] * fs * 0.3, x2: m[0] + ins[0] * fs * 0.3, y2: m[1] + ins[1] * fs * 0.3, stroke: '#5c554a', 'stroke-width': L * 0.4 }));
        s.append(el('line', { x1: m[0] - sx, y1: m[1] - sy, x2: m[0] + sx, y2: m[1] + sy, stroke: '#17140f', 'stroke-width': L * 1.2 })); });
      let wi = Math.atan2(u[1], u[0]) * 180 / Math.PI;
      if (wi > 90.01 || wi <= -90) wi += 180; // Schrift lesbar von unten oder rechts
      const hoch = [Math.sin(wi * Math.PI / 180), -Math.cos(wi * Math.PI / 180)];
      texte.forEach(([t0, t1, oben, unten]) => {
        const m = at((t0 + t1) / 2), attr = (dy) => ({ 'font-size': fs * 0.62, 'text-anchor': 'middle', fill: '#17140f', 'data-mass': i, style: 'cursor:pointer',
          transform: `rotate(${wi} ${m[0] + hoch[0] * dy} ${m[1] + hoch[1] * dy})` });
        s.append(dinText(m[0] + hoch[0] * fs * 0.2, m[1] + hoch[1] * fs * 0.2, oben, attr(fs * 0.2)));
        if (unten) s.append(dinText(m[0] - hoch[0] * fs * 0.75, m[1] - hoch[1] * fs * 0.75, unten[0], attr(-fs * 0.75), unten[1]));
      });
    };
    const oe = [...(wd.oeffnungen || [])].sort((x, y) => x.abstand - y.abstand), pkt = [0], texte = [];
    for (const o of oe) {
      if (o.abstand > pkt.at(-1) + 0.001) texte.push([pkt.at(-1), o.abstand, o.abstand - pkt.at(-1)]);
      texte.push([o.abstand, o.abstand + o.breite, o.breite, [o.hoehe, o.art === 'fenster' && o.bruestung ? `BRH ${din(o.bruestung).join('')} · ` : '']]);
      pkt.push(o.abstand, o.abstand + o.breite);
    }
    if (lg > pkt.at(-1) + 0.001) texte.push([pkt.at(-1), lg, lg - pkt.at(-1)]);
    pkt.push(lg);
    kette(ab, [...new Set(pkt)], texte);
    if (oe.length) kette(ab + fs * 1.3, [0, lg], [[0, lg, lg]]); // Gesamtmaß
    innen.push(lg);
  });
  // Raumstempel: Name, Fläche, Umfang, lichte Höhe
  const [x0, y0, x1, y1] = kasten(P.slice(0, -1)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, z = fs * 0.72;
  const zeilen = [raum.name, `A = ${de(pr.flaeche)} m²`, `U = ${de(innen.reduce((t, v) => t + v, 0))} m`, ...(raum.hoehe ? [`LH = ${de(raum.hoehe)} m`] : [])];
  s.append(el('rect', { x: cx - fs * 3.4, y: cy - z * 1.3, width: fs * 6.8, height: z * (zeilen.length * 1.25 + 0.6), fill: '#fffdf8', stroke: '#17140f', 'stroke-width': L * 0.6, 'pointer-events': 'none' }));
  zeilen.forEach((t, k) => s.append(el('text', { x: cx, y: cy + k * z * 1.25, 'font-size': z, 'text-anchor': 'middle', 'font-weight': k ? 400 : 700, fill: '#17140f', 'pointer-events': 'none' }, t)));
}

/** Wand löschen: der Raum ist dann offen (Lücke), weiterzeichnen oder automatisch schließen. */
function wandWeg(i) {
  const { b, raum, e, r } = aktiv, [nm] = mitBez(b, raum);
  if (!confirm(`Wand ${nm(i)} mit ihren Türen, Fenstern und Anschlüssen löschen?`)) return;
  G.wandLoeschen(raum, i);
  gewaehlt = null;
  speichern(b);
  raumSeite(b, e, r);
}

function zeichnenNeu() {
  const s = svg(), { raum, b } = aktiv;
  s.replaceChildren();
  const knoepfe = $('#zknoepfe');
  if (zeichnen) { // gezeichnet wird in Hauskoordinaten: die anderen Räume der Etage stehen grau daneben
    const liste = haus(b, aktiv.e).filter(t => t.raum !== raum), pk = zeichnen.pkt;
    if (!zeichnen.box) { // Zeichenfeld einmal festlegen (springt sonst beim Ziehen)
      const alle0 = pk.length ? pk : liste.flatMap(t => anzeige(t.P)); // weiterzeichnen: um den Raum herum, sonst ganzes Haus
      let [x0, y0, x1, y1] = alle0.length ? kasten(alle0) : [0, 0, 0, 0];
      if (!pk.length && liste.length) x1 += 8; // Platz rechts daneben für den neuen Raum
      const gr = Math.max(pk.length ? 6 : 10, x1 - x0 + 3, y1 - y0 + 3), mx = Math.round((x0 + x1) / 2), my = Math.round((y0 + y1) / 2);
      zeichnen.box = alle0.length ? [mx - gr / 2, my - gr / 2, gr, gr] : [0, 0, 10, 10];
    }
    const [bx, by, bw] = zeichnen.box;
    s.setAttribute('viewBox', zeichnen.box.join(' '));
    for (let i = Math.ceil(bx); i < bx + bw; i++) s.append(el('line', { x1: i, y1: by, x2: i, y2: by + bw, stroke: '#e3ddd1', 'stroke-width': bw * 0.002 }));
    for (let i = Math.ceil(by); i < by + bw; i++) s.append(el('line', { x1: bx, y1: i, x2: bx + bw, y2: i, stroke: '#e3ddd1', 'stroke-width': bw * 0.002 }));
    andereRaeume(s, liste, raum, bw / 30, false);
    const alle_ = zeichnen.zug ? [...pk, zeichnen.zug] : pk, fest = zeichnen.fest || 0;
    alle_.slice(1, Math.max(1, fest)).forEach((q, k) => s.append(el('line', { x1: alle_[k][0], y1: alle_[k][1], x2: q[0], y2: q[1], stroke: '#17140f', 'stroke-width': 0.1, 'stroke-linecap': 'round' })));
    alle_.slice(1).forEach((q, k) => { // jede Wand in der Farbe ihrer Wandart (offen = braun)
      if (k < fest - 1) return; // bestehende Wände oben schon gezeichnet
      const art = zeichnen.arten[k - Math.max(0, fest - 1)] ?? zeichnen.art, a = alle_[k];
      if (art && G.WANDARTEN[art]) s.append(el('line', { x1: a[0], y1: a[1], x2: q[0], y2: q[1], stroke: WANDFARBE(art), 'stroke-width': 0.3, 'stroke-linecap': 'round' }));
      s.append(el('line', { x1: a[0], y1: a[1], x2: q[0], y2: q[1], stroke: art === 'Raumgrenze' ? '#9a9284' : '#7e5c2e', 'stroke-width': 0.08,
        'stroke-dasharray': art === 'Raumgrenze' ? '0.2 0.15' : 'none', 'stroke-linecap': 'round' }));
    });
    if (pk.length) s.append(el('circle', { cx: pk[0][0], cy: pk[0][1], r: pk.length >= 3 ? 0.35 : 0.15, fill: '#3f7d5a', opacity: 0.8 }));
    if (zeichnen.zug) {
      const a = pk.at(-1), q = zeichnen.zug;
      s.append(el('text', { x: q[0], y: q[1] - 0.35, 'font-size': 0.45, 'text-anchor': 'middle', fill: '#7e5c2e' },
        `≈ ${de(Math.hypot(q[0] - a[0], q[1] - a[1]), 1)} m`));
    }
    $('#status').textContent = fest ? 'Vom roten Ende der letzten Wand aus weiterzeichnen, bis zum grünen Anfang.' : !pk.length ? 'Mit dem Finger Wand für Wand ziehen, im Uhrzeigersinn oder andersherum.'
      : pk.length < 3 ? 'Nächste Wand vom Ende der letzten aus ziehen. Ecken rasten bei 90° und 45° ein.'
      : 'Am grünen Startpunkt loslassen oder „Schließen“ tippen: dann ist der Raum fertig skizziert.';
    knoepfe.innerHTML = `<label class="feld breit">Wandart der nächsten Wand${auswahl('id="z-art"', WANDART_OPT, zeichnen.art)}</label>
      <button id="z-rueck" ${pk.length ? '' : 'disabled'}>Rückgängig</button>
      <button class="haupt" id="z-zu" ${pk.length >= 3 ? '' : 'disabled'}>Schließen</button>`;
    $('#z-art').onchange = ev => { zeichnen.art = ev.target.value; };
    if (fest) { $('#z-rueck').disabled = pk.length <= fest; s.append(el('circle', { cx: pk[fest - 1][0], cy: pk[fest - 1][1], r: 0.2, fill: ROT })); }
    $('#z-rueck').onclick = () => { if (pk.length <= fest) return; pk.pop(); zeichnen.arten.splice(Math.max(0, pk.length - Math.max(1, fest))); zeichnenNeu(); };
    $('#z-zu').onclick = schliessen;
    return;
  }

  // Ausgerechnete Längen nachziehen; sind alle Wände gemessen: schräge Ecken ausrechnen, kleine Lücken schließen oder nachfragen
  const w = raum.waende;
  if (w.some(x => x.errechnet)) G.autoSchliessen(raum, true);
  const zu = G.lueckeSchliessen(raum, tol(b));
  speichern(b);
  app.querySelectorAll('input[data-feld="l"]').forEach(f => {
    const x = w[f.dataset.i];
    if (!x) return;
    f.classList.toggle('auto', !!x.errechnet);
    if (x.errechnet && document.activeElement !== f) f.value = massText(x.laenge);
  });
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
  const [nm, wn] = mitBez(b, raum), P = punkteAnzeige(), pr = G.pruefen(w, nm), warn = G.warnungen(raum, wn);
  const [x0, y0, x1, y1] = kasten(P), liste = haus(b, aktiv.e);
  const gr = Math.max(x1 - x0, y1 - y0, 1), rand = gr * 0.25, fs = gr / 18;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, MESSING = '#a77f45';
  const akt = hervor?.startsWith('w-') ? +hervor.slice(2) : gewaehlt?.i ?? null; // Wand in Bearbeitung
  let [vx, vy] = [0, 0];
  if (akt != null && P[akt + 1]) { // Ausschnitt rutscht ein Stück zur Wand hin, der Raum bleibt ganz sichtbar
    vx = ((P[akt][0] + P[akt + 1][0]) / 2 - mx) * 0.35; vy = ((P[akt][1] + P[akt + 1][1]) / 2 - my) * 0.35;
  }
  const hk = kasten(liste.flatMap(t => anzeige(t.P))), hr = Math.max(hk[2] - hk[0], hk[3] - hk[1], 1) * 0.08;
  sicht(s, [x0 - rand + vx, y0 - rand + vy, x1 - x0 + 2 * rand, y1 - y0 + 2 * rand],
    { bau: bauAnsicht, ...(liste.length > 1 ? { haus: [hk[0] - hr, hk[1] - hr, hk[2] - hk[0] + 2 * hr, hk[3] - hk[1] + 2 * hr] } : {}) });
  andereRaeume(s, liste, raum, fs, akt != null);
  s.append(el('polygon', { points: P.slice(0, -1).join(' '), fill: bauAnsicht ? '#fffdf8' : '#f4ead9' }));
  if (bauAnsicht) bauZeichnen(s, raum, P, fs, akt, gewaehlt?.j, pr);
  w.forEach((wd, i) => {
    const [a, c] = [P[i], P[i + 1]], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const u = [(c[0] - a[0]) / l, (c[1] - a[1]) / l], aussen = [u[1], -u[0]]; // links der Laufrichtung (Bildschirm) = außen
    const an = i === akt || gewaehlt?.j === i;
    if (bauAnsicht) return s.append(el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: 'transparent', 'stroke-width': fs * 2.2, 'data-i': i, style: 'cursor:pointer' }));
    if (wd.dicke > 0) { // Wandart: Wanddicke nach außen, Farbe wie im Grundriss-Editor
      const h = wd.dicke / 2;
      s.append(el('line', { x1: a[0] + aussen[0] * h, y1: a[1] + aussen[1] * h, x2: c[0] + aussen[0] * h, y2: c[1] + aussen[1] * h,
        stroke: WANDFARBE(wd.wandart), 'stroke-width': wd.dicke, 'pointer-events': 'none' }));
    }
    const grenze = wd.wandart === 'Raumgrenze';
    s.append(el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: an ? ROT : wd.mitrechnen === false ? '#9a9284' : '#17140f',
      'stroke-width': fs * (an ? 0.5 : grenze ? 0.15 : 0.25), 'stroke-dasharray': wd.mitrechnen === false ? `${fs * 0.5} ${fs * 0.4}` : 'none', 'stroke-linecap': 'round' }));
    s.append(el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: 'transparent', 'stroke-width': fs * 2.2, 'data-i': i, style: 'cursor:pointer' }));
    (wd.oeffnungen || []).forEach((o, j) => {
      const p1 = [a[0] + u[0] * o.abstand, a[1] + u[1] * o.abstand], p2 = [p1[0] + u[0] * o.breite, p1[1] + u[1] * o.breite];
      s.append(el('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: o.art === 'tuer' ? '#a0522d' : '#2e86de', 'stroke-width': fs * 0.7, 'data-teil': `${i}:o-${j}` }));
    });
    (wd.anschluesse || []).forEach((an, j) =>
      s.append(el('circle', { cx: a[0] + u[0] * an.abstand - aussen[0] * fs * 0.4, cy: a[1] + u[1] * an.abstand - aussen[1] * fs * 0.4, r: fs * 0.25, fill: anschluss(an.art)[2], 'data-teil': `${i}:a-${j}` })));
    const ab = fs * (1.1 + Math.abs(aussen[0]) * 1.8) + (wd.dicke || 0); // senkrechte Wände: waagrechter Text braucht mehr Platz; Wanddicke dazu
    const m = [(a[0] + c[0]) / 2 + aussen[0] * ab, (a[1] + c[1]) / 2 + aussen[1] * ab], ger = zu.korrigiert.includes(i);
    // zweizeilig: Wandname klein über dem Maß, damit es auch an senkrechten Wänden in die Zeichnung passt
    const t = el('text', { x: m[0], y: m[1] - fs * 0.15, 'font-size': fs, 'text-anchor': 'middle', 'font-weight': 600, 'data-mass': i, style: 'cursor:pointer',
      fill: an ? '#17140f' : wd.laenge == null ? '#a77f45' : ger ? '#b4532a' : wd.errechnet ? '#3f7d5a' : '#7e5c2e' });
    if (an) s.append(el('rect', { x: m[0] - fs * 1.9, y: m[1] - fs * 0.95, width: fs * 3.8, height: fs * 2.2, rx: fs * 0.3, fill: '#ead9bb', 'pointer-events': 'none' }));
    t.append(el('tspan', { x: m[0], 'font-size': fs * 0.7, 'font-weight': 400, 'data-mass': i }, nm(i)),
      el('tspan', { x: m[0], dy: fs * 1.05, 'data-mass': i }, wd.laenge == null ? '?' : massText(G.wandLaenge(wd)) + (ger ? '*' : '')));
    s.append(t);
    if (Math.abs(wd.winkel - 90) > 0.05) {
      const ecke = P[i + 1], d = Math.hypot(mx - ecke[0], my - ecke[1]) || 1; // Winkel zur Raummitte hin versetzt
      s.append(el('text', { x: ecke[0] + (mx - ecke[0]) / d * fs * 1.6, y: ecke[1] + (my - ecke[1]) / d * fs * 1.6 + fs * 0.3, 'font-size': fs * 0.8, 'text-anchor': 'middle', fill: zu.frei.includes(i) ? '#3f7d5a' : '#5c554a' }, `${de(wd.winkel, 1)}°`));
    }
  });
  const dr = (raum.drehung ?? 0) * Math.PI / 180, { ox, oy } = versatz(), dreh = ([x, y]) => [x * Math.cos(dr) - y * Math.sin(dr) + ox, -(x * Math.sin(dr) + y * Math.cos(dr) + oy)];
  raum.koerper.forEach((k, j) => {
    const [cx, cy] = G.koerperMitte(k), schlecht = warn.some(x => x.ziel === `k-${j}`);
    const form = k.form === 'kreis'
      ? el('circle', { cx: dreh([cx, cy])[0], cy: dreh([cx, cy])[1], r: k.d / 2 })
      : el('polygon', { points: [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => dreh([cx + sx * k.b / 2, cy + sy * k.t / 2])).join(' ') });
    const kan = hervor === `k-${j}`;
    form.setAttribute('fill', kan || schlecht ? '#ead9bb' : '#e3ddd1');
    form.setAttribute('stroke', kan ? MESSING : schlecht ? '#b4532a' : '#5c554a');
    form.setAttribute('stroke-width', fs * (kan ? 0.3 : 0.12));
    s.append(form);
  });
  if (pr.luecke > 0.0005) {
    const [e, a] = [P.at(-1), P[0]];
    s.append(el('line', { x1: e[0], y1: e[1], x2: a[0], y2: a[1], stroke: '#b4532a', 'stroke-width': fs * 0.2, 'stroke-dasharray': `${fs * 0.4} ${fs * 0.3}` }));
    s.append(el('circle', { cx: e[0], cy: e[1], r: fs * 0.3, fill: '#b4532a' }));
    s.append(el('text', { x: (e[0] + a[0]) / 2, y: (e[1] + a[1]) / 2 - fs * 0.4, 'font-size': fs * 0.9, 'text-anchor': 'middle', fill: '#b4532a' }, `Lücke ${massText(pr.luecke)}`));
  }
  if (gewaehlt && w[gewaehlt.i]) { // angetippte Stelle auf der gewählten Wand
    const [a, c] = [P[gewaehlt.i], P[gewaehlt.i + 1]], t = gewaehlt.anteil;
    s.append(el('circle', { cx: a[0] + (c[0] - a[0]) * t, cy: a[1] + (c[1] - a[1]) * t, r: fs * 0.45, fill: '#fff', stroke: MESSING, 'stroke-width': fs * 0.2, 'pointer-events': 'none' }));
  }
  const teile = [], lk = `${massText(zu.luecke ?? pr.luecke)} ${einheit}`;
  if (autoMeldung) { teile.push(`<span class="gut">${autoMeldung}</span>`); autoMeldung = ''; }
  if (pr.fehlt.length) teile.push(`Maß fehlt: ${pr.fehlt.join(', ')}`);
  if (zu.frei.length) teile.push(`Winkel ausgerechnet: ${zu.frei.map(i => `${nm(i)} ${de(w[i].winkel, 1)}°`).join(', ')}`);
  if (zu.zustand === 'frage') teile.push(`<div class="frage">Alle Maße sind da, aber es bleibt eine Lücke von ${lk}. Wie soll sie geschlossen werden?
    <div class="reihe"><button data-schluss="mass">Letztes Maß anpassen</button><button data-schluss="winkel">Winkel anpassen</button></div></div>`);
  if (zu.zustand === 'gerundet') teile.push(`<span class="ger">Lücke ${lk} geschlossen: ${zu.korrigiert.map(nm).join(' und ')} gerundet${raum.schluss ? '' : ` (Toleranz ${de(tol(b) * 1000, 0)} mm)`}.</span>`);
  if (zu.zustand === 'winkel') teile.push(`<span class="ger">Lücke ${lk} über die letzten Ecken geschlossen.</span>`);
  if (raum.schluss && zu.zustand !== 'frage') teile.push('<button class="klein" data-schluss="">Rückgängig</button>');
  if (pr.zu && !pr.fehlt.length) teile.push(`Umriss geschlossen · Fläche ${de(pr.flaeche)} m²`);
  if (warn.length) teile.push(`<ul class="warnliste">${warn.map(x => `<li data-warn="${x.wand ?? ''}:${x.ziel}">⚠ ${esc(x.text)} Antippen zum Anpassen.</li>`).join('')}</ul>`);
  $('#status').innerHTML = teile.map(t => t.startsWith('<div') || t.startsWith('<ul') ? t : `<div>${t}</div>`).join('');
  const offen = zu.zustand === 'frage' || (zu.zustand === 'offen' && (pr.luecke > 0.0005 || (pr.fehlt.length >= 1 && pr.fehlt.length <= 2)));
  if (gewaehlt?.j != null && w[gewaehlt.i] && w[gewaehlt.j]) { // zwei Nachbarwände: Ecke dazwischen nach innen
    const { e, r } = aktiv, n = w.length, i = (gewaehlt.i + 1) % n === gewaehlt.j ? gewaehlt.i : gewaehlt.j, j = (i + 1) % n;
    const ecke = P[i + 1];
    s.append(el('circle', { cx: ecke[0], cy: ecke[1], r: fs * 0.5, fill: '#fff', stroke: ROT, 'stroke-width': fs * 0.2, 'pointer-events': 'none' }));
    knoepfe.innerHTML = `<div class="wahl"><b>${nm(i)}</b> und <b>${nm(j)}</b> gewählt · Ecke dazwischen:</div>
      <button class="haupt zwei" id="z-aecke">+ Außenecke (nach innen)</button><button id="z-ab">Abbrechen</button>`;
    $('#z-aecke').onclick = () => {
      const m = v => Math.min(0.5, (G.wandLaenge(v) ?? v.skizze ?? 1) * 0.3);
      G.eckeAusschneiden(raum, i, m(w[i]), m(w[j]));
      speichern(b);
      raumSeite(b, e, r);
    };
    $('#z-ab').onclick = () => { gewaehlt = null; zeichnenNeu(); };
    return;
  }
  if (gewaehlt && w[gewaehlt.i]) {
    const i = gewaehlt.i, { e, r } = aktiv;
    knoepfe.innerHTML = `<div class="wahl"><b>${nm(i)}</b> gewählt · Nachbarwand antippen = Ecke dazwischen</div>
      <button data-tw="ecke">+ Knick</button><button data-tw="vor">+ Vorsprung</button><button data-tw="nische">+ Nische</button>
      <label class="feld zwei">Wandart${auswahl('id="z-wart"', WANDART_OPT, w[i].wandart || '')}</label>
      <button class="haupt" id="z-auf">Öffnen ›</button>
      <button class="weg breit" id="z-weg">Wand ${nm(i)} löschen</button>`;
    $('#z-weg').onclick = () => wandWeg(i);
    knoepfe.querySelectorAll('[data-tw]').forEach(k => { k.onclick = () => {
      const t = k.dataset.tw;
      if (t === 'ecke') G.eckeEinfuegen(raum, i, gewaehlt.anteil); else G.vorsprungEinfuegen(raum, i, gewaehlt.anteil, t === 'vor' ? 0.3 : -0.3);
      speichern(b);
      raumSeite(b, e, r);
    }; });
    $('#z-wart').onchange = ev => { wandartSetzen(w[i], ev.target.value); speichern(b); zeichnenNeu(); };
    $('#z-auf').onclick = () => geh('w', b.id, e, r, i, gewaehlt.anteil.toFixed(2));
    return;
  }
  const luecke = pr.luecke > 0.0005;
  knoepfe.innerHTML = (offen ? '<button class="haupt" id="z-auto">Automatisch schließen</button>' : '')
    + (luecke ? '<button id="z-weiter">Weiterzeichnen</button>' : '') + `<button id="z-neu" class="${offen || luecke ? '' : 'breit'}">Neu zeichnen</button>`;
  if (luecke) $('#z-weiter').onclick = () => { // ab dem Ende der letzten Wand neue Wände zeichnen
    const pk = punkteAnzeige();
    zeichnen = { pkt: pk, zug: null, arten: [], art: '', fest: pk.length };
    gewaehlt = null;
    zeichnenNeu();
    svg().scrollIntoView({ block: 'start' });
  };
  if (offen) $('#z-auto').onclick = () => {
    const erg = G.autoSchliessen(raum);
    autoMeldung = !erg ? 'Nichts zu schließen: es fehlen zu viele Maße. Erst weiter messen.'
      : erg.art === 'errechnet' ? `Ausgerechnet (grün): ${erg.waende.map(nm).join(' und ')}. Messen ersetzt den Wert.`
      : erg.art === 'mass' ? 'Lücke über das letzte Maß geschlossen (gekennzeichnet, gemessenes Maß bleibt gespeichert).'
      : 'Schlusswand eingefügt: bitte noch messen.';
    speichern(b);
    raumSeite(b, aktiv.e, aktiv.r);
  };
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
const PFEIL = { oben: '↑', unten: '↓', links: '←', rechts: '→' }; // Verlegerichtung der Leitung ab Dose
const RICHTUNG = { oben: [0, -1], unten: [0, 1], links: [-1, 0], rechts: [1, 0] }; // in der Ansicht (y nach unten)
const FACH = ['steckdose', 'schalter', 'lan']; // gibt es als Mehrfach-Kombination (fach wie am PC)
let offenA = { key: '', ids: new Set() }; // aufgeklappte Anschlüsse der gezeigten Wand
const auswahl = (attr, werte, ist) => `<select ${attr}>${Object.entries(werte).map(([k, v]) => `<option value="${k}" ${ist === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
const r3 = v => Math.round(v * 1000) / 1000;

function wandSeite(b, e, r, i, anteil, sel) {
  const raum = b.etagen[e].raeume[r], w = raum.waende[i], n = raum.waende.length;
  aktiv = { b, raum, e, r, w, i, anteil };
  zoomKey(`w/${b.id}/${e}/${r}/${i}`);
  const key = `${b.id}/${e}/${r}/${i}`;
  if (offenA.key !== key) offenA = { key, ids: new Set() };
  if (sel?.startsWith('a-')) offenA.ids.add(+sel.slice(2));
  w.oeffnungen ??= [];
  w.anschluesse ??= [];
  G.lueckeSchliessen(raum, tol(b));
  const L = () => G.wandLaenge(w) ?? w.skizze ?? 1, H = () => raum.hoehe ?? 2.5, ort_ = lage(raum, i);
  const WB = wb(b, raum);
  kopf(`${raum.name} · ${WB[i]}`);
  // Abstände so zeigen, wie gemessen wurde (von links/rechts, von unten/oben); gespeichert wird immer ab links/unten
  const oAbst = o => o.bezug === 'rechts' ? L() - o.abstand - o.breite : o.abstand;
  const aSeite = a => a.bezug_s === 'rechts' ? L() - a.abstand : a.abstand;
  const aHoehe = a => a.bezug_h === 'oben' ? H() - a.hoehe : a.hoehe;
  const warn = G.warnungen(raum, k => `Wand ${WB[k]}`).filter(x => x.wand === i);
  const schlecht = id => warn.some(x => x.ziel === id) ? 'warn' : '';
  app.innerHTML = `
    <div class="reihe wandnav"><button id="w-vor">‹ ${WB[(i - 1 + n) % n].split('-').pop()}</button>
      <div class="wandname"><b>Wand ${WB[i]}</b><small>${ort_} · ${n} Wände im Raum</small></div>
      <button id="w-nach">${WB[(i + 1) % n].split('-').pop()} ›</button></div>
    <svg id="karte" xmlns="http://www.w3.org/2000/svg"></svg>
    ${warn.length ? `<ul class="warnliste">${warn.map(x => `<li data-geh="${x.ziel}">⚠ ${esc(x.text)}</li>`).join('')}</ul>` : ''}
    <svg id="ansicht" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="raster3"><label class="feld">Länge (${einheit})<input data-ziel="laenge" inputmode="decimal" enterkeyhint="next" value="${massText(w.laenge)}" placeholder="≈ ${massText(w.skizze ?? 1)}" class="${w.laenge == null ? 'leer' : ''}"></label>
    <label class="feld">Winkel Ende (°)<input data-ziel="winkel" data-still data-roh inputmode="decimal" value="${rohText(w.winkel)}"></label>
    <label class="feld">Raumhöhe (${einheit})<input data-ziel="raumhoehe" data-still inputmode="decimal" value="${massText(raum.hoehe)}" class="${raum.hoehe == null ? 'leer' : ''}"></label></div>
    ${w.korrektur ? `<p class="ger">Gerundet: gerechnet wird mit ${massText(G.wandLaenge(w))} ${einheit}, gemessen sind ${massText(w.laenge)} ${einheit}.</p>` : ''}
    <div class="reihe"><label class="feld">Wandart${auswahl('data-wandart', WANDART_OPT, w.wandart || '')}</label>
      <button class="schalt ${w.mitrechnen !== false ? 'an' : ''}" data-schalt="mit">${w.mitrechnen !== false ? '✓' : '＋'} Wandfläche mitrechnen</button></div>
    <h3>Türen und Fenster</h3>
    <p class="hinweis">Abstand bis zur Kante der Öffnung, vom Raum aus auf die Wand gesehen. „von links ⇄“ antippen zum Umschalten.</p>
    ${w.oeffnungen.map((o, j) => `<div class="oe ${schlecht(`o-${j}`)}" id="o-${j}">
      ${auswahl(`data-art="o.${j}"`, { tuer: 'Tür', fenster: 'Fenster' }, o.art)}
      <button class="klein ent" data-weg="o.${j}" aria-label="löschen">✕</button>
      <button class="bez" data-bezug="o.${j}">von ${o.bezug === 'rechts' ? 'rechts' : 'links'} ⇄</button>
      ${zfeld(`o.${j}.abstand`, oAbst(o), 'Abstand')}
      ${zfeld(`o.${j}.breite`, o.breite, 'Breite')}${zfeld(`o.${j}.hoehe`, o.hoehe, 'Höhe')}${zfeld(`o.${j}.bruestung`, o.bruestung, 'Brüstung')}
      ${o.art === 'tuer'
        ? `<label><small>Art</small>${auswahl(`data-x="o.${j}.typ"`, TUERTYP, o.typ || 'einfach')}</label>
           <label class="halb"><small>Anschlag</small>${auswahl(`data-x="o.${j}.anschlag"`, { links: 'links', rechts: 'rechts' }, o.anschlag || 'links')}</label>
           <label class="halb"><small>öffnet</small>${auswahl(`data-x="o.${j}.oeffnet"`, { innen: 'nach innen', aussen: 'nach außen' }, o.oeffnet || 'innen')}</label>`
        : `<button class="schalt ${o.fb !== false ? 'an' : ''}" data-schalt="fb.${j}">${o.fb !== false ? '✓' : '＋'} Fensterbrett</button>
           <label class="halb"><small>Laibung (cm)</small><input data-ziel="o.${j}.laibung" data-roh data-still inputmode="decimal" value="${rohText(o.laibung)}"></label>`}</div>`).join('')}
    <div class="reihe"><button data-neu="tuer">+ Tür</button><button data-neu="fenster">+ Fenster</button></div>
    <h3>Anschlüsse (Elektro, Wasser)</h3>
    <p class="hinweis">Zuerst die Höhe messen (vom Boden oder von der Decke), dann seitlich (von links oder rechts), jeweils bis Mitte Dose.</p>
    ${w.anschluesse.map((a, j) => {
      const [nameA, kurz, farbe] = anschluss(a.art), fach = +a.fach || 1;
      const h = a.bezug_h === 'oben' ? `↓${massText(H() - a.hoehe)}` : `↑${massText(a.hoehe)}`, sx = a.bezug_s === 'rechts' ? `${massText(L() - a.abstand)}→` : `←${massText(a.abstand)}`;
      if (!offenA.ids.has(j)) return `<div class="oe zu ${schlecht(`a-${j}`)}" id="a-${j}">
        <button class="zeile" data-auf="${j}"><b style="color:${farbe}">${esc(kurz)}</b>${esc(nameA)}${fach > 1 ? ` ${fach}-fach` : ''}
          <span>${h} ${sx}${a.leitung ? ` · Leitung ${PFEIL[a.leitung] || ''}` : ''}</span></button>
        <button class="klein ent" data-weg="a.${j}" aria-label="löschen">✕</button></div>`;
      return `<div class="oe ${schlecht(`a-${j}`)}" id="a-${j}">
      <select data-art="a.${j}" class="${FACH.includes(a.art) ? 'eins' : ''}">${Object.entries(ANSCHLUESSE).map(([k, v]) => `<option value="${k}" ${a.art === k ? 'selected' : ''}>${v[0]}</option>`).join('')}
        ${ANSCHLUESSE[a.art] ? '' : `<option selected>${esc(a.art)}</option>`}</select>
      ${FACH.includes(a.art) ? auswahl(`data-x="a.${j}.fach" aria-label="Anzahl"`, { 1: '1-fach', 2: '2-fach', 3: '3-fach', 4: '4-fach', 5: '5-fach' }, String(fach)) : ''}
      <button class="klein" data-zu="${j}" aria-label="einklappen">fertig ▴</button>
      <button class="bez" data-bezugh="${j}">von ${a.bezug_h === 'oben' ? 'der Decke' : 'unten'} ⇄</button>${zfeld(`a.${j}.hoehe`, aHoehe(a), '1. Höhe')}
      <button class="bez" data-bezugs="${j}">von ${a.bezug_s === 'rechts' ? 'rechts' : 'links'} ⇄</button>${zfeld(`a.${j}.abstand`, aSeite(a), '2. Seite')}
      <div class="pfeile" role="group" aria-label="Leitung">${Object.entries(PFEIL).map(([k, p]) => `<button class="${a.leitung === k ? 'an' : ''}" data-leit="${j}.${k}" aria-label="Leitung nach ${k}">${p}</button>`).join('')}</div>
      <button class="klein ent" data-weg="a.${j}" aria-label="löschen">✕</button></div>`; }).join('')}
    <div class="reihe"><button data-neu="steckdose">+ Steckdose</button><button data-neu="steckdose" data-fach="2">+ 2-fach</button><button data-neu="steckdose" data-fach="3">+ 3-fach</button>
      <button data-neu="schalter">+ Schalter</button><button data-neu="kw">+ Wasser</button><button data-neu="lan">+ Sonstiges</button></div>
    <h3>Wand teilen ${anteil == null ? '(in der Mitte)' : '(an der angetippten Stelle)'}</h3>
    <div class="reihe"><button data-teilen="ecke">Ecke</button><button data-teilen="vor">Vorsprung</button><button data-teilen="nische">Nische</button></div>
    <div class="reihe"><button class="weg" id="w-weg">Wand löschen</button></div>`;
  const neu = () => { const y = scrollY; wandSeite(b, e, r, i, anteil, null); scrollTo(0, y); };
  $('#w-vor').onclick = () => geh('w', b.id, e, r, (i - 1 + n) % n);
  $('#w-nach').onclick = () => geh('w', b.id, e, r, (i + 1) % n);
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
    else if (d.x) { const [art, j, k] = d.x.split('.'); (art === 'o' ? w.oeffnungen : w.anschluesse)[j][k] = k === 'fach' ? +t.value : t.value; }
    else if (d.wandart != null) { wandartSetzen(w, t.value); speichern(b); return neu(); }
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
    if (d.auf != null) { offenA.ids.add(+d.auf); neu(); return fokus(`a-${d.auf}`); }
    if (d.zu != null) offenA.ids.delete(+d.zu);
    else if (d.leit) { const [j, k] = d.leit.split('.'), a = w.anschluesse[j]; a.leitung = a.leitung === k ? '' : k; }
    else if (d.schalt === 'mit') w.mitrechnen = w.mitrechnen === false;
    else if (d.schalt) { const o = w.oeffnungen[d.schalt.split('.')[1]]; o.fb = o.fb === false; }
    else if (d.weg) { const [art, j] = d.weg.split('.'); (art === 'o' ? w.oeffnungen : w.anschluesse).splice(j, 1); if (art === 'a') offenA.ids.clear(); }
    else if (d.bezug) { const o = w.oeffnungen[d.bezug.split('.')[1]]; o.bezug = o.bezug === 'rechts' ? 'links' : 'rechts'; }
    else if (d.bezugh != null) {
      const a = w.anschluesse[d.bezugh];
      if (a.bezug_h !== 'oben' && raum.hoehe == null) return alert('Bitte zuerst die Raumhöhe messen, dann kann von der Decke aus gemessen werden.');
      a.bezug_h = a.bezug_h === 'oben' ? 'unten' : 'oben';
    } else if (d.bezugs != null) { const a = w.anschluesse[d.bezugs]; a.bezug_s = a.bezug_s === 'rechts' ? 'links' : 'rechts'; }
    else if (OEFFNUNG[d.neu]) w.oeffnungen.push({ art: d.neu, abstand: r3(Math.max(0, (L() - OEFFNUNG[d.neu].breite) / 2)), ...OEFFNUNG[d.neu] });
    else if (d.neu) { // neue Dose: nur sie ist offen, die anderen klappen zu
      w.anschluesse.push({ art: d.neu, abstand: r3(L() / 2), hoehe: anschluss(d.neu)[3], leitung: '', ...(d.fach ? { fach: +d.fach } : {}) });
      offenA.ids = new Set([w.anschluesse.length - 1]);
    }
    else if (d.teilen) {
      const a = anteil ?? 0.5;
      if (d.teilen === 'ecke') G.eckeEinfuegen(raum, i, a); else G.vorsprungEinfuegen(raum, i, a, d.teilen === 'vor' ? 0.3 : -0.3);
      speichern(b);
      return geh('r', b.id, e, r);
    } else if (t.id === 'w-weg') {
      if (!confirm(`Wand ${WB[i]} löschen? Die anderen Wände bleiben, die Lücke wird angezeigt.`)) return;
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
  let zeile = app.querySelector(`#${id}`);
  if (zeile?.classList.contains('zu')) { // zugeklappter Anschluss: erst aufklappen
    offenA.ids.add(+id.split('-')[1]);
    const { b, e, r, i, anteil } = aktiv, y = scrollY;
    wandSeite(b, e, r, i, anteil, null);
    scrollTo(0, y);
    zeile = app.querySelector(`#${id}`);
  }
  if (!zeile) return;
  zeile.classList.add('gewaehlt');
  setTimeout(() => zeile.classList.remove('gewaehlt'), 1500);
  const f = zeile.querySelector('input[data-ziel]');
  f?.focus({ preventScroll: true });
  zeile.scrollIntoView({ block: 'start' });
}

/** Kleine Draufsicht: wo ist die Wand? */
function karteNeu(raum, i) {
  const s = $('#karte');
  if (!s) return;
  s.replaceChildren();
  const P = punkteAnzeige(raum), [x0, y0, x1, y1] = kasten(P), gr = Math.max(x1 - x0, y1 - y0, 1), r = gr * 0.15;
  // Raum mit etwas Haus drumherum, Ausschnitt zur bearbeiteten Wand hin verschoben
  const vx = ((P[i][0] + P[i + 1][0]) / 2 - (x0 + x1) / 2) * 0.3, vy = ((P[i][1] + P[i + 1][1]) / 2 - (y0 + y1) / 2) * 0.3;
  s.setAttribute('viewBox', `${x0 - r + vx} ${y0 - r + vy} ${x1 - x0 + 2 * r} ${y1 - y0 + 2 * r}`);
  andereRaeume(s, haus(aktiv.b, aktiv.e), raum, gr / 14, true);
  s.append(el('polygon', { points: P.slice(0, -1).join(' '), fill: '#f4ead9', stroke: '#5c554a', 'stroke-width': gr * 0.02 }));
  s.append(el('line', { x1: P[i][0], y1: P[i][1], x2: P[i + 1][0], y2: P[i + 1][1], stroke: ROT, 'stroke-width': gr * 0.06, 'stroke-linecap': 'round' }));
  s.append(el('circle', { cx: P[i][0], cy: P[i][1], r: gr * 0.045, fill: ROT })); // Wandanfang = links in der Ansicht
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
  sicht(s, [xa - fs * 3, ya - fs * 1.5, xb - xa + fs * 4.5, H - ya + fs * 6]);
  if (!s._gesten) { s._gesten = true; gesten(s); }
  const text = (x, y, t, mehr = {}) => s.append(el('text', { x, y, 'font-size': fs * 0.75, 'text-anchor': 'middle', fill: '#17140f', ...mehr }, t));
  s.append(el('rect', { x: 0, y: 0, width: L, height: H, fill: w.mitrechnen === false ? '#f2eee6' : '#fbfaf7', stroke: '#17140f', 'stroke-width': fs * 0.12,
    'stroke-dasharray': w.mitrechnen === false ? `${fs * 0.5} ${fs * 0.4}` : 'none' }));
  const kanten = [0, L];
  w.oeffnungen.forEach((o, j) => {
    const y = H - o.bruestung - o.hoehe, tuer = o.art === 'tuer', raus = o.abstand < -0.005 || o.abstand + o.breite > L + 0.005 || y < -0.005;
    const an = hervor === `o-${j}`;
    s.append(el('rect', { x: o.abstand, y, width: o.breite, height: o.hoehe, fill: an ? '#ead9bb' : raus ? '#ead9bb' : tuer ? '#f3e2d6' : '#dbeafb',
      stroke: an ? '#a77f45' : raus ? '#b4532a' : tuer ? '#a0522d' : '#2e86de', 'stroke-width': fs * (an ? 0.3 : 0.1), 'data-sel': `o-${j}` }));
    text(o.abstand + o.breite / 2, y + o.hoehe / 2, `${massText(o.breite)} × ${massText(o.hoehe)}`, { 'pointer-events': 'none' });
    if (o.bruestung > 0) text(o.abstand + o.breite / 2, H - o.bruestung / 2 + fs * 0.3, `Br. ${massText(o.bruestung)}`, { fill: '#2e86de', 'pointer-events': 'none' });
    kanten.push(o.abstand, o.abstand + o.breite);
  });
  w.anschluesse.forEach((a, j) => {
    const [, kurz, f0] = anschluss(a.art), x = a.abstand, y = H - a.hoehe, an = hervor === `a-${j}`;
    const farbe = x < -0.005 || x > L + 0.005 || y < -0.005 ? '#b4532a' : f0, rr = fs * 0.4, fach = Math.max(1, +a.fach || 1);
    const p = RICHTUNG[a.leitung];
    if (p) { // Verlegerichtung der Leitung: kurzer gestrichelter Pfeil ab Dose
      const ab = (p[0] ? rr * fach : rr) + fs * 0.1, l1 = ab + fs * 1.8, ex = x + p[0] * l1, ey = y + p[1] * l1, q = fs * 0.35;
      s.append(el('line', { x1: x + p[0] * ab, y1: y + p[1] * ab, x2: ex, y2: ey, stroke: farbe, 'stroke-width': fs * 0.09, 'stroke-dasharray': `${fs * 0.25} ${fs * 0.15}` }));
      s.append(el('polygon', { points: [[ex + p[0] * q, ey + p[1] * q], [ex - p[1] * q * 0.6, ey + p[0] * q * 0.6], [ex + p[1] * q * 0.6, ey - p[0] * q * 0.6]].join(' '), fill: farbe }));
    }
    if (an) s.append(el('rect', { x: x - rr * fach - fs * 0.3, y: y - rr - fs * 0.3, width: 2 * rr * fach + fs * 0.6, height: 2 * rr + fs * 0.6, rx: fs * 0.3, fill: '#ead9bb', 'pointer-events': 'none' }));
    for (let k = 0; k < fach; k++) { // Mehrfach-Dose: Dosen nebeneinander
      const cx = x + (k - (fach - 1) / 2) * 2 * rr;
      s.append(el('circle', { cx, cy: y, r: rr, fill: '#fff', stroke: an ? '#a77f45' : farbe, 'stroke-width': fs * (an ? 0.2 : 0.1), 'data-sel': `a-${j}` }));
      text(cx, y + fs * 0.17, kurz, { fill: farbe, 'font-size': fs * 0.4, 'font-weight': 700, 'pointer-events': 'none' });
    }
    // Maße so, wie gemessen (Höhe | Seite), abwechselnd über/unter dem Zeichen, damit nahe Dosen lesbar bleiben
    const h = a.bezug_h === 'oben' ? `↓${massText(H - a.hoehe)}` : `↑${massText(a.hoehe)}`, sx = a.bezug_s === 'rechts' ? `${massText(L - a.abstand)}→` : `←${massText(a.abstand)}`;
    text(x, j % 2 ? y + fs * 1.0 : y - fs * 0.6, `${h} ${sx}`, { 'font-size': fs * 0.42, fill: farbe, 'pointer-events': 'none' });
  });
  // Maßkette unten (Abstände zwischen Wandecken und Öffnungskanten)
  const k = [...new Set(kanten.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b), ym = H + fs * 1.6;
  s.append(el('line', { x1: 0, y1: ym, x2: L, y2: ym, stroke: '#5c554a', 'stroke-width': fs * 0.05 }));
  k.forEach((v, j) => {
    s.append(el('line', { x1: v, y1: ym - fs * 0.4, x2: v, y2: ym + fs * 0.4, stroke: '#5c554a', 'stroke-width': fs * 0.05 }));
    if (j) text((k[j - 1] + v) / 2, ym - fs * 0.25, massText(v - k[j - 1]), { fill: '#5c554a' });
  });
  const ger = !!w.korrektur;
  text(L / 2, H + fs * 3.4, `Wand ${massText(L)} ${einheit}${w.laenge == null ? ' (ungefähr)' : ger ? ' (gerundet)' : ''}`,
    { 'font-weight': hervor === 'laenge' ? 800 : 600, fill: hervor === 'laenge' ? '#17140f' : w.laenge == null ? '#a77f45' : ger ? '#b4532a' : '#7e5c2e', 'font-size': fs * (hervor === 'laenge' ? 1 : 0.85), 'data-sel': 'laenge', style: 'cursor:pointer' });
  if (hervor === 'laenge') s.append(el('line', { x1: 0, y1: H, x2: L, y2: H, stroke: '#a77f45', 'stroke-width': fs * 0.35 }));
  if (hervor === 'raumhoehe') s.append(el('line', { x1: 0, y1: 0, x2: 0, y2: H, stroke: '#a77f45', 'stroke-width': fs * 0.35 }));
  text(-fs * 1.4, H / 2, `${massText(H)}${raum.hoehe == null ? '?' : ''}`, { transform: `rotate(-90 ${-fs * 1.4} ${H / 2})`, fill: '#5c554a', 'data-sel': 'raumhoehe', style: 'cursor:pointer' });
  s.onclick = ev => {
    if (!angetippt(s) || zoomKnopf(s, ev, () => ansichtNeu(w, raum))) return;
    const sel = ev.target.dataset?.sel;
    if (!sel) return;
    if (sel === 'laenge' || sel === 'raumhoehe') { const f = app.querySelector(`[data-ziel="${sel}"]`); f.focus({ preventScroll: true }); return f.scrollIntoView({ block: 'start' }); }
    fokus(sel);
  };
}

// ---------- Start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.(); // Android soll die Daten nicht bei Platzmangel löschen
db = await dbAuf();
alle = await tx('readonly', s => s.getAll());
zeigen();
