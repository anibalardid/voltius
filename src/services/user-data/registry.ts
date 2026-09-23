import type { UserDataHandler } from "./handler";
import type { UserDataBundle, UserDataSection } from "./formats";
import { themesHandler } from "./handlers/themes";
import { uiPreferencesHandler } from "./handlers/uiPreferences";
import { shortcutsHandler } from "./handlers/shortcuts";
import { appSettingsHandler } from "./handlers/appSettings";
import { recentPeopleHandler } from "./handlers/recentPeople";
import { vaultsHandler } from "./handlers/vaults";

// ─── Handler registry ─────────────────────────────────────────────────────────
// Order matters for UI rendering. Adding a new settings domain:
//   1. Create handlers/<name>.ts implementing UserDataHandler
//   2. Add it here
//   3. Add an entry to SYNC_SETTING_DOMAINS in stores/syncPrefsStore.ts, or the
//      new domain silently becomes permanently-synced (isDomainSynced defaults
//      an unknown key to true) — the drift test in syncPrefsStore.test.ts
//      fails until you do
//   4. Add the four settings.sync.settingDomain.<id>.{label,sub} locale strings

export const USER_DATA_HANDLERS: UserDataHandler[] = [
  themesHandler,
  uiPreferencesHandler,
  shortcutsHandler,
  appSettingsHandler,
  recentPeopleHandler,
  vaultsHandler,
];

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Unfiltered by design: the manual export UI produces a backup the user asked
 * for by name, and that backup must be complete regardless of sync domain
 * toggles. Only the sync path wraps this in `filterOutgoing`. A future sync
 * route reaching for a "build the bundle" function should filter its own
 * output rather than change this one.
 */
export function buildUserDataBundle(keys?: string[]): UserDataBundle {
  const handlers = keys
    ? USER_DATA_HANDLERS.filter((h) => keys.includes(h.key))
    : USER_DATA_HANDLERS;

  const sections: Record<string, UserDataSection> = {};
  for (const h of handlers) {
    sections[h.key] = { data: h.export(), updated_at: h.getTimestamp() };
  }

  return {
    type: "voltius-user-data",
    version: 2,
    exported_at: new Date().toISOString(),
    sections,
  };
}

// ─── Apply ────────────────────────────────────────────────────────────────────

export async function applyUserDataBundle(
  bundle: UserDataBundle,
  keys?: string[],
): Promise<{ applied: string[] }> {
  const applied: string[] = [];
  for (const h of USER_DATA_HANDLERS) {
    if (keys && !keys.includes(h.key)) continue;
    const section = bundle.sections[h.key];
    if (!section) continue;
    await h.import(section.data);
    applied.push(h.key);
  }
  return { applied };
}
