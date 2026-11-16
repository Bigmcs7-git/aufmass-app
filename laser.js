// Laser-Schnittstelle (Web Bluetooth, nur Chrome auf Android/PC). Austauschbar: app.js nutzt nur moeglich() und verbinden().
// shortcut: nur Leica DISTO, am echten Gerät noch nicht geprüft. Erweitern, sobald Paul sein Lasermodell nennt.
// Ohne Direktverbindung geht der Tastaturmodus des Lasers immer: Zahl + Enter landet im gewählten Feld.

const GERAETE = [
  { // Leica DISTO (D1, D2, X3, X4, D510, D810 …): Entfernung als 32-bit-Kommazahl in Metern (little endian)
    name: 'Leica DISTO',
    dienst: '3ab10100-f831-4395-b29d-570977d5bf94',
    messwert: '3ab10101-f831-4395-b29d-570977d5bf94',
    lesen: dv => dv.getFloat32(0, true),
  },
];

export const moeglich = () => !!navigator.bluetooth;

/** Fragt nach dem Gerät (Android-Auswahlfenster), meldet jede Messung als Meter an beiWert. */
export async function verbinden(beiWert, beiTrennung) {
  const geraet = await navigator.bluetooth.requestDevice({
    filters: [...GERAETE.map(g => ({ services: [g.dienst] })), { namePrefix: 'DISTO' }],
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
    return { name: geraet.name || g.name, trennen: () => geraet.gatt.disconnect() };
  }
  geraet.gatt.disconnect();
  throw new Error('Dieses Gerät wird noch nicht unterstützt. Bitte den Tastaturmodus des Lasers nutzen.');
}
