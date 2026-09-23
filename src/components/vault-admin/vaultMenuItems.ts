import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { VaultAdminCapabilities } from "./vaultAdminTarget";

export type VaultMenuAction = "rename" | "delete";

/**
 * Built from what the vault is, never from disabled rows.
 */
export function vaultMenuItems({
  caps, t, on,
}: {
  caps: VaultAdminCapabilities;
  t: (key: string) => string;
  on: (action: VaultMenuAction) => void;
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (caps.canRename) {
    items.push({
      label: t("layout.vaultMenu.rename"),
      icon: "lucide:pencil",
      onClick: () => on("rename"),
    });
  }

  if (caps.canDelete) {
    items.push({
      label: t("layout.vaultMenu.delete"),
      icon: "lucide:trash-2",
      danger: true,
      divider: true,
      onClick: () => on("delete"),
    });
  }

  return items;
}
