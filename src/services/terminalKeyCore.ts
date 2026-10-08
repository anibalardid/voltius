/** Pure key → terminal byte-sequence mapping for the mobile extra-keys row.
 *  No DOM/xterm; node-testable. Arrows respect application-cursor-keys mode. */
export type SpecialKey =
  | "Esc" | "Enter" | "Tab" | "ShiftTab" | "Up" | "Down" | "Left" | "Right"
  | "Home" | "End" | "PgUp" | "PgDn"
  | "-" | "/" | "|" | "~";
export interface KeyMods { ctrl: boolean; alt: boolean; shift: boolean; appCursor: boolean; }
/** Every named key the extra-keys row can send. Single source of truth: the row renders it, the
 *  combo editor offers it as choices, and keyToBytes switches on it. Adding a key here makes it
 *  available everywhere instead of in the one place someone remembered. */
export const SPECIAL_KEYS: readonly SpecialKey[] = [
  "Esc", "Enter", "Tab", "ShiftTab", "Up", "Down", "Left", "Right",
  "Home", "End", "PgUp", "PgDn", "-", "/", "|", "~",
];

/** Control byte for a printable char: Ctrl-A=0x01 … Ctrl-Z=0x1a, plus common punct. "" if none. */
export function ctrlByte(ch: string): string {
  const c = ch.toLowerCase();
  const code = c.charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  const punct: Record<string, number> = { "[": 27, "\\": 28, "]": 29, "^": 30, "_": 31, " ": 0 };
  if (c in punct) return String.fromCharCode(punct[c]);
  return "";
}
/** Map a key to terminal bytes. Accepts a bare character as well as a named key: the `default`
 *  branch passes a single character through literally, so a user-configured combo like Ctrl-C is
 *  encoded by the same code path as the row's built-in keys rather than a parallel encoder. */
export function keyToBytes(key: SpecialKey | string, m: KeyMods): string {
  const csi = m.appCursor ? "\x1bO" : "\x1b[";
  let seq: string;
  switch (key) {
    case "Esc": seq = "\x1b"; break;
    // CR, not LF: Enter on a terminal submits the line, and the pty's line discipline turns
    // CR into the NL the tty expects. A bare \n would not submit.
    case "Enter": seq = "\r"; break;
    case "Tab": seq = "\t"; break;
    case "ShiftTab": seq = "\x1b[Z"; break; // CSI Z — back-tab (reverse field / completion menu)
    case "Up": seq = `${csi}A`; break;
    case "Down": seq = `${csi}B`; break;
    case "Right": seq = `${csi}C`; break;
    case "Left": seq = `${csi}D`; break;
    case "Home": seq = "\x1b[H"; break;
    case "End": seq = "\x1b[F"; break;
    case "PgUp": seq = "\x1b[5~"; break;
    case "PgDn": seq = "\x1b[6~"; break;
    default: seq = key; // literal - / | ~
  }
  if (m.ctrl && seq.length === 1 && !seq.startsWith("\x1b")) { const cb = ctrlByte(seq); if (cb) seq = cb; }
  // Shift applies after Ctrl so it never uppercases a control byte, and only to a bare ASCII
  // letter: shifted punctuation is layout-dependent, so guessing it would send the wrong byte
  // on a non-US keyboard. The row exposes dedicated keys for the punctuation people need.
  if (m.shift && /^[a-z]$/.test(seq)) seq = seq.toUpperCase();
  if (m.alt) seq = `\x1b${seq}`;
  return seq;
}
/** Apply a latched virtual Ctrl/Alt/Shift to a single soft-keyboard character. Returns the
 *  modified bytes, or null when no modifier is active (caller passes the char through
 *  unchanged). Used by the onData interception path so the extra-keys-row modifier latch
 *  reaches OS-keyboard letters (e.g. latch Ctrl, type "c" → ETX / Ctrl-C). */
export function applyLatchToChar(ch: string, mods: { ctrl: boolean; alt: boolean; shift: boolean }): string | null {
  if (!mods.ctrl && !mods.alt && !mods.shift) return null;
  let out = ch;
  if (mods.ctrl) { const c = ctrlByte(ch); if (c) out = c; }
  if (mods.shift && /^[a-z]$/.test(out)) out = out.toUpperCase();
  if (mods.alt) out = `\x1b${out}`;
  return out;
}
