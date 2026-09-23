import { isNavigateIntent } from "@/services/deepLinkUrl";
import type { NavigateIntent, UnpromptedIntent } from "@/services/deepLinkUrl";
import { useUIStore } from "@/stores/uiStore";

/**
 * Navigate routes only move the user somewhere they could already go, so none
 * of these branches performs an action: `billing` opens the account section
 * rather than starting a checkout, and an unknown notification id opens the
 * centre on the full list.
 */
function handleNavigate(intent: NavigateIntent): void {
  const ui = useUIStore.getState();
  switch (intent.route) {
    case "notification":
      ui.openNotificationCenter(intent.entryId);
      return;
    case "settings":
      ui.openSettings(intent.section);
      return;
    case "billing":
      ui.openSettings("security");
      return;
    default: {
      const _exhaustive: never = intent;
      void _exhaustive;
    }
  }
}

/**
 * Unprompted routes act without asking. Only the navigate class still has local
 * behaviour; `verified` was a cloud-account route, so it is ignored rather than
 * acted on — the keychain/saved-account readers it needed are gone with it.
 */
export function handleUnpromptedIntent(intent: UnpromptedIntent): void {
  // Routed by trust class rather than by a second list of route names, so
  // adding a navigate route means touching `TRUST` and `handleNavigate` only.
  if (isNavigateIntent(intent)) {
    handleNavigate(intent);
  }
}
