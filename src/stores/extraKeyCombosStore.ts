import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import {
  defaultCombos,
  makeCombo,
  type ComboMods,
  type ComboPayload,
  type ExtraKeyCombo,
} from "@/services/extraKeyCombosCore";

/** User-configurable combo buttons on the mobile terminal extra-keys row (Ctrl-C, Ctrl-D, …).
 *  Persisted per install; the defaults are the three chords a phone user reaches for most. */
interface ExtraKeyCombosStore {
  combos: ExtraKeyCombo[];
  add: (input: { char?: string; key?: string; mods: Partial<ComboMods>; label?: string }) => boolean;
  remove: (id: string) => void;
  update: (id: string, patch: { label?: string; mods?: ComboMods; payload?: ComboPayload }) => void;
  reset: () => void;
}

/** Persistence is hand-rolled JSON, so a combo written by an older/newer build (or hand-edited)
 *  must never crash the row. Anything unrecognised is dropped rather than passed through. */
function sanitize(raw: unknown): ExtraKeyCombo[] {
  if (!Array.isArray(raw)) return defaultCombos();
  const out: ExtraKeyCombo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Partial<ExtraKeyCombo>;
    const mods = c.mods ?? { ctrl: false, alt: false, shift: false };
    const payload = c.payload;
    if (!payload || (payload.kind !== "char" && payload.kind !== "key")) continue;
    const value = payload.kind === "char" ? payload.char : payload.key;
    if (typeof value !== "string" || !value) continue;
    if (typeof c.id !== "string" || !c.id) continue;
    out.push({
      id: c.id,
      label: typeof c.label === "string" ? c.label : "",
      mods: { ctrl: !!mods.ctrl, alt: !!mods.alt, shift: !!mods.shift },
      payload: payload.kind === "char" ? { kind: "char", char: value } : { kind: "key", key: value },
    });
  }
  return out;
}

const touch = () => useAppSettingsTimestampStore.getState().touch();

export const useExtraKeyCombosStore = create<ExtraKeyCombosStore>()(
  persist(
    (set) => ({
      combos: defaultCombos(),
      add: (input) => {
        // makeCombo lives in the pure core so the "is this a legal combo" rule is testable
        // and the editor UI and this store cannot drift apart.
        const combo = makeCombo(input);
        if (!combo) return false;
        set((s) => ({ combos: [...s.combos, combo] }));
        touch();
        return true;
      },
      remove: (id) => {
        set((s) => ({ combos: s.combos.filter((c) => c.id !== id) }));
        touch();
      },
      update: (id, patch) => {
        set((s) => ({
          combos: s.combos.map((c) =>
            c.id === id
              ? {
                  ...c,
                  label: patch.label ?? c.label,
                  mods: patch.mods ?? c.mods,
                  payload: patch.payload ?? c.payload,
                }
              : c,
          ),
        }));
        touch();
      },
      reset: () => {
        set({ combos: defaultCombos() });
        touch();
      },
    }),
    { name: "voltius-extra-key-combos", merge: (persisted, current) => ({ ...current, combos: sanitize((persisted as Partial<ExtraKeyCombosStore> | undefined)?.combos) }) },
  ),
);
