import type { TFunction } from "i18next";
import type { VaultOption } from "@/types";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";

export interface KeychainMenuOptions {
  t: TFunction;
  contributions: ContextMenuItem[];
  vaults?: VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  onDelete?: () => void;
  /** Rows the key form puts before the contributions (its "Add to host" action). */
  leading?: ContextMenuItem[];
}

/** The panel actions both keychain forms show: contributions, vault moves, delete. */
export function buildKeychainMenuItems({
  t,
  contributions,
  vaults,
  canEdit,
  onMoveToVault,
  onCopyToVault,
  onDelete,
  leading = [],
}: KeychainMenuOptions): ContextMenuItem[] {
  return [
    ...leading,
    ...contributions.map((a, i) => ({ ...a, icon: a.icon ?? "lucide:chevron-right", divider: i === 0 && leading.length > 0 })),
    ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault, t),
    ...(onDelete
      ? [{ label: t("common.action.delete"), icon: "lucide:trash-2", onClick: onDelete, danger: true, divider: false, shortcut: getShortcutHint("delete") }]
      : []),
  ];
}
