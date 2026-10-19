/**
 * Открытые слои UI-кита (окна `Sheet`, пояснения `InfoButton`) в порядке открытия.
 * Escape закрывает только верхний слой: пояснение внутри окна закрывается, а окно остаётся.
 * Слушатель стоит в фазе перехвата на window и гасит событие, поэтому собственные
 * обработчики Escape у старых листов (избранные упражнения и т. п.) его не получают.
 */

type Layer = { close: () => void };

const stack: Layer[] = [];

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || stack.length === 0) return;
  event.stopPropagation();
  event.preventDefault();
  stack[stack.length - 1].close();
}

/** Регистрирует слой; возвращает функцию снятия. `close` читается при каждом Escape. */
export function pushLayer(close: () => void): { remove: () => void; isTop: () => boolean } {
  const layer: Layer = { close };
  stack.push(layer);
  if (stack.length === 1) window.addEventListener('keydown', onKeyDown, true);
  return {
    remove: () => {
      const index = stack.indexOf(layer);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) window.removeEventListener('keydown', onKeyDown, true);
    },
    isTop: () => stack[stack.length - 1] === layer,
  };
}

/**
 * Закрывает верхний открытый слой (окно, пояснение); `false` — открытых слоёв нет.
 * Аппаратная «назад» Android (`layout.native.tsx`) сначала спрашивает слои: открытое окно
 * закрывается, а страница остаётся и приложение не сворачивается.
 */
export function closeTopLayer(): boolean {
  if (stack.length === 0) return false;
  stack[stack.length - 1].close();
  return true;
}

let scrollLocks = 0;
let savedOverflow = '';

/** Пока открыто хоть одно окно, страница под ним не прокручивается. */
export function lockPageScroll(): () => void {
  const root = document.documentElement;
  if (scrollLocks === 0) {
    savedOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks === 0) root.style.overflow = savedOverflow;
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab/Shift+Tab не выходят из `container` (модальное окно). */
export function trapTab(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== 'Tab') return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
