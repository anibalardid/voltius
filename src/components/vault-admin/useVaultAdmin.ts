import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useContextMenu } from "@/components/shared/ContextMenu";
import { vaultAdminCapabilities, type VaultAdminTarget } from "./vaultAdminTarget";
import { vaultMenuItems } from "./vaultMenuItems";
import type { VaultDialog } from "./VaultAdminDialogs";

export function useVaultAdmin(target: VaultAdminTarget | null) {
  const { t } = useTranslation();
  const { pos, open: openAtPointer, openAt, close: closeMenu } = useContextMenu();
  const [dialog, setDialog] = useState<VaultDialog>(null);

  const caps = target
    ? vaultAdminCapabilities(target)
    : { canRename: false, canDelete: false };

  const items = target
    ? vaultMenuItems({
        caps, t,
        on: (action) => {
          switch (action) {
            case "rename":
            case "delete": setDialog(action); return;
          }
        },
      })
    : [];

  const openAtElement = (el: HTMLElement) => openAt(el.getBoundingClientRect());

  return { items, pos, openAtElement, openAtPointer, closeMenu, dialog, setDialog };
}
