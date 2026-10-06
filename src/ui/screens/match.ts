import type { AppContext } from '../../app';
import { BotBrain } from '../../ai/brain';
import { muteButton } from '../../audio/mute-button';
import { sound } from '../../audio/sound';
import { KNIGHT, MATCH, STEP } from '../../game/constants';
import { createMatch, knightById, stepMatch } from '../../game/match';
import { randomSeed } from '../../game/rng';
import type { MatchEvent, MatchState } from '../../game/types';
import { Keyboard } from '../../input/keyboard';
import type { GoalRecord, MatchResult, MatchSession } from '../../modes/mode';
import { Camera, VIEW } from '../../render/camera';
import { Effects } from '../../render/effects';
import { setupCanvas } from '../../render/paint';
import { MatchRenderer } from '../../render/renderer';
import { button, h } from '../dom';

/** Goals are replayed in slow motion for this long. */
const SLOW_MOTION = { seconds: 0.6, scale: 0.25 } as const;
/** Never simulate more than this much time in one frame, e.g. after the tab was hidden. */
const MAX_FRAME = 0.05;

/** Maps match time onto a football clock: a full match reads as 90 minutes. */
const footballMinute = (elapsed: number, duration: number, golden: boolean): string =>
  golden ? '90+' : String(Math.max(1, Math.ceil((elapsed / duration) * 90)));

const formatClock = (seconds: number): string => {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function mountMatch(root: HTMLElement, app: AppContext): () => void {
  const session = app.session;
  if (session) return runMatch(root, app, session);
  queueMicrotask(() => {
    app.go('home');
  });
  return () => undefined;
}

function runMatch(root: HTMLElement, app: AppContext, session: MatchSession): () => void {
  const { homeHouse, awayHouse } = session;
  // Assigned once the overlay exists; the HUD's pause button only calls it on click.
  let togglePause = (): void => undefined;
  const state: MatchState = createMatch({ home: session.home, away: session.away, seed: randomSeed() });
  const duration = state.clock;
  const human = state.knights.find((k) => k.human);
  const brain = new BotBrain();
  const camera = new Camera();
  const effects = new Effects();
  const goals: GoalRecord[] = [];
  const colours = [homeHouse.colour, awayHouse.colour] as const;
  camera.snap();

  const canvas = h('canvas', { class: 'pitch', attrs: { 'aria-label': 'Match' } });
  const renderer = new MatchRenderer(setupCanvas(canvas, VIEW.width, VIEW.height));
  const score = h('div', { class: 'sc', text: '0 – 0' });
  const clock = h('div', { class: 'clock', text: formatClock(duration) });
  const message = h('div', { class: 'msg', attrs: { 'aria-live': 'polite' } });
  const bargeRing = h('div', { class: 'ring' });
  const overlay = h('div', { class: 'overlay', attrs: { hidden: '' } });
  const mute = muteButton('Mute (M)', 'icon-btn mute-btn');
  mute.addEventListener('click', () => {
    mute.blur();
  });

  root.append(
    h(
      'section',
      { class: 'match' },
      h(
        'div',
        { class: 'stage' },
        canvas,
        h(
          'div',
          { class: 'hud' },
          h(
            'div',
            { class: 'board' },
            h('div', { style: { background: homeHouse.colour }, text: homeHouse.name.toUpperCase() }),
            score,
            h('div', { style: { background: awayHouse.colour }, text: awayHouse.name.toUpperCase() }),
            clock,
          ),
          message,
          h('div', { class: 'barge' }, bargeRing, h('span', { text: 'BARGE' })),
          mute,
          h('button', {
            class: 'icon-btn pause-btn',
            text: 'II',
            attrs: { type: 'button', 'aria-label': 'Pause (Esc)', title: 'Pause (Esc)' },
            on: {
              click: (e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                togglePause();
              },
            },
          }),
        ),
        overlay,
      ),
      h('p', {
        class: 'hint',
        text: 'WASD / arrows run · Space kick (hold to kick on contact) · Shift or E barge · Esc pause · M mute',
      }),
    ),
  );

  let messageUntil = 0;
  let lastPhase: MatchState['phase'] | null = null;
  let elapsed = 0;
  const say = (html: string, seconds: number): void => {
    message.innerHTML = html;
    messageUntil = elapsed + seconds;
  };
  const big = (text: string): string => `<span class="big">${text}</span>`;
  const escape = (text: string): string => text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

  const onEvent = (event: MatchEvent): void => {
    effects.handle(event);
    sound.handle(event);
    if (event.type === 'goal') {
      const scorer = knightById(state, event.scorerId);
      const minute = footballMinute(duration - state.clock, duration, state.goldenGoal);
      const name = scorer ? (scorer.human ? 'You' : scorer.look.name) : 'The mob';
      goals.push({
        team: event.team,
        scorer: name,
        byPlayer: scorer?.human ?? false,
        ownGoal: event.ownGoal,
        minute,
      });
      const line = event.ownGoal
        ? `OWN GOAL BY ${name.toUpperCase()}`
        : scorer?.human
          ? 'YOU SCORE!'
          : `${name.toUpperCase()} SCORES!`;
      say(`${big('GOAL!')}<div>${escape(line)}</div>`, 2.2);
    } else if (event.type === 'golden-goal') {
      say(`${big('GOLDEN GOAL')}<div>NEXT GOAL WINS</div>`, 1.8);
    } else if (event.type === 'full-time') {
      showResults();
    }
  };

  let paused = false;
  togglePause = (): void => {
    if (state.phase === 'ended') return;
    paused = !paused;
    if (paused) {
      showOverlay(
        h('h2', { text: 'Paused' }),
        h(
          'div',
          { class: 'overlay-actions' },
          button('Continue', togglePause, 'btn btn-go'),
          button('Restart', () => {
            app.playMatch(session);
          }),
          button('Quit to home', () => {
            app.go('home');
          }),
        ),
      );
    } else overlay.hidden = true;
  };
  const keyboard = new Keyboard((key) => {
    if (key === 'Escape' || key === 'p') togglePause();
    else if (key === 'm') mute.click();
  });

  function showOverlay(...children: HTMLElement[]): void {
    overlay.replaceChildren(h('div', { class: 'overlay-card' }, ...children));
    overlay.hidden = false;
    overlay.querySelector('button')?.focus();
  }

  function showResults(): void {
    const result: MatchResult = { score: [state.score[0], state.score[1]], goals };
    const [us, them] = result.score;
    const verdict = us > them ? 'Victory!' : us < them ? 'Defeat' : 'Draw';
    const scorers = h(
      'ul',
      { class: 'scorers' },
      ...goals.map((g) =>
        h('li', {
          class: g.team === 0 ? 'ours' : 'theirs',
          text: `${g.minute}′ ${g.scorer}${g.ownGoal ? ' (own goal)' : ''}`,
        }),
      ),
    );
    showOverlay(
      h('h2', { text: verdict }),
      h('p', { class: 'final', text: `${homeHouse.name} ${us} – ${them} ${awayHouse.name}` }),
      goals.length ? scorers : h('p', { text: 'A goalless scrap.' }),
      h(
        'div',
        { class: 'overlay-actions' },
        ...session
          .resultActions(result)
          .map((action) => button(action.label, action.run, action.primary ? 'btn btn-go' : 'btn')),
      ),
    );
  }

  let last = performance.now();
  let accumulator = 0;
  let frame = 0;
  const tick = (now: number): void => {
    const dt = Math.min(MAX_FRAME, (now - last) / 1000);
    last = now;
    if (!paused) {
      elapsed += dt;
      const slow = state.phase === 'goal' && state.phaseTime < SLOW_MOTION.seconds;
      accumulator += dt * (slow ? SLOW_MOTION.scale : 1);
      while (accumulator >= STEP) {
        accumulator -= STEP;
        stepMatch(state, (k) => (k.human ? keyboard.input() : brain.input(state, k)));
        const events = state.events;
        state.events = [];
        for (const event of events) onEvent(event);
      }
      // Shown once per kick-off: re-setting it every frame would restart its pop-in animation.
      if (state.phase === 'kickoff' && lastPhase !== 'kickoff') {
        say(big('READY?'), MATCH.kickoffPause - state.phaseTime);
      } else if (elapsed > messageUntil) message.innerHTML = '';
      if (state.phase === 'play' && lastPhase === 'kickoff') sound.play('whistle');
      lastPhase = state.phase;
      camera.follow(state.ball, human, dt);
      effects.update(dt, state);
      score.textContent = `${state.score[0]} – ${state.score[1]}`;
      clock.textContent = state.goldenGoal ? 'GOLDEN' : formatClock(state.clock);
      bargeRing.style.setProperty('--p', String(1 - (human?.bargeCooldown ?? 0) / KNIGHT.bargeCooldown));
    }
    renderer.draw({
      state,
      camera,
      effects,
      teamColours: colours,
      humanId: human?.id ?? null,
      time: elapsed,
    });
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    keyboard.dispose();
    sound.stopMatch();
  };
}
