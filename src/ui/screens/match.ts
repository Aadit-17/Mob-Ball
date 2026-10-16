import type { AppContext } from '../../app';
import { muteButton } from '../../audio/mute-button';
import { sound } from '../../audio/sound';
import { KNIGHT, MATCH, STEP } from '../../game/constants';
import { knightById } from '../../game/match';
import { randomSeed } from '../../game/rng';
import type { MatchEvent, MatchState, TeamId } from '../../game/types';
import { Keyboard } from '../../input/keyboard';
import type { GoalRecord, MatchResult, MatchSession } from '../../modes/mode';
import { MatchRunner } from '../../modes/runner';
import { Camera, VIEW } from '../../render/camera';
import { Effects } from '../../render/effects';
import { setupCanvas } from '../../render/paint';
import { MatchRenderer } from '../../render/renderer';
import type { House } from '../../setup/houses';
import { button, h } from '../dom';
import { blockColour, crest, icon } from '../heraldry';
import { lozengeBurst, reducedMotion } from '../motion';

/** Goals are replayed in slow motion for this long. */
const SLOW_MOTION = { seconds: 0.6, scale: 0.25 } as const;
/** Never simulate more than this much time in one frame, e.g. after the tab was hidden. */
const MAX_FRAME = 0.05;
/** Speeds a watched match can run at; the simulation still advances in fixed steps, so the match is the same. */
const SPEEDS = [1, 2, 4] as const;

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
  const { fixture } = session;
  const runner = new MatchRunner({
    home: session.home,
    away: session.away,
    seed: fixture?.seed ?? randomSeed(),
    ...(fixture?.tactics ? { tactics: fixture.tactics } : {}),
    ...(fixture?.draws ? { draws: true } : {}),
    ...(fixture?.managers ? { managers: fixture.managers } : {}),
  });
  const state: MatchState = runner.state;
  const duration = state.clock;
  const human = state.knights.find((k) => k.human);
  let speed: (typeof SPEEDS)[number] = 1;
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
  const fx = h('div', { class: 'fx', attrs: { 'aria-hidden': 'true' } });
  const teamBlock = (house: House, side: 'home' | 'away'): HTMLElement =>
    h('div', { class: `team ${side}` }, crest(house), h('span', { text: house.name.toUpperCase() }));
  const blocks = [teamBlock(homeHouse, 'home'), teamBlock(awayHouse, 'away')] as const;
  const mute = muteButton('Mute (M)', 'icon-btn mute-btn');
  mute.addEventListener('click', () => {
    mute.blur();
  });
  const speedButtons = SPEEDS.map((s) =>
    h('button', {
      class: s === speed ? 'speed on' : 'speed',
      text: `${s}×`,
      attrs: { type: 'button', 'aria-pressed': String(s === speed), title: `Watch at ${s}× speed` },
      on: {
        click: (e) => {
          (e.currentTarget as HTMLButtonElement).blur();
          setSpeed(s);
        },
      },
    }),
  );
  const watchControls = session.spectate
    ? h(
        'div',
        { class: 'watch' },
        ...speedButtons,
        h('button', {
          class: 'speed skip',
          text: 'Skip',
          attrs: { type: 'button', title: 'Skip to full time' },
          on: {
            click: (e) => {
              (e.currentTarget as HTMLButtonElement).blur();
              skipToEnd();
            },
          },
        }),
      )
    : null;

  root.append(
    h(
      'section',
      {
        class: 'match',
        attrs: { style: `--home: ${blockColour(homeHouse)}; --away: ${blockColour(awayHouse)}` },
      },
      h(
        'div',
        { class: 'stage' },
        canvas,
        fx,
        h(
          'div',
          { class: 'hud' },
          h('div', { class: 'board' }, blocks[0], score, blocks[1], clock),
          message,
          ...(human ? [h('div', { class: 'barge' }, bargeRing, h('span', { text: 'BARGE' }))] : []),
          ...(watchControls ? [watchControls] : []),
          mute,
          h(
            'button',
            {
              class: 'icon-btn pause-btn',
              attrs: { type: 'button', 'aria-label': 'Pause (Esc)', title: 'Pause (Esc)' },
              on: {
                click: (e) => {
                  (e.currentTarget as HTMLButtonElement).blur();
                  togglePause();
                },
              },
            },
            icon('pause'),
          ),
        ),
        overlay,
      ),
      h('p', {
        class: 'hint',
        text: human
          ? 'WASD / arrows run · Space kick (hold to kick on contact) · Shift or E barge · Esc pause · M mute'
          : '1 / 2 / 3 speed · Esc pause · M mute',
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

  /** Records a goal for the results screen and returns the scorer's display name. */
  const recordGoal = (event: Extract<MatchEvent, { type: 'goal' }>): string => {
    const scorer = knightById(state, event.scorerId);
    const name = scorer ? (scorer.human ? 'You' : scorer.look.name) : 'The mob';
    goals.push({
      team: event.team,
      scorer: name,
      byPlayer: scorer?.human ?? false,
      ownGoal: event.ownGoal,
      minute: footballMinute(duration - state.clock, duration, state.goldenGoal),
    });
    return name;
  };

  const onEvent = (event: MatchEvent): void => {
    effects.handle(event);
    sound.handle(event);
    if (event.type === 'goal') {
      const name = recordGoal(event);
      const scorer = knightById(state, event.scorerId);
      const line = event.ownGoal
        ? `OWN GOAL BY ${name.toUpperCase()}`
        : scorer?.human
          ? 'YOU SCORE!'
          : `${name.toUpperCase()} SCORES!`;
      say(`${big('GOAL!')}<div class="msg-line">${escape(line)}</div>`, 2.2);
      celebrate(event.team);
    } else if (event.type === 'substitution') {
      const on = knightById(state, event.onId)?.look.name ?? '';
      const off = knightById(state, event.offId)?.look.name ?? '';
      say(`${big('CHANGE')}<div class="msg-line">${escape(`${on} on, ${off} off`.toUpperCase())}</div>`, 2.2);
    } else if (event.type === 'golden-goal') {
      say(`${big('GOLDEN GOAL')}<div class="msg-line">NEXT GOAL WINS</div>`, 1.8);
    } else if (event.type === 'full-time') {
      showResults();
    }
  };

  function celebrate(team: TeamId): void {
    if (reducedMotion()) return;
    blocks[team].animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.12)', filter: 'brightness(1.35)', offset: 0.3 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 900, iterations: 2, easing: 'cubic-bezier(.2,.9,.2,1)' },
    );
    lozengeBurst(fx, fx.clientWidth / 2, fx.clientHeight * 0.42, [
      '#ffe39a',
      '#f2c14e',
      '#fff6d0',
      homeHouse.colour,
      awayHouse.colour,
    ]);
  }

  let paused = false;
  togglePause = (): void => {
    if (state.phase === 'ended') return;
    paused = !paused;
    if (paused) {
      showOverlay(
        h('h2', { class: 'ribbon', text: 'Paused' }),
        h(
          'div',
          { class: 'overlay-actions' },
          button('Continue', togglePause, 'btn-primary'),
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
  function setSpeed(next: (typeof SPEEDS)[number]): void {
    speed = next;
    speedButtons.forEach((b, i) => {
      const on = SPEEDS[i] === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** Plays the rest of the match without drawing it: the same steps the screen would have run. */
  function skipToEnd(): void {
    if (state.phase === 'ended') return;
    paused = false;
    while (!runner.ended) {
      runner.advanceOne();
      const events = state.events;
      state.events = [];
      for (const event of events) if (event.type === 'goal') recordGoal(event);
    }
    sound.play('full-time');
    showResults();
  }

  const keyboard = new Keyboard((key) => {
    if (key === 'Escape' || key === 'p') togglePause();
    else if (key === 'm') mute.click();
    else if (session.spectate && (key === '1' || key === '2' || key === '3'))
      setSpeed(SPEEDS[Number(key) - 1] ?? 1);
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
    const block = (house: House, side: 'home' | 'away'): HTMLElement =>
      h('span', { class: `blk ${side}`, text: house.name });
    showOverlay(
      h('p', { class: 'ribbon', text: 'Full time' }),
      h('h2', { class: 'verdict', text: verdict }),
      h(
        'p',
        { class: 'final' },
        block(homeHouse, 'home'),
        ' ',
        h('span', { class: 'final-score', text: `${us} – ${them}` }),
        ' ',
        block(awayHouse, 'away'),
      ),
      goals.length ? scorers : h('p', { class: 'goalless', text: 'A goalless scrap.' }),
      h(
        'div',
        { class: 'overlay-actions' },
        ...session
          .resultActions(result)
          .map((action) => button(action.label, action.run, action.primary ? 'btn-primary' : 'btn')),
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
      accumulator += dt * (slow ? SLOW_MOTION.scale : speed);
      while (accumulator >= STEP && !runner.ended) {
        accumulator -= STEP;
        runner.advanceOne((k) => (k.human ? keyboard.input() : null));
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
