/** A press has to travel this far before it becomes a drag, so taps stay taps. */
const DRAG_THRESHOLD_PX = 8;
/** On touch, holding an item this long lifts it, so a drag can go any way without scrolling the page. */
const LONG_PRESS_MS = 350;
/** Within this distance of the top or bottom of the screen, a dragged item scrolls the page. */
const DRAG_EDGE_PX = 56;
const DRAG_SCROLL_PX = 12;

export interface DragSwap {
  /** An item was lifted. */
  lift(item: HTMLElement): void;
  /** It was dropped on another item. */
  drop(from: HTMLElement, to: HTMLElement): void;
  /** It was let go anywhere else, or Escape was pressed. */
  cancel(from: HTMLElement): void;
}

interface Drag {
  readonly pointerId: number;
  readonly card: HTMLElement;
  readonly x: number;
  readonly y: number;
  readonly scrollY: number;
  lifted: boolean;
  target: HTMLElement | null;
  clientX: number;
  clientY: number;
  timer: number;
}

/**
 * Drag one of the `items` inside `sheet` onto another to swap them. Pointer events rather than HTML
 * drag-and-drop, which phones never fire. A press only becomes a drag once it moves, or on touch once
 * it is held, so taps still work and a vertical swipe still scrolls. Returns a cleanup.
 */
export function dragToSwap(sheet: HTMLElement, items: string, on: DragSwap): () => void {
  let drag: Drag | null = null;
  let swallowClick = false;
  let frame = 0;

  const cards = (): HTMLElement[] => [...sheet.querySelectorAll<HTMLElement>(items)];
  const cardAt = (x: number, y: number, except: HTMLElement): HTMLElement | null =>
    cards().find((card) => {
      if (card === except) return false;
      const r = card.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) ?? null;

  /** Follows the pointer, counting any scroll since the lift, and marks the card it is over. */
  const follow = (d: Drag): void => {
    const dx = d.clientX - d.x;
    const dy = d.clientY - d.y + (window.scrollY - d.scrollY);
    // Shrunk while held, so the card it would swap with still shows round its edges.
    d.card.style.transform = `translate(${dx}px, ${dy}px) scale(0.8)`;
    const target = cardAt(d.clientX, d.clientY, d.card);
    if (target === d.target) return;
    d.target?.classList.remove('is-drop-target');
    target?.classList.add('is-drop-target');
    d.target = target;
  };

  /** Near the top or bottom of the screen, scrolls toward it while the card is held there. */
  const edgeScroll = (): void => {
    const d = drag;
    if (!d?.lifted) return;
    const y = d.clientY;
    const step =
      y < DRAG_EDGE_PX ? -DRAG_SCROLL_PX : y > window.innerHeight - DRAG_EDGE_PX ? DRAG_SCROLL_PX : 0;
    if (step) {
      window.scrollBy(0, step);
      follow(d);
    }
    frame = requestAnimationFrame(edgeScroll);
  };

  const lift = (d: Drag): void => {
    window.clearTimeout(d.timer);
    d.lifted = true;
    d.card.classList.add('is-lifted');
    sheet.classList.add('is-dragging');
    on.lift(d.card);
    follow(d);
    frame = requestAnimationFrame(edgeScroll);
  };

  const end = (dropped: boolean): void => {
    const d = drag;
    if (!d) return;
    drag = null;
    window.clearTimeout(d.timer);
    cancelAnimationFrame(frame);
    if (d.card.hasPointerCapture(d.pointerId)) d.card.releasePointerCapture(d.pointerId);
    if (!d.lifted) return;
    d.target?.classList.remove('is-drop-target');
    d.card.classList.remove('is-lifted');
    sheet.classList.remove('is-dragging');
    d.card.style.transform = '';
    // A long press let go where it started was a slow tap: its click goes through.
    const still = Math.hypot(d.clientX - d.x, d.clientY - d.y) <= DRAG_THRESHOLD_PX;
    if (dropped && still) return;
    // Otherwise the click that follows the release must not count as a tap.
    swallowClick = true;
    window.setTimeout(() => (swallowClick = false), 0);
    if (dropped && d.target) on.drop(d.card, d.target);
    else on.cancel(d.card);
  };

  const down = (e: PointerEvent): void => {
    const card = (e.target as Element).closest<HTMLElement>(items);
    if (drag || !card || !sheet.contains(card) || card.matches(':disabled') || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const d: Drag = {
      pointerId: e.pointerId,
      card,
      x: e.clientX,
      y: e.clientY,
      scrollY: window.scrollY,
      lifted: false,
      target: null,
      clientX: e.clientX,
      clientY: e.clientY,
      timer: 0,
    };
    if (e.pointerType === 'touch')
      d.timer = window.setTimeout(() => {
        lift(d);
      }, LONG_PRESS_MS);
    card.setPointerCapture(e.pointerId);
    drag = d;
  };

  const move = (e: PointerEvent): void => {
    const d = drag;
    if (d?.pointerId !== e.pointerId) return;
    d.clientX = e.clientX;
    d.clientY = e.clientY;
    if (d.lifted) follow(d);
    else if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD_PX) lift(d);
  };

  const up = (e: PointerEvent): void => {
    if (drag?.pointerId === e.pointerId) end(true);
  };
  const lost = (e: PointerEvent): void => {
    if (drag?.pointerId === e.pointerId) end(false);
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !drag?.lifted) return;
    e.preventDefault();
    end(false);
  };
  // Once a card is lifted on touch, the finger moves it rather than the page.
  const touchMove = (e: TouchEvent): void => {
    if (drag?.lifted && e.cancelable) e.preventDefault();
  };
  const menu = (e: Event): void => {
    if (drag) e.preventDefault();
  };
  const click = (e: MouseEvent): void => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  sheet.addEventListener('pointerdown', down);
  sheet.addEventListener('pointermove', move);
  sheet.addEventListener('pointerup', up);
  sheet.addEventListener('pointercancel', lost);
  sheet.addEventListener('lostpointercapture', lost);
  sheet.addEventListener('touchmove', touchMove, { passive: false });
  sheet.addEventListener('contextmenu', menu);
  sheet.addEventListener('click', click, true);
  document.addEventListener('keydown', key);
  return () => {
    end(false);
    document.removeEventListener('keydown', key);
  };
}
