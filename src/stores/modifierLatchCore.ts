/** Pure latching-modifier state machine (Ctrl/Alt/Shift). off → armed (one-shot) → off;
 *  long-press → locked (sticky until tapped off). No React, node-testable. */
export type Modifier = "ctrl" | "alt" | "shift";
export type LatchValue = "off" | "armed" | "locked";
export interface LatchState { ctrl: LatchValue; alt: LatchValue; shift: LatchValue; }
/** Single source of truth for the modifier set — `consume` walks it, so adding a modifier is
 *  a one-line change here rather than a new branch in the reducer. */
export const MODIFIERS: readonly Modifier[] = ["ctrl", "alt", "shift"];
export const initialLatch: LatchState = { ctrl: "off", alt: "off", shift: "off" };
export type LatchAction = { type: "tap"; mod: Modifier } | { type: "lock"; mod: Modifier } | { type: "consume" };
export function reduceLatch(s: LatchState, a: LatchAction): LatchState {
  switch (a.type) {
    case "tap": { const cur = s[a.mod]; const next: LatchValue = cur === "off" ? "armed" : "off"; return { ...s, [a.mod]: next }; }
    case "lock": return { ...s, [a.mod]: "locked" };
    // Disarm every one-shot modifier; locked ones are sticky and must survive a consume.
    case "consume": {
      const next = { ...s };
      for (const m of MODIFIERS) if (next[m] === "armed") next[m] = "off";
      return next;
    }
  }
}
/** Is a modifier currently active (armed or locked)? */
export function isActive(v: LatchValue): boolean { return v === "armed" || v === "locked"; }
