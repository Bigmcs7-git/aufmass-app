// Laser-Schnittstelle (Web Bluetooth, nur Chrome auf Android/PC). Austauschbar: app.js nutzt nur moeglich() und verbinden().
// shortcut: Protokolle aus freien Quellen nachgebaut, am echten Gerät noch nicht geprüft (Pauls Gerät: Bosch GLM 150-27 C).

/** Bosch GLM „C“ (Protokoll mit Rahmen C0 55 …): Entfernung in m als 32-bit-Kommazahl ab Byte 7. null = keine Messung. */
export function boschWert(dv) {
  if (dv.byteLength < 11 || dv.getUint8(0) !== 0xc0 || dv.getUint8(1) !== 0x55) return null;
  return dv.getFloat32(7, true);
}

const GERAETE = [
  { // Bosch GLM 50 C, 100 C, 120 C, 50-27 C, 100-25 C, 150-27 C (MeasureOn-Geräte)
    name: 'Bosch GLM',
    namePrefix: 'GLM',
    dienst: '02a6c0d0-0451-4000-b000-fb3210111989',
    messwert: '02a6c0d1-0451-4000-b000-fb3210111989',
    start: [0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a], // „Messwerte senden“ einschalten (am Gerät messen → Wert kommt)
    lesen: boschWert,
  },
  { // Leica DISTO (D1, D2, X3, X4, D510, D810 …): Entfernung als 32-bit-Kommazahl in Metern
    name: 'Leica DISTO',
    namePrefix: 'DISTO',
    dienst: '3ab10100-f831-4395-b29d-570977d5bf94',
    messwert: '3ab10101-f831-4395-b29d-570977d5bf94',
    lesen: dv => dv.getFloat32(0, true),
  },
];

export const moeglich = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

/** Fragt nach dem Gerät (Android-Auswahlfenster), meldet jede Messung als Meter an beiWert. */
export async function verbinden(beiWert, beiTrennung) {
  const geraet = await navigator.bluetooth.requestDevice({
    filters: GERAETE.flatMap(g => [{ services: [g.dienst] }, { namePrefix: g.namePrefix }]),
    optionalServices: GERAETE.map(g => g.dienst),
  });
  geraet.addEventListener('gattserverdisconnected', beiTrennung);
  const server = await geraet.gatt.connect();
  for (const g of GERAETE) {
    const dienst = await server.getPrimaryService(g.dienst).catch(() => null);
    if (!dienst) continue;
    const kanal = await dienst.getCharacteristic(g.messwert);
    kanal.addEventListener('characteristicvaluechanged', e => {
      const m = g.lesen(e.target.value);
      if (Number.isFinite(m) && m > 0 && m < 300) beiWert(Math.round(m * 1000) / 1000);
    });
    await kanal.startNotifications();
    if (g.start) await kanal.writeValue(new Uint8Array(g.start));
    return { name: geraet.name || g.name, trennen: () => geraet.gatt.disconnect() };
  }
  geraet.gatt.disconnect();
  throw new Error('Dieses Gerät wird noch nicht unterstützt.');
}
