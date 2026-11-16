// Rechenlogik der Aufmaß-App (ohne Bildschirm), läuft im Browser und in Node (tests.mjs).
// Wände im Uhrzeigersinn, von oben gesehen, y nach oben, Wand A zuerst nach rechts – wie geometrie.py am PC.
// winkel = Innenwinkel an der Ecke am Ende der Wand: 90 normale Ecke, 270 vorspringende Ecke.

const rad = d => d * Math.PI / 180;
const r3 = v => Math.round(v * 1000) / 1000;

export const name = i => i < 26 ? String.fromCharCode(65 + i) : name(Math.floor(i / 26) - 1) + name(i % 26);

/** Eckpunkte [x, y]; fehlt ein Maß, gilt die Skizzenlänge. drehung = Richtung von Wand A in Grad (nur Anzeige). */
export function punkte(waende, drehung = 0) {
  let x = 0, y = 0, r = drehung;
  const p = [[0, 0]];
  for (const w of waende) {
    const l = w.laenge ?? w.skizze ?? 1;
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
  w[v].winkel = ((w[v].winkel + w[i].winkel - 180) % 360 + 360) % 360 || 360;
  w.splice(i, 1);
}

/** Ecke in Wand i einfügen (anteil 0…1 ab Wandanfang). Neue Ecke 180° = gerade, Maße beider Teile neu messen. */
export function eckeEinfuegen(raum, i, anteil) {
  const w = raum.waende[i];
  const l = w.laenge ?? w.skizze ?? 1;
  const vorn = (w.oeffnungen || []).filter(o => o.abstand < l * anteil);
  const hinten = (w.oeffnungen || []).filter(o => o.abstand >= l * anteil).map(o => ({ ...o, abstand: r3(o.abstand - l * anteil) }));
  const a = { ...w, laenge: null, winkel: 180, skizze: Math.round(l * anteil * 100) / 100, oeffnungen: vorn };
  const b = { ...w, laenge: null, skizze: Math.round(l * (1 - anteil) * 100) / 100, oeffnungen: hinten };
  raum.waende.splice(i, 1, a, b);
}

/** Eingabe vom Finger oder Laser (Tastaturmodus): "3,205", "3.205 m", "320,5 cm", "3205mm" -> Meter; leer -> null. */
export function zahl(text) {
  const t = String(text).trim().replace(',', '.');
  if (t === '') return null;
  const m = /^(\d+(?:\.\d*)?|\.\d+)\s*(mm|cm|m)?$/i.exec(t);
  if (!m) return NaN;
  return r3(Number(m[1]) / ({ mm: 1000, cm: 100 }[(m[2] || '').toLowerCase()] || 1));
}

/** Datei nach Abschnitt 3 (Version 1), Maße in m auf mm gerundet. Zusatzfelder für den Abgleich PC ↔ Handy
 *  (dürfen fehlen, ältere Leser übergehen sie): id = dieselbe Baustelle auf beiden Geräten,
 *  skizze = ungefähre Wandlänge aus Zeichnung/Plan, solange laenge noch nicht gemessen ist (null). */
export function exportieren(b, jetzt = new Date()) {
  const z = n => String(n).padStart(2, '0');
  const erstellt = `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}T${z(jetzt.getHours())}:${z(jetzt.getMinutes())}`;
  return {
    format: 'aufmass', version: 1, erstellt, id: b.id, baustelle: b.baustelle,
    etagen: b.etagen.map(e => ({ name: e.name, raeume: e.raeume.map(r => {
      const raum = { name: r.name };
      if (r.hoehe != null) raum.hoehe = r3(r.hoehe);
      raum.waende = r.waende.map(w => ({
        laenge: w.laenge == null ? null : r3(w.laenge),
        winkel: Math.round(w.winkel * 10) / 10,
        mitrechnen: w.mitrechnen !== false,
        oeffnungen: (w.oeffnungen || []).map(o => ({ art: o.art, abstand: r3(o.abstand), breite: r3(o.breite),
                                                     hoehe: r3(o.hoehe), bruestung: r3(o.bruestung ?? 0) })),
        ...(w.laenge == null && w.skizze != null ? { skizze: Math.round(w.skizze * 100) / 100 } : {}),
      }));
      raum.notiz = r.notiz || '';
      return raum;
    }) })),
  };
}

/** Prüft eine Aufmaß-Datei (beim Einlesen fremder Dateien). null = in Ordnung, sonst Fehlertext. */
export function pruefeDatei(d) {
  const zahlOk = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
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
      for (const [i, w] of r.waende.entries()) {
        if (w.laenge !== null && !zahlOk(w.laenge)) return `${wo}, Wand ${name(i)}: Länge ungültig.`;
        if (!(typeof w.winkel === 'number' && w.winkel >= 0 && w.winkel <= 360)) return `${wo}, Wand ${name(i)}: Winkel ungültig.`;
        if (w.skizze != null && !zahlOk(w.skizze)) return `${wo}, Wand ${name(i)}: Skizzenlänge ungültig.`;
        if (w.mitrechnen != null && typeof w.mitrechnen !== 'boolean') return `${wo}, Wand ${name(i)}: „mitrechnen“ ungültig.`;
        if (w.oeffnungen != null && !Array.isArray(w.oeffnungen)) return `${wo}, Wand ${name(i)}: Öffnungen ungültig.`;
        for (const o of w.oeffnungen || [])
          if (!['tuer', 'fenster'].includes(o.art) || !['abstand', 'breite', 'hoehe', 'bruestung'].every(k => zahlOk(o[k])))
            return `${wo}, Wand ${name(i)}: Tür/Fenster ungültig.`;
      }
    }
  }
  return null;
}

/** Geprüfte Datei -> Baustelle für die App. Hat die Datei eine id, behält die Baustelle sie (Abgleich). */
export function einlesen(d, neueId) {
  return {
    id: d.id || neueId, baustelle: d.baustelle,
    etagen: d.etagen.map(e => ({ name: e.name, raeume: e.raeume.map(r => ({
      name: r.name, hoehe: r.hoehe ?? null, notiz: r.notiz || '', drehung: 0,
      waende: r.waende.map(w => ({ laenge: w.laenge, winkel: w.winkel, mitrechnen: w.mitrechnen !== false,
                                   oeffnungen: (w.oeffnungen || []).map(o => ({ ...o })),
                                   skizze: w.skizze ?? w.laenge ?? 1 })),
    })) })),
  };
}
