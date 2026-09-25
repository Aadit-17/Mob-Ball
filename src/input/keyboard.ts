import type { Input } from '../game/types';

const GAME_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const normalise = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

/** Tracks held keys on the window and turns them into a knight's input. */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly onPress: (key: string) => void = () => undefined) {
    const down = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return;
      const key = normalise(e.key);
      if (GAME_KEYS.has(key)) e.preventDefault();
      if (!e.repeat) this.onPress(key);
      this.held.add(key);
    };
    const up = (e: KeyboardEvent): void => {
      this.held.delete(normalise(e.key));
    };
    const clear = (): void => {
      this.held.clear();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    this.listeners.push(
      () => {
        window.removeEventListener('keydown', down);
      },
      () => {
        window.removeEventListener('keyup', up);
      },
      () => {
        window.removeEventListener('blur', clear);
      },
    );
  }

  input(): Input {
    const is = (...keys: string[]): boolean => keys.some((k) => this.held.has(k));
    return {
      moveX: (is('d', 'ArrowRight') ? 1 : 0) - (is('a', 'ArrowLeft') ? 1 : 0),
      moveY: (is('s', 'ArrowDown') ? 1 : 0) - (is('w', 'ArrowUp') ? 1 : 0),
      kick: is(' ', 'x'),
      barge: is('Shift', 'e'),
    };
  }

  dispose(): void {
    for (const remove of this.listeners) remove();
    this.held.clear();
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
