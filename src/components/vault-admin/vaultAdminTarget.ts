/** What a vault-admin surface acts on. Mirrors `VaultDetail` in VaultsSection. */
export interface VaultAdminTarget {
  vaultId: string;
  name: string;
}

export interface VaultAdminCapabilities {
  canRename: boolean;
  canDelete: boolean;
}

/**
 * Conditions carried over from the former VaultGeneralTab: "personal" is the
 * built-in vault that must always exist, so it can be renamed but never deleted.
 */
export function vaultAdminCapabilities(target: VaultAdminTarget): VaultAdminCapabilities {
  return {
    canRename: true,
    canDelete: target.vaultId !== "personal",
  };
}
