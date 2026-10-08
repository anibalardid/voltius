import { useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { isActive, type Modifier } from "@/stores/modifierLatchCore";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { sendSpecialKey } from "@/services/terminalInput";
import { keyToBytes, SPECIAL_KEYS, type SpecialKey } from "@/services/terminalKeyCore";
import { comboButtonText, type ExtraKeyCombo } from "@/services/extraKeyCombosCore";
import { useExtraKeyCombosStore } from "@/stores/extraKeyCombosStore";
import { focusSession, getAppCursorMode, writeToSession } from "@/hooks/useTerminal";
import { useUIStore } from "@/stores/uiStore";
type KeyDef = { key: SpecialKey; label?: string; icon?: string };
/** Order and membership come from SPECIAL_KEYS; this only supplies the presentation (which keys
 *  get an icon vs text, and what that text is). */
const KEY_PRESENTATION: Partial<Record<SpecialKey, KeyDef>> = {
  Esc: { key: "Esc", label: "Esc" },
  Enter: { key: "Enter", label: "Enter" },
  Tab: { key: "Tab", label: "Tab" },
  ShiftTab: { key: "ShiftTab", label: "⇧Tab" },
  Up: { key: "Up", icon: "lucide:arrow-up" },
  Down: { key: "Down", icon: "lucide:arrow-down" },
  Left: { key: "Left", icon: "lucide:arrow-left" },
  Right: { key: "Right", icon: "lucide:arrow-right" },
  "-": { key: "-", label: "-" },
  "/": { key: "/", label: "/" },
  "|": { key: "|", label: "|" },
  "~": { key: "~", label: "~" },
  Home: { key: "Home", label: "Home" },
  End: { key: "End", label: "End" },
  PgUp: { key: "PgUp", label: "PgUp" },
  PgDn: { key: "PgDn", label: "PgDn" },
};
const KEYS: KeyDef[] = SPECIAL_KEYS.map((k) => KEY_PRESENTATION[k] ?? { key: k, label: k });
const MODS: { mod: Modifier; label: string }[] = [
  { mod: "ctrl", label: "Ctrl" }, { mod: "alt", label: "Alt" }, { mod: "shift", label: "Shift" },
];

export default function MobileExtraKeysRow({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const panelsOpen = useUIStore((s) => s.terminalPanelsRowOpen);
  const togglePanels = useUIStore((s) => s.toggleTerminalPanelsRow);
  const ctrl = useModifierLatchStore((s) => s.ctrl);
  const alt = useModifierLatchStore((s) => s.alt);
  const shift = useModifierLatchStore((s) => s.shift);
  const tap = useModifierLatchStore((s) => s.tap);
  const lock = useModifierLatchStore((s) => s.lock);
  const consume = useModifierLatchStore((s) => s.consume);
  const combos = useExtraKeyCombosStore((s) => s.combos);
  const latch: Record<Modifier, typeof ctrl> = { ctrl, alt, shift };
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tap-vs-scroll tracking for KEYS: record the touch origin, only fire on touchend
  // if the finger barely moved (a real tap, not a horizontal scroll-drag of the row).
  const keyTouchStart = useRef<{ x: number; y: number } | null>(null);
  const TAP_MOVE_PX = 10;

  const press = (key: SpecialKey) => {
    if (!activeSessionId) return;
    sendSpecialKey(activeSessionId, key, {
      ctrl: isActive(latch.ctrl), alt: isActive(latch.alt), shift: isActive(latch.shift),
    });
    consume();
  };

  /** Fire a configured combo. `keyToBytes` takes the payload directly — a bare character goes
   *  through its literal branch — so combos and built-in keys share one encoder. */
  const pressCombo = (combo: ExtraKeyCombo) => {
    if (!activeSessionId) return;
    const key = combo.payload.kind === "char" ? combo.payload.char : combo.payload.key;
    writeToSession(activeSessionId, keyToBytes(key, {
      ctrl: combo.mods.ctrl, alt: combo.mods.alt, shift: combo.mods.shift,
      appCursor: getAppCursorMode(activeSessionId),
    }));
    // A combo carries its own modifiers, so it must not also inherit the latched ones —
    // otherwise arming Ctrl and then tapping Ctrl-C would send Ctrl+Ctrl-C.
    consume();
  };
  const tapMod = (mod: Modifier) => tap(mod);
  const lockMod = (mod: Modifier) => lock(mod);
  const noFocusSteal = (e: React.SyntheticEvent) => e.preventDefault();
  // The row must never summon the soft keyboard. The xterm textarea is programmatically focused
  // (Android keeps the IME hidden), so the first touch gesture would otherwise pop the IME for it.
  // When the keyboard is closed, blur the focused element on touch so the tap can't trigger it.
  // Keyboard open: leave focus alone so it stays open for continued typing.
  const keepKeyboardClosed = () => { if (!keyboardOpen) (document.activeElement as HTMLElement | null)?.blur(); };

  /** Focus (or unfocus) xterm's helper textarea to raise/dismiss the soft keyboard. Must run from
   *  a real gesture — see the button's comment. `term.focus()` focuses the textarea xterm already
   *  uses, so typed text flows through the normal onData path. */
  const toggleSoftKeyboard = () => {
    if (!activeSessionId) return;
    const el = document.activeElement as HTMLElement | null;
    if (keyboardOpen) { el?.blur(); return; }
    focusSession(activeSessionId);
  };

  return (
    <div data-mobile-extra-keys className="shrink-0 flex items-center gap-1 overflow-x-auto px-1.5 py-1.5 border-t"
      style={{
        background: "var(--t-bg-chrome)", borderColor: "var(--t-border)",
        // Keyboard closed: the shell spans edge-to-edge, so inset the row above the Android
        // system nav bar. Keyboard open: stay flush above the keyboard (no inset; the nav bar
        // is behind the keyboard).
        paddingBottom: keyboardOpen ? undefined : "var(--sa-b)",
      }}
      onMouseDown={noFocusSteal} onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}>
      {/*
        Soft-keyboard toggle. iOS only presents the keyboard when focus() is called from inside a
        real user gesture — a tap synthesized by the gesture layer is not one, so tapping the
        terminal itself does not reliably summon it. This button is a genuine tap, so focusing
        xterm's textarea from here does. Stops propagation so the row's own keepKeyboardClosed()
        does not blur the element on touchstart and undo it.
      */}
      <button
        data-mobile-key="keyboard"
        aria-label={keyboardOpen ? t("mobile.extraKeys.hideKeyboard") : t("mobile.extraKeys.showKeyboard")}
        onMouseDown={(e) => { e.stopPropagation(); noFocusSteal(e); }}
        onTouchStart={(e) => { e.stopPropagation(); noFocusSteal(e); }}
        // iOS only presents the software keyboard when focus happens during the
        // native touch gesture. The synthesized click is too late and only
        // leaves the input accessory bar visible.
        onTouchEnd={(e) => { e.stopPropagation(); noFocusSteal(e); toggleSoftKeyboard(); }}
        onClick={(e) => { e.stopPropagation(); noFocusSteal(e); if (!("ontouchstart" in window)) toggleSoftKeyboard(); }}
        className="shrink-0 min-w-11 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center"
        style={{
          background: keyboardOpen ? "var(--t-accent)" : "var(--t-bg-card)",
          color: keyboardOpen ? "#fff" : "var(--t-text-primary)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon={keyboardOpen ? "lucide:keyboard-off" : "lucide:keyboard"} width={16} />
      </button>
      {MODS.map(({ mod, label }) => {
        const v = latch[mod];
        return (
          <button key={mod} data-mobile-key={mod}
            onMouseDown={(e) => { noFocusSteal(e); }}
            onTouchStart={(e) => {
              noFocusSteal(e);
              if (longPressTimer.current) clearTimeout(longPressTimer.current);
              // On fire, null the ref so touchend treats this as a completed lock (not a tap).
              longPressTimer.current = setTimeout(() => { longPressTimer.current = null; lockMod(mod); }, 450);
            }}
            onTouchEnd={(e) => {
              noFocusSteal(e);
              // Timer still pending = short tap → arm/toggle. If the lock already fired it
              // nulled the ref, so we skip tapMod and keep the lock.
              if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; tapMod(mod); }
            }}
            // Row is horizontally scrollable: a scroll cancels the touch with no touchend,
            // so clear the pending lock timer to avoid a stray lock firing mid-scroll.
            onTouchCancel={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
            onClick={(e) => { noFocusSteal(e); if (!("ontouchstart" in window)) tapMod(mod); }}
            className="shrink-0 min-w-11 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: v === "locked" ? "var(--t-accent)" : v === "armed" ? "color-mix(in srgb, var(--t-accent) 35%, var(--t-bg-card))" : "var(--t-bg-card)",
              color: isActive(v) ? "#fff" : "var(--t-text-primary)", border: "1px solid var(--t-border)",
            }}>
            {label}
          </button>
        );
      })}
      {KEYS.map(({ key, label, icon }) => (
        <button key={key} data-mobile-key={key}
          // Touch path: fire once on touchend (a tap), never on touchstart — so the row
          // can be scrolled by dragging a button without firing its key, and the ghost
          // mousedown/click is suppressed on touch (mirrors the MODS' onClick guard).
          onMouseDown={noFocusSteal}
          onTouchStart={(e) => {
            noFocusSteal(e);
            const t = e.touches[0];
            keyTouchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            noFocusSteal(e);
            const start = keyTouchStart.current;
            keyTouchStart.current = null;
            const t = e.changedTouches[0];
            if (!start || !t) return;
            if (Math.hypot(t.clientX - start.x, t.clientY - start.y) < TAP_MOVE_PX) press(key);
          }}
          onTouchCancel={() => { keyTouchStart.current = null; }}
          onClick={(e) => { noFocusSteal(e); if (!("ontouchstart" in window)) press(key); }}
          className="shrink-0 min-w-11 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center"
          style={{ background: "var(--t-bg-card)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)" }}>
          {icon ? <Icon icon={icon} width={16} /> : label}
        </button>
      ))}
      {combos.map((combo) => (
        <button key={combo.id} data-mobile-combo={combo.id}
          onMouseDown={noFocusSteal}
          onTouchStart={(e) => {
            noFocusSteal(e);
            const t = e.touches[0];
            keyTouchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            noFocusSteal(e);
            const start = keyTouchStart.current;
            keyTouchStart.current = null;
            const t = e.changedTouches[0];
            if (!start || !t) return;
            if (Math.hypot(t.clientX - start.x, t.clientY - start.y) < TAP_MOVE_PX) pressCombo(combo);
          }}
          onTouchCancel={() => { keyTouchStart.current = null; }}
          onClick={(e) => { noFocusSteal(e); if (!("ontouchstart" in window)) pressCombo(combo); }}
          className="shrink-0 min-w-11 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center"
          style={{
            background: "color-mix(in srgb, var(--t-accent) 18%, var(--t-bg-card))",
            color: "var(--t-text-primary)", border: "1px solid var(--t-border)",
          }}>
          {comboButtonText(combo)}
        </button>
      ))}
      <button data-mobile-panels-toggle
        onMouseDown={noFocusSteal}
        onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}
        onClick={(e) => { noFocusSteal(e); togglePanels(); }}
        className="shrink-0 min-w-11 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center"
        style={{ background: panelsOpen ? "var(--t-accent)" : "var(--t-bg-card)", color: panelsOpen ? "#fff" : "var(--t-text-primary)", border: "1px solid var(--t-border)" }}>
        <Icon icon="lucide:layout-grid" width={16} />
      </button>
    </div>
  );
}
