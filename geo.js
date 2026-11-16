// Rechenlogik der Aufmaß-App (ohne Bildschirm), läuft im Browser und in Node (tests.mjs).
// Wände im Uhrzeigersinn, von oben gesehen, y nach oben, Wand A zuerst nach rechts – wie geometrie.py am PC.
// winkel = Innenwinkel an der Ecke am Ende der Wand: 90 normale Ecke, 270 vorspringende Ecke.

const rad = d => d * Math.PI / 180;
const r3 = v => Math.round(v * 1000) / 1000;

/** Länge, mit der gerechnet wird: gemessenes Maß plus Korrektur beim Schließen kleiner Lücken (gemessen bleibt erhalten). */
export const wandLaenge = w => w.laenge == null ? null : w.laenge + (w.korrektur || 0);

export const name = i => i < 26 ? String.fromCharCode(65 + i) : name(Math.floor(i / 26) - 1) + name(i % 26);

/** Eckpunkte [x, y]; fehlt ein Maß, gilt die Skizzenlänge. drehung = Richtung von Wand A in Grad (nur Anzeige). */
export function punkte(waende, drehung = 0) {
  let x = 0, y = 0, r = drehung;
  const p = [[0, 0]];
  for (const w of waende) {
    const l = wandLaenge(w) ?? w.skizze ?? 1;
    x += l * Math.cos(rad(r));
    y += l * Math.sin(rad(r));
    p.push([x, y]);
    r -= 180 - (w.winkel ?? 90);
  }
  return p;
}

/** Fläche (Gaußsche Trapezformel) der Eckpunkte ohne den Schlusspunkt. */
export function flaeche(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Zustand des Umrisses: fehlende Maße, Lücke (m) zwischen Ende der letzten Wand und Anfang von A, Winkelsumme. */
export function pruefen(waende) {
  const p = punkte(waende);
  const [x, y] = p.at(-1);
  const soll = (waende.length - 2) * 180;
  const summe = waende.reduce((s, w) => s + (w.winkel ?? 90), 0);
  const fehlt = waende.map((w, i) => w.laenge == null ? name(i) : null).filter(Boolean);
  const luecke = Math.hypot(x, y);
  return {
    fehlt, luecke, winkelSumme: summe, winkelSoll: soll,
    zu: waende.length >= 3 && luecke <= 0.01 && Math.abs(summe - soll) < 0.5,
    flaeche: flaeche(p.slice(0, -1)),
  };
}

/** Gezeichnete Punkte (y nach oben, Umriss schließt von selbst) -> {waende, drehung}, immer im Uhrzeigersinn. */
export function ausPunkten(pts) {
  let p = pts.filter((a, i) => Math.hypot(a[0] - pts[(i + 1) % pts.length][0], a[1] - pts[(i + 1) % pts.length][1]) > 1e-6);
  let s = 0;
  p.forEach(([x1, y1], i) => { const [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; });
  if (s > 0) p = [p[0], ...p.slice(1).reverse()]; // gegen den Uhrzeigersinn gezeichnet
  const n = p.length;
  const richtung = i => {
    const [a, b] = [p[i % n], p[(i + 1) % n]];
    return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  };
  const waende = p.map((a, i) => {
    let links = richtung(i + 1) - richtung(i);
    links = ((links + 540) % 360) - 180; // -180 … 180, negativ = Rechtsknick
    const b = p[(i + 1) % n];
    return { laenge: null, winkel: Math.round(180 + links), mitrechnen: true, oeffnungen: [],
             skizze: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 100) / 100 };
  });
  // Rundung der freien Winkel darf den Umriss nicht verdrehen: letzte Ecke gleicht aus
  const rest = (n - 2) * 180 - waende.slice(0, -1).reduce((s, w) => s + w.winkel, 0);
  waende[n - 1].winkel = rest;
  return { waende, drehung: richtung(0) };
}

/** Wand i löschen: die Richtung der übrigen Wände bleibt, die Lücke zeigt dann, wo eine neue Wand fehlt. */
export function wandLoeschen(raum, i) {
  const w = raum.waende, n = w.length, v = (i - 1 + n) % n;
  if (i === 0) raum.drehung = (raum.drehung ?? 0) - (180 - w[0].winkel);
  w[v].winkel = w[v].skizzeWinkel = ((w[v].winkel + w[i].winkel - 180) % 360 + 360) % 360 || 360;
  w.splice(i, 1);
}

/** Ecke in Wand i einfügen (anteil 0…1 ab Wandanfang). Neue Ecke 180° = gerade, Maße beider Teile neu messen. */
export function eckeEinfuegen(raum, i, anteil) {
  const w = raum.waende[i];
  const l = wandLaenge(w) ?? w.skizze ?? 1;
  const vorn = (w.oeffnungen || []).filter(o => o.abstand < l * anteil);
  const hinten = (w.oeffnungen || []).filter(o => o.abstand >= l * anteil).map(o => ({ ...o, abstand: r3(o.abstand - l * anteil) }));
  const a = { ...w, laenge: null, winkel: 180, skizzeWinkel: 180, skizze: Math.round(l * anteil * 100) / 100, oeffnungen: vorn };
  const b = { ...w, laenge: null, skizze: Math.round(l * (1 - anteil) * 100) / 100, oeffnungen: hinten };
  raum.waende.splice(i, 1, a, b);
}

/** Vorsprung (tiefe > 0, ragt in den Raum, z. B. Schacht) oder Nische (tiefe < 0) in Wand i einbauen, um die
 *  Stelle anteil (0…1) herum. Aus einer Wand werden fünf; die neuen Teile sind ungemessen (Skizzenlängen). */
export function vorsprungEinfuegen(raum, i, anteil, tiefe) {
  const w = raum.waende[i], L = wandLaenge(w) ?? w.skizze ?? 1, r2 = v => Math.round(v * 100) / 100;
  const b = L * 0.3, a = Math.min(Math.max(L * anteil - b / 2, L * 0.05), L * 0.65), c = L - a - b, t = Math.abs(tiefe);
  const [rein, raus] = tiefe > 0 ? [90, 270] : [270, 90]; // in den Raum hinein = Rechtsknick (90°) im Uhrzeigersinn
  const teil = (skizze, winkel, oe = []) => ({ laenge: null, winkel, skizzeWinkel: winkel, mitrechnen: w.mitrechnen, oeffnungen: oe, skizze: r2(skizze) });
  const oe = w.oeffnungen || [];
  const neu = [
    teil(a, rein, oe.filter(o => o.abstand < a)),
    teil(t, raus),
    teil(b, raus, oe.filter(o => o.abstand >= a && o.abstand < a + b).map(o => ({ ...o, abstand: r3(o.abstand - a) }))),
    teil(t, rein),
    { ...teil(c, w.winkel, oe.filter(o => o.abstand >= a + b).map(o => ({ ...o, abstand: r3(o.abstand - a - b) }))), skizzeWinkel: w.skizzeWinkel ?? w.winkel },
  ];
  raum.waende.splice(i, 1, ...neu);
}

/** Neues Maß für eine Wand. Teile mit Bezug „rechts“ behalten ihren Abstand zum rechten Wandende (wie „bezug“ am PC). */
export function laengeSetzen(w, neu) {
  const alt = wandLaenge(w) ?? w.skizze ?? 1;
  w.laenge = neu;
  const d = (wandLaenge(w) ?? w.skizze ?? 1) - alt;
  if (Math.abs(d) < 1e-9) return;
  for (const o of w.oeffnungen || []) if (o.bezug === 'rechts') o.abstand = r3(o.abstand + d);
  for (const a of w.anschluesse || []) if (a.bezug_s === 'rechts') a.abstand = r3(a.abstand + d);
}

/** Neue Raumhöhe. Anschlüsse, die von der Decke aus gemessen wurden, behalten ihren Abstand zur Decke. */
export function hoeheSetzen(raum, neu) {
  const alt = raum.hoehe;
  raum.hoehe = neu;
  if (alt == null || neu == null) return;
  for (const w of raum.waende) for (const a of w.anschluesse || []) if (a.bezug_h === 'oben') a.hoehe = r3(a.hoehe + neu - alt);
}

const gerade = v => [90, 180, 270].some(k => Math.abs(v - k) < 0.5);

/** Winkel schräger Ecken aus den gemessenen Längen ausrechnen. Normale Ecken (90°, 270°, 180°) bleiben fest;
 *  nur Ecken, die in der Skizze schräg sind, werden so verstellt, dass sich der Umriss schließt (bei mehr als drei
 *  schrägen Ecken mit möglichst kleiner Änderung gegenüber der Skizze). Gibt null zurück, wenn nichts zu rechnen ist
 *  (Maß fehlt oder weniger als 2 schräge Ecken), sonst {frei: [Wandnummern], luecke: verbleibende Lücke in m}. */
export function winkelAusrechnen(waende, vorgabe = null) {
  const n = waende.length;
  if (n < 3 || waende.some(w => w.laenge == null)) return null;
  waende.forEach(w => { w.skizzeWinkel ??= w.winkel; });
  const frei = vorgabe ?? waende.map((w, i) => i).filter(i => !gerade(waende[i].skizzeWinkel));
  const k = frei.length;
  if (k < 2) return null;
  const th = waende.map(w => w.skizzeWinkel);
  const d0 = ((n - 2) * 180 - th.reduce((s, v) => s + v, 0)) / k; // Winkelsumme muss stimmen
  frei.forEach(i => { th[i] += d0; });
  const mitTh = () => waende.map((w, i) => ({ laenge: wandLaenge(w), winkel: th[i] }));
  for (let it = 0; it < 60; it++) {
    const P = punkte(mitTh()), [ex, ey] = P[n];
    if (Math.hypot(ex, ey) < 1e-9) break;
    // Ableitung des Endpunkts nach dem Winkel an Ecke i: alle späteren Wände drehen sich um den Eckpunkt P[i+1]
    const J = frei.map(i => [-(ey - P[i + 1][1]) * Math.PI / 180, (ex - P[i + 1][0]) * Math.PI / 180]);
    const m = J.reduce((s, j) => [s[0] + j[0], s[1] + j[1]], [0, 0]).map(v => v / k);
    const Jp = J.map(j => [j[0] - m[0], j[1] - m[1]]); // Summe der Änderungen = 0 (Winkelsumme bleibt)
    let [a, b, c] = [0, 0, 0];
    Jp.forEach(([x, y]) => { a += x * x; b += x * y; c += y * y; });
    // Pseudo-Inverse der 2×2-Matrix [[a,b],[b,c]] (bei nur 2 schrägen Ecken ist sie nicht voll besetzt)
    const sp = a + c, det = a * c - b * b, wur = Math.sqrt(Math.max(0, sp * sp / 4 - det));
    const l1 = sp / 2 + wur, l2 = sp / 2 - wur, eps = 1e-12 * (sp + 1e-30);
    let u = [a > eps ? ex / a : 0, c > eps ? ey / c : 0]; // schon diagonal
    if (Math.abs(b) > eps) {
      u = [0, 0];
      for (const l of [l1, l2]) {
        if (l <= eps) continue;
        const nv = Math.hypot(l - c, b), [vx, vy] = [(l - c) / nv, b / nv], f = (vx * ex + vy * ey) / l;
        u = [u[0] + f * vx, u[1] + f * vy];
      }
    }
    let schritt = Jp.map(([x, y]) => -(x * u[0] + y * u[1]));
    const gross = Math.max(...schritt.map(Math.abs));
    if (gross > 15) schritt = schritt.map(v => v * 15 / gross);
    frei.forEach((i, j) => { th[i] += schritt[j]; });
    if (gross < 1e-10) break;
  }
  frei.forEach(i => { waende[i].winkel = Math.round(th[i] * 1000) / 1000; });
  return { frei, luecke: pruefen(waende).luecke };
}

/** Lücke schließen, wenn alle Wände gemessen sind. Schräge Ecken der Skizze werden immer ausgerechnet. Bleibt eine
 *  Lücke: bis zur Toleranz (m) oder nach Wahl raum.schluss = 'mass' werden die letzten Maße angepasst (wie am PC:
 *  letzte Wand in jeder Richtung; das gemessene Maß bleibt, die Änderung steht in w.korrektur), bei 'winkel' nehmen
 *  die letzten Ecken die Lücke auf. Sonst {zustand: 'frage'}: der Benutzer soll wählen.
 *  zustand: 'offen' (Maß fehlt) | 'zu' | 'gerundet' | 'winkel' | 'frage'. */
export function lueckeSchliessen(raum, toleranz = 0) {
  const w = raum.waende, n = w.length;
  const zurueck = () => w.forEach(x => { x.skizzeWinkel ??= x.winkel; if (gerade(x.skizzeWinkel)) x.winkel = x.skizzeWinkel; x.korrektur = 0; });
  zurueck();
  if (n < 3 || w.some(x => x.laenge == null)) return { zustand: 'offen', frei: [], korrigiert: [] };
  const auto = winkelAusrechnen(w), basis = { frei: auto?.frei || [], korrigiert: [] };
  const luecke = pruefen(w).luecke;
  if (luecke <= 0.0005) return { ...basis, zustand: 'zu', luecke };
  const wahl = raum.schluss || (luecke <= toleranz + 1e-9 ? 'mass' : null);
  if (wahl === 'mass') {
    const k = massKorrektur(w);
    if (k && k.every(([i, d]) => Math.abs(d) <= 0.05 && w[i].laenge + d > 0)) {
      k.forEach(([i, d]) => { w[i].korrektur = Math.round(d * 10000) / 10000; });
      return { ...basis, zustand: 'gerundet', luecke, korrigiert: k.map(([i]) => i) };
    }
  } else if (wahl === 'winkel') {
    const frei = [...new Set([...basis.frei, n - 3, n - 2, n - 1].filter(i => i >= 0))];
    const r = winkelAusrechnen(w, frei);
    if (r && r.luecke <= 0.0005 && frei.every(i => Math.abs(w[i].winkel - w[i].skizzeWinkel) <= 15))
      return { ...basis, frei, zustand: 'winkel', luecke };
    zurueck();
    winkelAusrechnen(w);
  }
  return { ...basis, zustand: 'frage', luecke };
}

/** Wie am PC (aufmass.schliessen): letzte Wand und die letzte nicht parallele Wand davor so ändern, dass die Lücke zu ist. */
function massKorrektur(w) {
  const n = w.length, u = [];
  let h = 0;
  for (const x of w) { u.push([Math.cos(h * Math.PI / 180), Math.sin(h * Math.PI / 180)]); h -= 180 - x.winkel; }
  const [gx, gy] = punkte(w)[n], j = n - 1;
  const kreuz = k => u[j][0] * u[k][1] - u[k][0] * u[j][1];
  let k = j - 1;
  while (k >= 0 && Math.abs(kreuz(k)) < 0.3) k--;
  if (k < 0) return null;
  const det = kreuz(k);
  const a = (-gx * u[k][1] + u[k][0] * gy) / det, b = (-u[j][0] * gy + gx * u[j][1]) / det;
  return [[j, a], [k, b]].filter(([, d]) => Math.abs(d) > 1e-7);
}

const inPolygon = ([x, y], p) => {
  let drin = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) drin = !drin;
  return drin;
};
const de2 = v => v.toFixed(2).replace('.', ',');

/** Was außerhalb des Arbeitsbereichs liegt: [{text, wand, ziel}] (ziel z. B. 'o-0', 'a-1', 'k-0'). */
export function warnungen(raum) {
  const aus = [], H = raum.hoehe, T = 0.005;
  raum.waende.forEach((w, i) => {
    const L = wandLaenge(w) ?? w.skizze ?? 1, wn = `Wand ${name(i)}`;
    (w.oeffnungen || []).forEach((o, j) => {
      const was = `${o.art === 'tuer' ? 'Tür' : 'Fenster'} ${j + 1}`;
      if (o.abstand + o.breite > L + T) aus.push({ wand: i, ziel: `o-${j}`, text: `${wn}: ${was} ragt ${de2(o.abstand + o.breite - L)} m über das Wandende hinaus.` });
      if (H != null && o.bruestung + o.hoehe > H + T) aus.push({ wand: i, ziel: `o-${j}`, text: `${wn}: ${was} ist ${de2(o.bruestung + o.hoehe - H)} m höher als der Raum.` });
      (w.oeffnungen || []).slice(j + 1).forEach((q, k) => {
        if (o.abstand < q.abstand + q.breite - T && q.abstand < o.abstand + o.breite - T)
          aus.push({ wand: i, ziel: `o-${j}`, text: `${wn}: ${was} überschneidet sich mit Öffnung ${j + k + 2}.` });
      });
    });
    (w.anschluesse || []).forEach((a, j) => {
      if (a.abstand > L + T) aus.push({ wand: i, ziel: `a-${j}`, text: `${wn}: Anschluss ${j + 1} liegt ${de2(a.abstand - L)} m hinter dem Wandende.` });
      if (H != null && a.hoehe > H + T) aus.push({ wand: i, ziel: `a-${j}`, text: `${wn}: Anschluss ${j + 1} liegt über der Decke.` });
    });
  });
  const poly = punkte(raum.waende).slice(0, -1);
  (raum.koerper || []).forEach((k, j) => {
    if (raum.waende.length < 3) return;
    const [cx, cy] = koerperMitte(k), [hx, hy] = halb(k);
    const ecken = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [cx + sx * hx * 0.999, cy + sy * hy * 0.999]);
    if (!ecken.every(e => inPolygon(e, poly))) aus.push({ ziel: `k-${j}`, text: `Säule ${j + 1} liegt (teilweise) außerhalb des Raums.` });
    if (H != null && k.h != null && k.h > H + T) aus.push({ ziel: `k-${j}`, text: `Säule ${j + 1} ist höher als der Raum.` });
  });
  return aus;
}

/** Eingabe vom Finger oder Laser (Tastaturmodus): "3,205", "3.205 m", "320,5 cm", "3205mm" -> Meter; leer -> null.
 *  Ohne Einheit gilt die eingestellte (m oder cm). Auf den Millimeter gerundet. */
export function zahl(text, einheit = 'm') {
  const t = String(text).trim().replace(',', '.');
  if (t === '') return null;
  const m = /^(\d+(?:\.\d*)?|\.\d+)\s*(mm|cm|m)?$/i.exec(t);
  if (!m) return NaN;
  return r3(Number(m[1]) / ({ mm: 1000, cm: 100, m: 1 }[(m[2] || einheit).toLowerCase()] || 1));
}

// Felder, die die App selbst kennt; alles andere aus einer PC-Datei wird unverändert durchgereicht, damit beim Hin
// und Her nichts verloren geht (z. B. Türanschlag, Fensterbrett, Leitungen).
const BEKANNT = {
  baustelle: ['id', 'baustelle', 'etagen', 'geaendert', 'format', 'version', 'erstellt'],
  etage: ['name', 'raeume'],
  raum: ['name', 'hoehe', 'waende', 'notiz', 'koerper', 'drehung'],
  wand: ['laenge', 'winkel', 'mitrechnen', 'oeffnungen', 'anschluesse', 'skizze', 'skizzeWinkel', 'gemessen', 'korrektur'],
  oeffnung: ['art', 'abstand', 'breite', 'hoehe', 'bruestung'],
  anschluss: ['art', 'abstand', 'hoehe'],
  koerper: ['form', 'x', 'y', 's', 'a', 'b', 't', 'd', 'h'],
};
const rest = (o, art) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !BEKANNT[art].includes(k)).map(([k, v]) => [k, structuredClone(v)]));

// Säulen/Körper (Form wie geometrie.py am PC): In der Datei Mitte x, y ab linker unterer Ecke des Umrisses.
// In der App gemessen wie auf der Baustelle: s = Abstand vom Anfang von Wand A (entlang A), a = Abstand von Wand A.
const halb = k => k.form === 'kreis' ? [k.d / 2, k.d / 2] : [k.b / 2, k.t / 2];
const ecke = waende => { const p = punkte(waende); return [Math.min(...p.map(q => q[0])), Math.min(...p.map(q => q[1]))]; };
/** Mitte des Körpers in Koordinaten von punkte() (Wand A nach rechts, Raum darunter). */
export function koerperMitte(k) { const [hx, hy] = halb(k); return [k.s + hx, -(k.a + hy)]; }
function koerperExport(k, waende) {
  const [ux, uy] = ecke(waende), [cx, cy] = koerperMitte(k);
  const masse = k.form === 'kreis' ? { d: r3(k.d) } : { b: r3(k.b), t: r3(k.t) };
  return { form: k.form, x: r3(cx - ux), y: r3(cy - uy), ...masse, h: k.h == null ? null : r3(k.h), ...rest(k, 'koerper') };
}
function koerperImport(k, waende) {
  const [ux, uy] = ecke(waende), [hx, hy] = halb(k);
  return { ...rest(k, 'koerper'), form: k.form, ...(k.form === 'kreis' ? { d: k.d } : { b: k.b, t: k.t }),
           s: r3(k.x + ux - hx), a: r3(-(k.y + uy) - hy), h: k.h ?? null };
}

/** Datei nach Abschnitt 3 (Version 1), Maße in m auf mm gerundet. Zusatzfelder (dürfen fehlen, ältere Leser übergehen
 *  sie): id = dieselbe Baustelle auf beiden Geräten; skizze = ungefähre Wandlänge, solange laenge null ist;
 *  anschluesse (Wand) und koerper (Raum) in der Form von geometrie.py; unbekannte Felder werden durchgereicht. */
export function exportieren(b, jetzt = new Date()) {
  const z = n => String(n).padStart(2, '0');
  const erstellt = `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}T${z(jetzt.getHours())}:${z(jetzt.getMinutes())}`;
  return {
    format: 'aufmass', version: 1, erstellt, id: b.id, baustelle: b.baustelle,
    etagen: b.etagen.map(e => ({ name: e.name, raeume: e.raeume.map(r => {
      const raum = { name: r.name };
      if (r.hoehe != null) raum.hoehe = r3(r.hoehe);
      raum.waende = r.waende.map(w => ({
        laenge: w.laenge == null ? null : r3(wandLaenge(w)),
        winkel: Math.round(w.winkel * 100) / 100,
        mitrechnen: w.mitrechnen !== false,
        oeffnungen: (w.oeffnungen || []).map(o => ({ art: o.art, abstand: r3(o.abstand), breite: r3(o.breite),
                                                     hoehe: r3(o.hoehe), bruestung: r3(o.bruestung ?? 0), ...rest(o, 'oeffnung') })),
        ...(w.anschluesse?.length ? { anschluesse: w.anschluesse.map(a => ({ art: a.art, abstand: r3(a.abstand), hoehe: r3(a.hoehe), ...rest(a, 'anschluss') })) } : {}),
        ...(w.laenge == null && w.skizze != null ? { skizze: Math.round(w.skizze * 100) / 100 } : {}),
        ...(w.korrektur ? { gemessen: r3(w.laenge) } : {}), // Lücke geschlossen: echtes Maß geht mit
        ...rest(w, 'wand'),
      }));
      raum.notiz = r.notiz || '';
      if (r.koerper?.length) raum.koerper = r.koerper.map(k => koerperExport(k, r.waende));
      return Object.assign(raum, rest(r, 'raum'));
    }), ...rest(e, 'etage') })),
    ...rest(b, 'baustelle'),
  };
}

/** Prüft eine Aufmaß-Datei (beim Einlesen fremder Dateien). null = in Ordnung, sonst Fehlertext. */
export function pruefeDatei(d) {
  const zahlOk = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const endlich = v => typeof v === 'number' && Number.isFinite(v);
  if (!d || d.format !== 'aufmass') return 'Keine Aufmaß-Datei.';
  if (d.version !== 1) return `Version ${d.version} wird nicht unterstützt.`;
  if (typeof d.baustelle !== 'string' || !Array.isArray(d.etagen)) return 'Baustelle oder Etagen fehlen.';
  if (d.id != null && (typeof d.id !== 'string' || !d.id)) return 'Kennung (id) ungültig.';
  for (const e of d.etagen) {
    if (typeof e.name !== 'string' || !Array.isArray(e.raeume)) return 'Etage ohne Namen oder Räume.';
    for (const r of e.raeume) {
      const wo = `${e.name} / ${r.name}`;
      if (typeof r.name !== 'string' || !Array.isArray(r.waende)) return `${wo}: Name oder Wände fehlen.`;
      if (r.hoehe != null && !zahlOk(r.hoehe)) return `${wo}: Höhe ungültig.`;
      if (r.notiz != null && typeof r.notiz !== 'string') return `${wo}: Notiz ungültig.`;
      if (r.koerper != null && !Array.isArray(r.koerper)) return `${wo}: Säulen ungültig.`;
      for (const k of r.koerper || []) {
        const masse = k.form === 'kreis' ? zahlOk(k.d) && k.d > 0 : k.form === 'rechteck' && zahlOk(k.b) && zahlOk(k.t) && k.b > 0 && k.t > 0;
        if (!masse || !endlich(k.x) || !endlich(k.y) || (k.h != null && !zahlOk(k.h))) return `${wo}: Säule/Körper ungültig.`;
      }
      for (const [i, w] of r.waende.entries()) {
        if (w.laenge !== null && !zahlOk(w.laenge)) return `${wo}, Wand ${name(i)}: Länge ungültig.`;
        if (!(typeof w.winkel === 'number' && w.winkel >= 0 && w.winkel <= 360)) return `${wo}, Wand ${name(i)}: Winkel ungültig.`;
        if (w.gemessen != null && !zahlOk(w.gemessen)) return `${wo}, Wand ${name(i)}: gemessenes Maß ungültig.`;
        if (w.skizze != null && !zahlOk(w.skizze)) return `${wo}, Wand ${name(i)}: Skizzenlänge ungültig.`;
        if (w.mitrechnen != null && typeof w.mitrechnen !== 'boolean') return `${wo}, Wand ${name(i)}: „mitrechnen“ ungültig.`;
        if (w.oeffnungen != null && !Array.isArray(w.oeffnungen)) return `${wo}, Wand ${name(i)}: Öffnungen ungültig.`;
        for (const o of w.oeffnungen || [])
          if (!['tuer', 'fenster'].includes(o.art) || !['abstand', 'breite', 'hoehe', 'bruestung'].every(k => zahlOk(o[k])))
            return `${wo}, Wand ${name(i)}: Tür/Fenster ungültig.`;
        if (w.anschluesse != null && !Array.isArray(w.anschluesse)) return `${wo}, Wand ${name(i)}: Anschlüsse ungültig.`;
        for (const a of w.anschluesse || [])
          if (typeof a.art !== 'string' || !zahlOk(a.abstand) || !zahlOk(a.hoehe)) return `${wo}, Wand ${name(i)}: Anschluss ungültig.`;
      }
    }
  }
  return null;
}

/** Geprüfte Datei -> Baustelle für die App. Hat die Datei eine id, behält die Baustelle sie (Abgleich). */
export function einlesen(d, neueId) {
  return {
    ...rest(d, 'baustelle'), id: d.id || neueId, baustelle: d.baustelle,
    etagen: d.etagen.map(e => ({ ...rest(e, 'etage'), name: e.name, raeume: e.raeume.map(r => {
      const waende = r.waende.map(w => ({
        ...rest(w, 'wand'), laenge: w.gemessen ?? w.laenge, korrektur: w.gemessen != null && w.laenge != null ? w.laenge - w.gemessen : 0, winkel: w.winkel, mitrechnen: w.mitrechnen !== false,
        oeffnungen: (w.oeffnungen || []).map(o => structuredClone(o)),
        anschluesse: (w.anschluesse || []).map(a => structuredClone(a)),
        skizze: w.skizze ?? w.laenge ?? 1 }));
      const koerper = (r.koerper || []).map(k => koerperImport(k, waende));
      // schon gerundete Maße (gemessen ≠ laenge): diese Entscheidung bleibt, auch wenn die Toleranz hier kleiner ist
      const schluss = r.schluss ?? (r.waende.some(w => w.gemessen != null) ? 'mass' : undefined);
      return { ...rest(r, 'raum'), ...(schluss ? { schluss } : {}), name: r.name, hoehe: r.hoehe ?? null, notiz: r.notiz || '', drehung: 0, waende, koerper };
    }) })),
  };
}
