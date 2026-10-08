import { useState } from "react";
import { Icon } from "@iconify/react";
import { useIsMobile } from "@/utils/platform";
import { useExtraKeyCombosStore } from "@/stores/extraKeyCombosStore";
import { comboButtonText, makeCombo, type ComboMods } from "@/services/extraKeyCombosCore";
import { SPECIAL_KEYS } from "@/services/terminalKeyCore";

/** Editor for the mobile terminal extra-keys combos. Mobile-only: the row these drive does not
 *  exist on desktop, so the setting would be dead weight there.
 *
 *  Add flow: type a character and/or pick a named key, tick the modifiers, save. Deliberately
 *  minimal — the common case is "Ctrl + one letter", and makeCombo is what decides whether a
 *  combination is legal, so this UI cannot accept something the row would silently ignore. */
export default function ExtraKeyCombosEditor() {
  const isMobile = useIsMobile();
  const combos = useExtraKeyCombosStore((s) => s.combos);
  const add = useExtraKeyCombosStore((s) => s.add);
  const remove = useExtraKeyCombosStore((s) => s.remove);
  const reset = useExtraKeyCombosStore((s) => s.reset);

  const [char, setChar] = useState("");
  const [key, setKey] = useState("");
  const [mods, setMods] = useState<ComboMods>({ ctrl: true, alt: false, shift: false });
  const [error, setError] = useState<string | null>(null);

  if (!isMobile) return null;

  const toggle = (m: keyof ComboMods) => setMods((s) => ({ ...s, [m]: !s[m] }));

  const save = () => {
    const raw = char.trim();
    // A named key and a character are mutually exclusive: one button, one payload.
    const made = makeCombo({
      char: raw.length === 1 ? raw : undefined,
      key: raw.length === 1 ? undefined : key || undefined,
      mods,
    });
    if (!made) {
      setError(raw.length === 1
        ? "A single character needs at least one modifier."
        : "Enter a single character, or pick a key.");
      return;
    }
    add(made);
    setChar(""); setKey(""); setError(null);
  };

  return (
    <div className="flex flex-col gap-2" data-extra-key-combos>
      <div className="text-xs text-(--t-text-dim)">
        Extra buttons on the terminal key row. Tap one to send that combination straight to the session.
      </div>

      {combos.length === 0 ? (
        <div className="text-xs text-(--t-text-dim) py-2">No custom combinations yet.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {combos.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span
                className="flex-1 min-w-0 truncate rounded-lg px-2.5 py-1.5 text-xs font-medium"
                style={{ background: "color-mix(in srgb, var(--t-accent) 18%, var(--t-bg-card))", color: "var(--t-text-primary)" }}
              >
                {comboButtonText(c)}
              </span>
              <button
                onClick={() => remove(c.id)}
                aria-label={`Remove ${comboButtonText(c)}`}
                className="shrink-0 p-1.5 rounded-lg active:bg-(--t-bg-card-hover)"
                style={{ color: "var(--t-text-muted)", minWidth: 44, minHeight: 44 }}
              >
                <Icon icon="lucide:trash-2" width={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {(["ctrl", "alt", "shift"] as const).map((m) => (
          <button
            key={m}
            onClick={() => toggle(m)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold"
            style={{
              background: mods[m] ? "var(--t-accent)" : "var(--t-bg-card)",
              color: mods[m] ? "#fff" : "var(--t-text-primary)",
              border: "1px solid var(--t-border)", minHeight: 44,
            }}
          >
            {m === "ctrl" ? "Ctrl" : m === "alt" ? "Alt" : "Shift"}
          </button>
        ))}
      </div>

      <input
        value={char}
        onChange={(e) => { setChar(e.target.value); setError(null); }}
        placeholder="c"
        aria-label="Character"
        maxLength={1}
        className="rounded-lg px-2.5 py-2 text-sm"
        style={{ background: "var(--t-bg-card)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)", minHeight: 44 }}
      />

      <select
        value={key}
        onChange={(e) => { setKey(e.target.value); setError(null); }}
        aria-label="Special key"
        className="rounded-lg px-2.5 py-2 text-sm"
        style={{ background: "var(--t-bg-card)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)", minHeight: 44 }}
      >
        <option value="">— or a special key —</option>
        {SPECIAL_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>

      {error ? <div className="text-xs" style={{ color: "var(--t-danger, #f87171)" }}>{error}</div> : null}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold"
          style={{ background: "var(--t-accent)", color: "#fff", minHeight: 44 }}
        >
          Add
        </button>
        {combos.length > 0 && (
          <button onClick={reset} className="rounded-lg px-3 py-1.5 text-xs" style={{ color: "var(--t-text-muted)", minHeight: 44 }}>
            Reset to defaults
          </button>
        )}
      </div>
    </div>
  );
}
