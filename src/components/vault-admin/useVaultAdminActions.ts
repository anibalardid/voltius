import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { userFacingReason } from "@/services/errorReason";
import { deleteVaultWithContents } from "@/services/vaultObjectStores";
import type { VaultAdminTarget } from "./vaultAdminTarget";

export interface VaultAdminCallbacks {
  onRenamed?: (name: string) => void;
  /** Fired after a successful delete, for hosts that must close. */
  onDone?: () => void;
}

async function vaultToast(message: string, severity: "info" | "error") {
  const { useNotificationStore } = await import("@/stores/notificationStore");
  useNotificationStore.getState().addToast({
    source: { kind: "plugin", id: "system", name: "Voltius" }, type: "toast",
    message, severity, duration: severity === "error" ? 6000 : 3000,
  });
}

export function useVaultAdminActions(target: VaultAdminTarget, cb?: VaultAdminCallbacks) {
  const { t } = useTranslation();
  const renameVault = useVaultStore((s) => s.renameVault);
  const [busy, setBusy] = useState(false);
  // Modal.tsx's Enter handler stopPropagation()s but never preventDefault()s, so
  // pressing Enter on a focused Confirm button fires both the keydown handler
  // and the button's native click in the same tick — before React re-renders
  // `busy`. A ref closes that hole; state alone cannot.
  const inFlight = useRef(false);

  /** Every failure here reports the same way: the reason, never the raw error. */
  const failToast = (key: string, e: unknown) =>
    vaultToast(t(key, { reason: userFacingReason(e) }), "error");

  const exclusive = async (run: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const rename = (nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === target.name) return;
    renameVault(target.vaultId, trimmed);
    cb?.onRenamed?.(trimmed);
  };

  /**
   * Deletes the vault *and* its contents, which is what the confirm dialog has
   * always promised. A failed sweep leaves the record in place on purpose:
   * whatever survived stays filed under a named vault instead of becoming an orphan.
   */
  const remove = () => exclusive(async () => {
    try {
      await deleteVaultWithContents(target.vaultId);
    } catch (e) {
      console.error("Failed to delete vault:", e);
      await failToast("settings.vaults.general.deleteVault.failedToast", e);
      return;
    }
    cb?.onDone?.();
  });

  return { busy, rename, remove };
}
