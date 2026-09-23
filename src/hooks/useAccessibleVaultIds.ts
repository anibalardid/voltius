import { useMemo } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { deriveAccessibleVaultIds, deriveOrphanVaultIds, deriveScopedVaultId } from "@/hooks/accessibleVaults";

/** See `deriveOrphanVaultIds`. */
export function useOrphanVaultIds(): string[] {
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const connections = useConnectionStore((s) => s.connections);
  const folders = useFolderStore((s) => s.folders);
  const keys = useKeyStore((s) => s.keys);
  const identities = useIdentityStore((s) => s.identities);
  const snippets = useSnippetStore((s) => s.snippets);

  return useMemo(() => deriveOrphanVaultIds({
    objectVaultIds: [
      ...connections.map((o) => o.vault_id),
      ...folders.map((o) => o.vault_id),
      ...keys.map((o) => o.vault_id),
      ...identities.map((o) => o.vault_id),
      ...snippets.map((o) => o.vault_id),
    ],
    vaults,
    teams,
  }), [connections, folders, keys, identities, snippets, vaults, teams]);
}

/**
 * Returns the subset of selectedVaultIds that are currently accessible.
 * Local-only: personal and local vaults are always accessible, and there is no
 * cloud connection whose absence would hide a vault.
 */
export function useAccessibleVaultIds(): string[] {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const orphanVaultIds = useOrphanVaultIds();

  return useMemo(() => deriveAccessibleVaultIds({
    selectedVaultIds,
    vaults,
    teams,
    cloudActive: false,
    orphanVaultIds,
  }), [selectedVaultIds, vaults, teams, orphanVaultIds]);
}

/**
 * The vault the page root currently stands for, or null when several vaults are
 * on screen. See `deriveScopedVaultId`.
 */
export function useScopedVaultId(): string | null {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const accessibleVaultIds = useAccessibleVaultIds();

  return useMemo(
    () => deriveScopedVaultId({ selectedVaultIds, vaults, accessibleVaultIds }),
    [selectedVaultIds, vaults, accessibleVaultIds],
  );
}
