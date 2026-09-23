import { useMemo } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useScopedVaultId } from "@/hooks/useAccessibleVaultIds";

/**
 * Maps a local vault UUID to the stored team ID at save time, so vault_id is
 * portable across accounts.  "personal" is left as-is.
 */
export function resolveVaultIdForSave(vaultId: string): string {
  if (vaultId === "personal") return "personal";
  const vaults = useVaultStore.getState().vaults;
  const vault = vaults.find((v) => v.id === vaultId);
  return vault?.teamId ?? vaultId;
}

/**
 * The vault a new object is filed into: the vault the view is currently scoped
 * to. With several vaults on screen there is no single destination to name, so
 * it falls back to "personal".
 */
export function useDefaultVaultId(): string {
  const scopedVaultId = useScopedVaultId();
  return useMemo(() => scopedVaultId ?? "personal", [scopedVaultId]);
}
