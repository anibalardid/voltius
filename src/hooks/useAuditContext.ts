import { useVaultStore } from "@/stores/vaultStore";
import type { AuditContext } from "@/services/auditContext";

export function useSelectedAuditContext(): AuditContext | null {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);

  if (selectedVaultIds.length !== 1) return null;
  const vid = selectedVaultIds[0];

  const vault = vaults.find((v) => v.id === vid);
  if (!vault) return null;

  return { kind: "local", vaultId: vault.id };
}
