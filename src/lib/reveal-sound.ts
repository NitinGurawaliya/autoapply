/**
 * The daily reveal's sounds (Phase R, docs/reveal/TDD.md 4.4): made in the browser with Web Audio, no files. Quiet
 * (gain 0.55 at most), short (under 1.6 s each), and off with one tap; the choice is kept per device (a convenience,
 * so a failed read just means sound on). Browsers start audio only after a gesture in the page: a tap that brought the
 * user to the feed counts, a cold load from a push does not, so until then every call is silent.
 */
const KEY = "swipeapply:reveal-sound";

type Ctx = { ctx: AudioContext; out: GainNode; noise: AudioBuffer };
let audio: Ctx | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode or blocked storage: the choice holds for this visit only.
  }
  if (on) startSound();
  window.dispatchEvent(new Event(KEY));
}

/** For useSyncExternalStore: told when the choice changes in this tab. */
export function subscribeSound(onChange: () => void) {
  window.addEventListener(KEY, onChange);
  return () => window.removeEventListener(KEY, onChange);
}

/** Creates or resumes the audio context; call from a tap. Silent where Web Audio is missing or blocked. */
export function startSound() {
  try {
    if (!audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(ctx.destination);
      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      audio = { ctx, out, noise };
    }
    void audio.ctx.resume();
  } catch {
    audio = null;
  }
}

function ready(): Ctx | null {
  return audio && audio.ctx.state === "running" && soundOn() ? audio : null;
}

/** A breath of air: noise through a band-pass swept from one pitch to another. */
export function whoosh(dur = 1.2, from = 260, to = 1400, gain = 0.16, delay = 0) {
  const a = ready();
  if (!a) return;
  const t = a.ctx.currentTime + delay;
  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  src.loop = true;
  const filter = a.ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(a.out);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** A soft tone: a quick start and a long tail. */
export function tone(freq: number, dur = 0.5, gain = 0.07, delay = 0, type: OscillatorType = "sine") {
  const a = ready();
  if (!a) return;
  const t = a.ctx.currentTime + delay;
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const tick = (delay = 0) => tone(2400, 0.03, 0.025, delay, "triangle");

/** A low, quiet thump: something landing. */
export function thump(delay = 0, gain = 0.12) {
  const a = ready();
  if (!a) return;
  const t = a.ctx.currentTime + delay;
  const osc = a.ctx.createOscillator();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.14);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(g).connect(a.out);
  osc.start(t);
  osc.stop(t + 0.2);
}

/** The odometer: ticks that slow down as the digits settle. */
export function roll(ms: number) {
  let at = 0;
  let step = 26;
  while (at < ms) {
    tick(at / 1000);
    at += step;
    step *= 1.16;
  }
}

export function chord(delay = 0) {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => tone(freq, 1.6, 0.035, delay + i * 0.04));
}

/** C major pentatonic, rising: one note for each pick as it lifts. */
export const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.32];
