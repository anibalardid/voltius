/** Pure model for user-configurable combo keys in the mobile terminal extra-keys row.
 *
 *  A combo is a fixed modifier chord plus one payload: either a single printable
 *  character (Ctrl-C) or one of the row's special keys (Ctrl-…Up). Kept free of
 *  React/zustand/DOM so the label formatting and byte mapping are node-testable and
 *  the editor UI only has to deal with the shape. */

/** Modifiers a combo can carry. `shift` is included so Shift+Tab style chords are
 *  expressible, not just the ctrl/alt pairs. */
export interface ComboMods { ctrl: boolean; alt: boolean; shift: boolean; }

/** The payload: a single character, or a special key from the extra-keys row. */
export type ComboPayload = { kind: "char"; char: string } | { kind: "key"; key: string };

export interface ExtraKeyCombo {
  id: string;
  /** User-visible button text. Defaults to a derived form when left empty. */
  label: string;
  mods: ComboMods;
  payload: ComboPayload;
}

export const noMods: ComboMods = { ctrl: false, alt: false, shift: false };

/** Modifier chips, in the conventional order, for both the label and the editor UI. */
const MOD_CHIPS: Array<[keyof ComboMods, string]> = [
  ["ctrl", "Ctrl"],
  ["alt", "Alt"],
  ["shift", "Shift"],
];

/** "Ctrl+Shift+C" — chips joined with "+", skipping modifiers that are not held. A combo with
 *  no modifiers would render as a bare char, so it gets no leading separator. */
export function comboLabel(c: ExtraKeyCombo): string {
  const held = MOD_CHIPS.filter(([m]) => c.mods[m]).map(([, label]) => label);
  const body = c.payload.kind === "char" ? c.payload.char : c.payload.key;
  return [...held, body].join("+");
}

/** Button text: the combo's own label when set, otherwise derived. Kept separate from
 *  comboLabel so an empty label is a meaningful "use the default" rather than a blank. */
export function comboButtonText(c: ExtraKeyCombo): string {
  const custom = c.label.trim();
  return custom || comboLabel(c);
}

/** The combos a fresh install starts with. Ctrl-C interrupts and Ctrl-D logs out, which are the
 *  two a phone user reaches for constantly; Ctrl-P is the common shell history prefix. */
export function defaultCombos(): ExtraKeyCombo[] {
  return [
    { id: "combo-ctrl-c", label: "", mods: { ctrl: true, alt: false, shift: false }, payload: { kind: "char", char: "c" } },
    { id: "combo-ctrl-d", label: "", mods: { ctrl: true, alt: false, shift: false }, payload: { kind: "char", char: "d" } },
    { id: "combo-ctrl-p", label: "", mods: { ctrl: true, alt: false, shift: false }, payload: { kind: "char", char: "p" } },
  ];
}

/** Normalise user input into a combo, or null when it cannot be a combo.
 *
 *  Rejects a bare *character* with no modifiers — that is just typing, which the OS keyboard
 *  already does, and a button that appears to do nothing is worse than no button. A bare
 *  *named key* is deliberately allowed: Up, Esc and Home are not on the software keyboard at
 *  all. Also rejects an empty payload. Returns a fresh id so callers need not generate one. */
export function makeCombo(input: {
  char?: string;
  key?: string;
  mods: Partial<ComboMods>;
  label?: string;
  id?: string;
}): ExtraKeyCombo | null {
  const mods: ComboMods = {
    ctrl: !!input.mods.ctrl,
    alt: !!input.mods.alt,
    shift: !!input.mods.shift,
  };
  const payload: ComboPayload | null = input.char
    ? { kind: "char", char: input.char }
    : input.key
      ? { kind: "key", key: input.key }
      : null;
  if (!payload) return null;
  if (payload.kind === "char" && !mods.ctrl && !mods.alt && !mods.shift) return null;
  if (payload.kind === "char" && payload.char.length !== 1) return null;
  return {
    id: input.id ?? `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: input.label?.trim() ?? "",
    mods,
    payload,
  };
}
