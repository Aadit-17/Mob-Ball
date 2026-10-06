import type { MatchEvent } from '../game/types';
import { loadMuted, saveMuted } from '../storage';

export type Cue =
  'click' | 'kick' | 'kick-boost' | 'barge' | 'goal' | 'whistle' | 'golden-goal' | 'full-time';

/** Shortest gap in seconds between two plays of a cue, so a scramble of kicks doesn't pile into noise. */
const MIN_GAP: Record<Cue, number> = {
  click: 0.03,
  kick: 0.08,
  'kick-boost': 0.08,
  barge: 0.12,
  goal: 1,
  whistle: 0.5,
  'golden-goal': 1,
  'full-time': 1,
};
const MASTER_VOLUME = 0.5;
const NOISE_SECONDS = 2;
/** Exponential ramps cannot reach zero. */
const SILENT = 0.0001;

interface Envelope {
  start: number;
  attack: number;
  hold: number;
  release: number;
  peak: number;
}

const endOf = (env: Envelope): number => env.start + env.attack + env.hold + env.release;

function envelope(ctx: AudioContext, out: AudioNode, env: Envelope): GainNode {
  const gain = ctx.createGain();
  const top = env.start + env.attack;
  gain.gain.setValueAtTime(SILENT, env.start);
  gain.gain.exponentialRampToValueAtTime(env.peak, top);
  gain.gain.setValueAtTime(env.peak, top + env.hold);
  gain.gain.exponentialRampToValueAtTime(SILENT, endOf(env));
  gain.connect(out);
  return gain;
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  from: number,
  to: number,
  env: Envelope,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, env.start);
  osc.frequency.exponentialRampToValueAtTime(to, endOf(env));
  osc.connect(envelope(ctx, out, env));
  osc.start(env.start);
  osc.stop(endOf(env));
  return osc;
}

function hiss(
  ctx: AudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  filter: BiquadFilterType,
  from: number,
  to: number,
  env: Envelope,
): void {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const shape = ctx.createBiquadFilter();
  shape.type = filter;
  shape.frequency.setValueAtTime(from, env.start);
  shape.frequency.exponentialRampToValueAtTime(to, endOf(env));
  source.connect(shape).connect(envelope(ctx, out, env));
  // A random offset into the loop keeps repeated hits from sounding identical.
  source.start(env.start, Math.random() * NOISE_SECONDS);
  source.stop(endOf(env));
}

function whistle(ctx: AudioContext, out: AudioNode, start: number, hold: number): void {
  const osc = tone(ctx, out, 'sine', 2600, 2450, { start, attack: 0.02, hold, release: 0.08, peak: 0.1 });
  // The pea in a referee's whistle makes a fast warble.
  const pea = ctx.createOscillator();
  pea.frequency.value = 28;
  const depth = ctx.createGain();
  depth.gain.value = 120;
  pea.connect(depth).connect(osc.frequency);
  pea.start(start);
  pea.stop(start + hold + 0.1);
}

type Voice = (ctx: AudioContext, out: AudioNode, noise: AudioBuffer, t: number) => void;

const VOICES: Record<Cue, Voice> = {
  click: (ctx, out, _noise, t) => {
    tone(ctx, out, 'sine', 1400, 900, { start: t, attack: 0.003, hold: 0, release: 0.04, peak: 0.06 });
  },
  kick: (ctx, out, noise, t) => {
    tone(ctx, out, 'sine', 160, 60, { start: t, attack: 0.004, hold: 0, release: 0.11, peak: 0.45 });
    hiss(ctx, out, noise, 'highpass', 2500, 1500, {
      start: t,
      attack: 0.002,
      hold: 0,
      release: 0.03,
      peak: 0.12,
    });
  },
  'kick-boost': (ctx, out, noise, t) => {
    tone(ctx, out, 'sine', 190, 45, { start: t, attack: 0.004, hold: 0.02, release: 0.17, peak: 0.7 });
    tone(ctx, out, 'triangle', 420, 120, { start: t, attack: 0.003, hold: 0, release: 0.07, peak: 0.18 });
    hiss(ctx, out, noise, 'bandpass', 3000, 1200, {
      start: t,
      attack: 0.002,
      hold: 0,
      release: 0.06,
      peak: 0.25,
    });
  },
  barge: (ctx, out, noise, t) => {
    tone(ctx, out, 'triangle', 520, 170, { start: t, attack: 0.005, hold: 0.02, release: 0.16, peak: 0.35 });
    tone(ctx, out, 'sine', 110, 50, { start: t, attack: 0.005, hold: 0, release: 0.2, peak: 0.6 });
    hiss(ctx, out, noise, 'lowpass', 1200, 300, {
      start: t,
      attack: 0.003,
      hold: 0,
      release: 0.1,
      peak: 0.2,
    });
  },
  goal: (ctx, out, noise, t) => {
    hiss(ctx, out, noise, 'bandpass', 1800, 500, {
      start: t,
      attack: 0.01,
      hold: 0.05,
      release: 0.35,
      peak: 0.35,
    });
    hiss(ctx, out, noise, 'bandpass', 450, 600, {
      start: t,
      attack: 0.5,
      hold: 0.6,
      release: 2.6,
      peak: 0.5,
    });
    hiss(ctx, out, noise, 'bandpass', 1000, 1300, {
      start: t,
      attack: 0.6,
      hold: 0.4,
      release: 2.2,
      peak: 0.25,
    });
  },
  whistle: (ctx, out, _noise, t) => {
    whistle(ctx, out, t, 0.3);
  },
  'golden-goal': (ctx, out, _noise, t) => {
    whistle(ctx, out, t, 0.12);
    whistle(ctx, out, t + 0.22, 0.12);
    [660, 830, 990, 1320].forEach((pitch, i) => {
      const start = t + 0.5 + i * 0.11;
      tone(ctx, out, 'triangle', pitch, pitch, { start, attack: 0.01, hold: 0.05, release: 0.5, peak: 0.14 });
    });
  },
  'full-time': (ctx, out, _noise, t) => {
    whistle(ctx, out, t, 0.18);
    whistle(ctx, out, t + 0.35, 0.18);
    whistle(ctx, out, t + 0.7, 0.9);
  },
};

/** Lets each cue through at most once per its gap; `now` is in seconds. */
export function rateLimit(gaps: Record<Cue, number>): (cue: Cue, now: number) => boolean {
  const last = new Map<Cue, number>();
  return (cue, now) => {
    const previous = last.get(cue);
    if (previous !== undefined && now - previous < gaps[cue]) return false;
    last.set(cue, now);
    return true;
  };
}

/** Sound effects synthesised with Web Audio. Silent, never throwing, wherever audio is unavailable. */
class Sound {
  muted = loadMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private matchBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private attached = false;
  private readonly allow = rateLimit(MIN_GAP);

  /** Browsers only let audio start from a user gesture, so the context waits for one. Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const unlock = (): void => {
      this.unlock();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener(
      'click',
      (e) => {
        if (e.target instanceof Element && e.target.closest('button')) this.play('click');
      },
      true,
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    saveMuted(muted);
    if (muted) void this.ctx?.suspend().catch(() => undefined);
    else {
      this.unlock();
      this.play('click');
    }
  }

  handle(event: MatchEvent): void {
    this.play(event.type === 'kick' && event.boost > 1 ? 'kick-boost' : event.type);
  }

  play(cue: Cue): void {
    const { ctx, master, noise } = this;
    if (this.muted || !ctx || !master || !noise || !this.allow(cue, ctx.currentTime)) return;
    let out = master;
    if (cue !== 'click') {
      if (!this.matchBus) {
        this.matchBus = ctx.createGain();
        this.matchBus.connect(master);
      }
      out = this.matchBus;
    }
    VOICES[cue](ctx, out, noise, ctx.currentTime);
  }

  /** Cuts anything the match left ringing, such as the crowd's roar. */
  stopMatch(): void {
    this.matchBus?.disconnect();
    this.matchBus = null;
  }

  private unlock(): void {
    if (this.muted) return;
    if (!this.ctx) {
      if (typeof AudioContext === 'undefined') return;
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
      this.noise = whiteNoise(this.ctx);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export const sound = new Sound();
