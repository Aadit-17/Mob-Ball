import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMuted, saveMuted } from '../storage';
import { rateLimit } from './sound';

describe('rateLimit', () => {
  const gaps = {
    click: 0.03,
    kick: 0.08,
    'kick-boost': 0.08,
    barge: 0.12,
    goal: 1,
    whistle: 0.5,
    'golden-goal': 1,
    'full-time': 1,
  };

  it('drops repeats of a cue inside its gap and lets the next one through after it', () => {
    const allow = rateLimit(gaps);
    expect(allow('kick', 10)).toBe(true);
    expect(allow('kick', 10.05)).toBe(false);
    expect(allow('kick', 10.09)).toBe(true);
  });

  it('measures the gap from the last sound played, not the last one dropped', () => {
    const allow = rateLimit(gaps);
    allow('kick', 0);
    allow('kick', 0.05);
    expect(allow('kick', 0.1)).toBe(true);
  });

  it('throttles each cue on its own', () => {
    const allow = rateLimit(gaps);
    expect(allow('kick', 0)).toBe(true);
    expect(allow('barge', 0.01)).toBe(true);
    expect(allow('kick-boost', 0.02)).toBe(true);
  });
});

describe('mute preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    expect(loadMuted()).toBe(false);
    saveMuted(true);
    expect(loadMuted()).toBe(true);
    saveMuted(false);
    expect(loadMuted()).toBe(false);
  });

  it('treats anything but a stored true as sound on', () => {
    vi.stubGlobal('localStorage', { getItem: () => '"yes"' });
    expect(loadMuted()).toBe(false);
  });

  it('falls back to sound on when storage throws', () => {
    const broken = (): never => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: broken, setItem: broken });
    expect(loadMuted()).toBe(false);
    expect(() => {
      saveMuted(true);
    }).not.toThrow();
  });
});
