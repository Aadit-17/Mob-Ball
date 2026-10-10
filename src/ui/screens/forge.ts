import type { AppContext } from '../../app';
import { createRng, randomSeed } from '../../game/rng';
import { BUILDS } from '../../game/constants';
import {
  BEARDS,
  FORGE_TABS,
  HELMETS,
  option,
  SLOTS,
  TORSOS,
  type ForgeTab,
  type SlotDef,
} from '../../knight/catalog';
import { drawKnight, spriteHeight, STANDING } from '../../knight/draw';
import {
  decodeLook,
  encodeLook,
  NAME_MAX_LENGTH,
  randomLook,
  sanitizeName,
  totalCombinations,
  type Look,
} from '../../knight/look';
import { setupCanvas } from '../../render/paint';
import { buildStatRows } from '../build-stats';
import { button, h } from '../dom';

const PREVIEW = 340;

/** Why a slot has no visible effect with the current helmet or armour, if it doesn't. */
export function hiddenNote(look: Look, slot: SlotDef['key']): string {
  const helmet = option(HELMETS, look.helmet);
  const name = helmet.name.toLowerCase();
  const torso = option(TORSOS, look.torso);
  const noBeard = option(BEARDS, look.beard) === 'None';
  switch (slot) {
    case 'skin':
    case 'marks':
      if (!helmet.face) return `hidden by the ${name}`;
      return slot === 'marks' && helmet.face === 'T' ? 'hidden by the barbute' : '';
    case 'eyes':
      return helmet.face ? '' : 'only a glint through the visor';
    case 'beard':
      if (!helmet.face) return `hidden by the ${name}`;
      return helmet.face === 'T' ? 'shows through the T-slot' : '';
    case 'hairstyle':
      return helmet.showsHair ? '' : `hidden by the ${name}`;
    case 'hair':
      if (helmet.showsHair) return '';
      return noBeard || !helmet.face ? 'hidden right now' : 'beard only';
    case 'pattern':
      return torso === 'Breastplate' || torso === 'Leather jerkin'
        ? `no cloth panel on a ${torso.toLowerCase()}`
        : '';
    default:
      return '';
  }
}

export function mountForge(root: HTMLElement, app: AppContext): () => void {
  let look: Look = { ...app.look };
  let tab: ForgeTab = 'helmet';
  const update = (next: Look): void => {
    look = next;
    app.setLook(look);
    renderOptions();
  };

  const canvas = h('canvas', { class: 'forge-canvas', attrs: { 'aria-label': 'Your knight' } });
  const ctx = setupCanvas(canvas, PREVIEW, PREVIEW);
  const nameInput = h('input', {
    class: 'forge-name',
    attrs: { maxlength: String(NAME_MAX_LENGTH), 'aria-label': 'Knight name', value: look.name },
    on: {
      input: () => {
        update({ ...look, name: sanitizeName(nameInput.value) });
      },
    },
  });
  const stats = h('div', { class: 'stats' });
  const tabs = h('div', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Knight parts' } });
  const panel = h('div', { class: 'forge-options panel', attrs: { role: 'tabpanel' } });
  const codeInput = h('input', {
    class: 'code-input',
    attrs: { placeholder: 'Paste a knight code (MB1-…)', 'aria-label': 'Knight code' },
  });
  const codeStatus = h('span', { class: 'code-status', attrs: { role: 'status' } });

  function renderOptions(): void {
    tabs.replaceChildren(
      ...FORGE_TABS.map((t) =>
        h('button', {
          class: 'tab',
          text: t.label,
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(t.id === tab) },
          on: {
            click: () => {
              tab = t.id;
              renderOptions();
            },
          },
        }),
      ),
    );
    panel.replaceChildren(...SLOTS.filter((s) => s.tab === tab).map(slotRow));
    stats.replaceChildren(...buildStatRows(look));
  }

  function slotRow(slot: SlotDef): HTMLElement {
    const value = look[slot.key];
    const note = hiddenNote(look, slot.key);
    const set = (i: number): void => {
      update({ ...look, [slot.key]: i });
    };
    const control = slot.swatch
      ? h(
          'div',
          { class: 'swatches' },
          ...slot.options.map((colour, i) =>
            h('button', {
              class: 'swatch',
              style: { background: colour },
              attrs: {
                type: 'button',
                'aria-label': `${slot.label} ${i + 1}`,
                'aria-pressed': String(i === value),
              },
              on: {
                click: () => {
                  set(i);
                },
              },
            }),
          ),
          note && h('em', { text: note }),
        )
      : h(
          'div',
          { class: 'cycler' },
          h('button', {
            text: '◀',
            attrs: { type: 'button', 'aria-label': `Previous ${slot.label}` },
            on: {
              click: () => {
                set((value + slot.options.length - 1) % slot.options.length);
              },
            },
          }),
          h(
            'span',
            {},
            option(slot.options, value),
            h('small', { text: ` ${value + 1}/${slot.options.length}` }),
            note && h('em', { text: note }),
          ),
          h('button', {
            text: '▶',
            attrs: { type: 'button', 'aria-label': `Next ${slot.label}` },
            on: {
              click: () => {
                set((value + 1) % slot.options.length);
              },
            },
          }),
        );
    return h('div', { class: 'slot' }, h('b', { text: slot.label }), control);
  }

  const randomiseAll = (): void => {
    update(randomLook(createRng(randomSeed()), look.name));
  };
  const randomiseTab = (): void => {
    const rng = createRng(randomSeed());
    const next = { ...look };
    for (const slot of SLOTS.filter((s) => s.tab === tab)) next[slot.key] = rng.int(slot.options.length);
    update(next);
  };
  const copyCode = (): void => {
    const code = encodeLook(look);
    codeInput.value = code;
    navigator.clipboard.writeText(code).then(
      () => (codeStatus.textContent = 'Copied!'),
      () => (codeStatus.textContent = 'Copy the code above'),
    );
  };
  const loadCode = (): void => {
    const decoded = decodeLook(codeInput.value);
    if (!decoded) {
      codeStatus.textContent = "That code doesn't look right";
      return;
    }
    nameInput.value = decoded.name;
    update(decoded);
    codeStatus.textContent = `Loaded ${decoded.name}`;
  };

  root.append(
    h(
      'section',
      { class: 'forge' },
      h(
        'header',
        { class: 'screen-head' },
        button('← Home', () => {
          app.go('home');
        }),
        h('h2', { text: 'Forge your knight' }),
      ),
      h(
        'div',
        { class: 'forge-grid' },
        h('div', { class: 'forge-preview sh' }, canvas, nameInput, stats),
        h(
          'div',
          {},
          tabs,
          panel,
          h(
            'div',
            { class: 'forge-actions' },
            button('Randomise all', randomiseAll),
            button('Randomise this tab', randomiseTab),
            button(
              'Take the field',
              () => {
                app.go('setup');
              },
              'btn-primary',
            ),
          ),
          h(
            'div',
            { class: 'share' },
            codeInput,
            button('Copy my code', copyCode),
            button('Load code', loadCode),
            codeStatus,
          ),
          h('p', {
            class: 'hint',
            text: `${SLOTS.length} slots · ${(totalCombinations() / 1e12).toFixed(1)} trillion possible knights. Only build changes how you play.`,
          }),
        ),
      ),
    ),
  );
  renderOptions();

  let gaze = { x: 0, y: 0.3 };
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height * 0.38);
    const len = Math.hypot(dx, dy) || 1;
    gaze = { x: dx / len, y: dy / len };
  });
  canvas.addEventListener('pointerleave', () => {
    gaze = { x: 0, y: 0.3 };
  });

  let frame = 0;
  const draw = (now: number): void => {
    ctx.save();
    ctx.clearRect(0, 0, PREVIEW, PREVIEW);
    const scale =
      Math.min(3.3, (PREVIEW * 0.86) / spriteHeight(look)) *
      Math.sqrt(option(BUILDS, look.build).radius / 18);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(PREVIEW / 2, PREVIEW * 0.93, PREVIEW * 0.2, PREVIEW * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(PREVIEW / 2, PREVIEW * 0.93);
    ctx.scale(scale, scale);
    drawKnight(ctx, look, app.house.colour, { ...STANDING, lookX: gaze.x, lookY: gaze.y, time: now / 1000 });
    ctx.restore();
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
  };
}
