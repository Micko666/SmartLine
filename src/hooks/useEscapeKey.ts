import { useEffect, useRef } from 'react';

/** Open overlays, innermost last: Escape closes only the top one. */
const stack: Array<{ current: () => void }> = [];

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || stack.length === 0) return;
  e.preventDefault();
  stack[stack.length - 1].current();
}

/**
 * Closes a custom modal/sheet with the Escape key, so no overlay traps the
 * user. Radix dialogs (components/ui) already handle Escape themselves.
 */
export function useEscapeKey(onClose: () => void, active = true) {
  const handler = useRef(onClose);
  handler.current = onClose;

  useEffect(() => {
    if (!active) return;
    if (stack.length === 0) document.addEventListener('keydown', onKeyDown);
    stack.push(handler);
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown);
    };
  }, [active]);
}
