/**
 * Secrets in a local-only install live in one encrypted store keyed by object
 * id, not per vault: moving an object from one local vault to another is a
 * label change, not a secret migration. These verb names are the seam the
 * vault-move and clipboard paths call into, so they stay as no-ops rather than
 * forcing every caller to know that.
 */

export const publishConnectionSecrets = async (_id: string, _vaultId: string): Promise<void> => {};
export const unpublishConnectionSecrets = async (_id: string, _vaultId: string): Promise<void> => {};

export const publishKeySecrets = async (_id: string, _vaultId: string): Promise<void> => {};
export const unpublishKeySecrets = async (_id: string, _vaultId: string): Promise<void> => {};

export const publishIdentitySecrets = async (_id: string, _vaultId: string): Promise<void> => {};
export const unpublishIdentitySecrets = async (_id: string, _vaultId: string): Promise<void> => {};

/** Runs a withdrawal for its side effect; local withdrawals never fail. */
export async function withdrawOrWarn(withdrawal: Promise<unknown>): Promise<void> {
  await withdrawal;
}
