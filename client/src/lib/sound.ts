// Sons synthétisés (Web Audio), aucun fichier à charger : palettes qui claquent, carillon de gare, tampon,
// bourdon d'un refus, cloche du dernier appel.
import { useStore } from '../store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useStore.getState().prefs.sound) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number; attack?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.1, t0 + (opts.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; freq?: number; type?: BiquadFilterType; q?: number; fade?: number; sweep?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const buffer = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = opts.fade ?? 2;
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** fade;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq ?? 2400, t0);
  if (opts.sweep) filter.frequency.exponentialRampToValueAtTime(opts.sweep, t0 + dur);
  if (opts.q) filter.Q.value = opts.q;
  const g = a.createGain();
  g.gain.value = opts.gain ?? 0.25;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

/** Une palette qui tombe : un claquement sec de carton. */
function clack(gain = 1, delay = 0): void {
  noise(0.022, { gain: 0.22 * gain, freq: 2600 + Math.random() * 900, q: 2.5, fade: 7, delay });
}

/** Un carillon de deux notes, comme une annonce en gare (sans reprendre aucun jingle connu). */
function chime(notes: number[], gain = 0.05, gap = 0.2, delay = 0): void {
  notes.forEach((f, i) => {
    tone(f, 0.9, { type: 'sine', gain, delay: delay + i * gap, attack: 0.01 });
    tone(f * 2, 0.5, { type: 'sine', gain: gain * 0.25, delay: delay + i * gap, attack: 0.01 });
  });
}

let lastClack = 0;

export const sfx = {
  /** Une palette qui tourne (limité, pour ne pas faire un vacarme quand tout le tableau change). */
  flap: () => {
    const now = performance.now();
    if (now - lastClack < 28) return;
    lastClack = now;
    clack(0.7);
  },
  /** Une série de palettes : le tableau change. */
  board: (n = 6) => {
    for (let i = 0; i < n; i++) clack(0.8, i * 0.055 + Math.random() * 0.02);
  },
  /** Un tap discret sur un bouton du jeu. */
  tap: () => tone(660, 0.05, { type: 'triangle', gain: 0.025 }),
  /** Une demande de contact arrive. */
  ask: () => chime([659.25, 880], 0.045, 0.16),
  /** Sa demande est partie. */
  sent: () => tone(523.25, 0.12, { type: 'triangle', gain: 0.03 }),
  /** Le contact a lieu : deux notes qui se répondent, puis le tableau qui tourne. */
  contact: () => {
    chime([587.33, 783.99], 0.05, 0.14);
    for (let i = 0; i < 5; i++) clack(0.7, 0.3 + i * 0.05);
  },
  /** Deux autres joueurs entrent en contact : un léger déclic au loin. */
  distant: () => {
    clack(0.35);
    clack(0.3, 0.06);
  },
  /** Refus, demande tombée : un bourdon bref. */
  no: () => tone(196, 0.25, { type: 'square', gain: 0.022, slide: 0.8 }),
  /** Un ticket reçu, un carnet acheté : un poinçon. */
  punch: () => {
    noise(0.04, { gain: 0.3, freq: 900, q: 1.2, fade: 3 });
    tone(1046.5, 0.18, { type: 'triangle', gain: 0.03, delay: 0.03 });
  },
  /** Le standard ferme bientôt : une cloche. */
  bell: () => {
    for (const d of [0, 0.5]) {
      tone(880, 1.2, { type: 'sine', gain: 0.05, delay: d });
      tone(1318.5, 0.8, { type: 'sine', gain: 0.02, delay: d });
    }
  },
  /** Une seconde des dix dernières. */
  tick: () => noise(0.015, { gain: 0.12, freq: 4200, q: 4, fade: 8 }),
  /** Fiche rendue : un coup de tampon. */
  stamp: () => {
    noise(0.08, { gain: 0.35, freq: 320, q: 1.2, fade: 4 });
    tone(110, 0.12, { type: 'sine', gain: 0.07, slide: 0.7 });
  },
  /** Fin de partie : modeste ou triomphale. */
  fanfare: (good: boolean) => {
    const notes = good ? [523.25, 659.25, 783.99, 659.25, 783.99, 1046.5] : [392, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => tone(f, i === notes.length - 1 ? 0.9 : 0.2, { type: 'triangle', gain: 0.06, delay: i * 0.13 }));
  },
  /** Début de partie : tout le tableau tourne. */
  start: () => {
    chime([523.25, 659.25, 783.99], 0.04, 0.15);
    for (let i = 0; i < 10; i++) clack(0.7, 0.45 + i * 0.045);
  },
};
