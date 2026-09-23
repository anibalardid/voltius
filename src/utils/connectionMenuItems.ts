import type { TFunction } from "i18next";
import type { VaultOption } from "@/types";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";

export interface ConnectionMenuOptions {
  canEdit?: boolean;
  contributions: ContextMenuItem[];
  vaults?: VaultOption[];
  pingDisabled: boolean;
  connectShortcut?: string;
  duplicateShortcut?: string;
  onConnect: () => void;
  onDuplicate?: () => void;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  onTogglePing: () => void;
  onDelete?: () => void;
  /** Items inserted between Duplicate and contributions (e.g. Pin for HostCard) */
  extras?: ContextMenuItem[];
  /** Translation function, called at render time (no caching) */
  t: TFunction;
}

export function buildConnectionMenuItems({
  canEdit,
  contributions,
  vaults,
  pingDisabled,
  connectShortcut,
  duplicateShortcut,
  onConnect,
  onDuplicate,
  onMoveToVault,
  onCopyToVault,
  onTogglePing,
  onDelete,
  extras = [],
  t,
}: ConnectionMenuOptions): ContextMenuItem[] {
  return [
    { label: t("common.action.connect"), icon: "lucide:terminal", onClick: onConnect, shortcut: connectShortcut },
    ...(canEdit && onDuplicate ? [{ label: t("common.action.duplicate"), icon: "lucide:copy", onClick: onDuplicate, shortcut: duplicateShortcut }] : []),
    ...extras,
    ...contributions.map((a, i) => ({ ...a, divider: i === 0 })),
    ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault, t),
    {
      label: pingDisabled ? t("hosts.card.enableReachability") : t("hosts.card.disableReachability"),
      icon: pingDisabled ? "lucide:wifi" : "lucide:wifi-off",
      onClick: onTogglePing,
      divider: true,
    },
    ...clipboardMenuItems(t),
    ...(onDelete ? [{ label: t("common.action.delete"), icon: "lucide:trash-2", onClick: onDelete, danger: true, divider: true, shortcut: getShortcutHint("delete") }] : []),
  ];
}
