/** While a finger is dragging the terminal, iOS still delivers ArrowUp/ArrowDown
 *  to the focused helper textarea. At a shell prompt those keys recall command
 *  history. The gate drops them for the duration of the gesture. */

let until = 0;

export function armSwipeArrowGate(now: number, ms = 600): void {
  until = Math.max(until, now + ms);
}

export function swipeArrowGateActive(now: number): boolean {
  return now < until;
}

/** Unmodified vertical arrows only. Ctrl/Alt/Shift chords and the extra-key
 *  row (which does not go through keydown) are left alone. */
export function shouldSwallowSwipeArrow(
  key: string,
  mods: { ctrl: boolean; alt: boolean; shift: boolean; meta?: boolean },
  now: number,
): boolean {
  if (!swipeArrowGateActive(now)) return false;
  if (mods.ctrl || mods.alt || mods.shift || mods.meta) return false;
  return key === "ArrowUp" || key === "ArrowDown";
}

/** xterm may also surface the same gesture as an input sequence, with no keydown. */
export function isArrowKeySequence(data: string): boolean {
  return /^(?:\x1b(?:\[|O)[AB])+$/.test(data);
}
