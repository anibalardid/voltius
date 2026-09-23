import type { AuditContext } from "@/services/auditContext";

/** Local-only: every vault id resolves to the on-device sink. */
export function auditContextForVaultId(vaultId?: string | null): AuditContext {
  return { kind: "local", vaultId: vaultId || "personal" };
}
