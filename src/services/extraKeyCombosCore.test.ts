import { comboLabel, comboButtonText, makeCombo, defaultCombos } from "./extraKeyCombosCore.ts";
import { keyToBytes } from "./terminalKeyCore.ts";
import { test } from "vitest";

test("extraKeyCombos", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); throw new Error(msg); }
}

// The defaults are the chords a phone user reaches for most, and they must encode to the bytes
// a real shell expects — not merely render a plausible label.
const d = defaultCombos();
assertEqual(d.length, 3, "three default combos");
assertEqual(keyToBytes("c", { ctrl: true, alt: false, shift: false, appCursor: false }), "\x03", "Ctrl-C encodes to ETX");
assertEqual(keyToBytes("d", { ctrl: true, alt: false, shift: false, appCursor: false }), "\x04", "Ctrl-D encodes to EOT");
assertEqual(keyToBytes("p", { ctrl: true, alt: false, shift: false, appCursor: false }), "\x10", "Ctrl-P encodes to DLE");

assertEqual(
  comboLabel({ id: "a", label: "", mods: { ctrl: true, alt: false, shift: false }, payload: { kind: "char", char: "c" } }),
  "Ctrl+c", "label joins chips and payload");
assertEqual(
  comboLabel({ id: "a", label: "", mods: { ctrl: true, alt: true, shift: true }, payload: { kind: "key", key: "Up" } }),
  "Ctrl+Alt+Shift+Up", "all three chips in conventional order");
assertEqual(
  comboButtonText({ id: "a", label: "   ", mods: { ctrl: true, alt: false, shift: false }, payload: { kind: "char", char: "c" } }),
  "Ctrl+c", "blank label falls back to the derived one");
assertEqual(
  comboButtonText({ id: "a", label: "INT", mods: { ctrl: true, alt: false, shift: false }, payload: { kind: "char", char: "c" } }),
  "INT", "custom label wins");

// A bare *character* with no modifiers is just typing, which the OS keyboard already does —
// accepting one would fill the row with buttons that look actionable and do nothing. A bare
// *named key* is different: Up/Esc are not reachable from the software keyboard at all.
assertEqual(makeCombo({ char: "x", mods: {} }), null, "bare char with no modifiers is rejected");
assertEqual(makeCombo({ mods: { ctrl: true } }), null, "no payload is rejected");
const plainKey = makeCombo({ key: "Up", mods: {} });
assertEqual(plainKey !== null, true, "named key with no modifiers is allowed");
assertEqual(plainKey && plainKey.payload.kind, "key", "…and keeps its key payload");

const ok = makeCombo({ char: "k", mods: { ctrl: true } });
assertEqual(ok !== null, true, "ctrl+char is accepted");
assertEqual(ok && ok.payload.kind, "char", "payload kind is char");
assertEqual(ok && ok.mods.shift, false, "unspecified mods default to false");
assertEqual(!!ok && !!ok.id, true, "an id is generated when none is given");

// Shift must uppercase a letter without ever touching a control byte or an escape sequence.
assertEqual(keyToBytes("a", { ctrl: false, alt: false, shift: true, appCursor: false }), "A", "Shift+a → A");
assertEqual(keyToBytes("c", { ctrl: true, alt: false, shift: true, appCursor: false }), "\x03", "Ctrl+Shift+c stays ETX, not 0x43");
assertEqual(keyToBytes("-", { ctrl: false, alt: false, shift: true, appCursor: false }), "-", "shifted punctuation left alone (layout-dependent)");
});
