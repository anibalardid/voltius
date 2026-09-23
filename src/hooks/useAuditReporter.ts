import { useCallback } from "react";
import { reportAuditClientEvent, type ClientAuditAction } from "@/services/auditReporter";
import type { AuditContext, AuditTarget } from "@/services/auditContext";

export function useAuditReporter(context: AuditContext | null) {
  const vaultId = context?.vaultId ?? null;

  return useCallback(
    (action: ClientAuditAction, opts: AuditTarget = {}) => {
      if (!vaultId) return;
      reportAuditClientEvent({ kind: "local", vaultId }, action, opts);
    },
    [vaultId],
  );
}
