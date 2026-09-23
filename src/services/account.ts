import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { setVaultKey, verifyVaultKey, lockVault, getVaultStatus, unlockVaultIfNeeded } from "./vault";
import { VaultUnreadableError } from "./vaultErrors";
import { localGet, localSet, localDelete } from "./localStore";

const FORCE_LOCK_FLAG_KEY = "voltius.force-lock-next-auth";

interface DeriveKeysResult {
  auth_key: string;   // base64 — unused locally, kept for the shared derive command
  enc_key: number[];  // raw 32 bytes — kek (semantic rename; bit-identical to old enc_key)
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function isHexEncoded32ByteKey(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

async function deriveKeys(password: string, accountId: string): Promise<DeriveKeysResult> {
  return invoke<DeriveKeysResult>("derive_keys", { password, accountId });
}

function setForceLockFlag(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(FORCE_LOCK_FLAG_KEY, "1");
  } catch {
    // Ignore storage availability errors in hardened runtimes.
  }
}

export function consumeForceLockFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const forced = window.sessionStorage.getItem(FORCE_LOCK_FLAG_KEY) === "1";
    if (forced) window.sessionStorage.removeItem(FORCE_LOCK_FLAG_KEY);
    return forced;
  } catch {
    return false;
  }
}

export async function lockVaultSession(): Promise<void> {
  const mode = await localGet("mode");
  await lockVault();
  setForceLockFlag();

  // Lock should require re-entering the master password on a password-protected
  // local account.
  if (mode === "local") {
    await localDelete("master_password");
  }
}

// ─── Account operations ───────────────────────────────────────────────────────

/** First launch, no friction — random key kept in the local store. */
export async function createLocalAccountNoPassword(): Promise<void> {
  const accountId = crypto.randomUUID();
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const keyBytes = Array.from(rawKey);
  // Store key as hex so we can recover it from the local store on next launch
  const keyHex = keyBytes.map((b) => b.toString(16).padStart(2, "0")).join("");

  setVaultKey(keyBytes);

  await localSet("master_password", keyHex); // hex = "password" for this mode
  await localSet("account_id", accountId);
  await localSet("mode", "local-nopassword");
}

/** Local account protected by a user-chosen password. */
export async function createLocalAccount(password: string): Promise<void> {
  const accountId = crypto.randomUUID();
  const { enc_key } = await deriveKeys(password, accountId);

  setVaultKey(enc_key);

  await localSet("master_password", password);
  await localSet("account_id", accountId);
  await localSet("mode", "local");
}

/** First candidate that opens secrets.enc; the first one when no vault exists yet. */
async function keyThatOpensVault(...candidates: number[][]): Promise<number[] | null> {
  const { exists } = await getVaultStatus();
  if (!exists) return candidates[0] ?? null;
  for (const key of candidates) {
    try {
      await verifyVaultKey(key);
      return key;
    } catch (e) {
      // Only a failed decrypt means "not this key". A read error — a file held by
      // a backup or an antivirus — must keep its own identity: folded in here it
      // reads as "no key fits", whose recovery screen offers to set the file aside.
      if (!(e instanceof VaultUnreadableError)) throw e;
    }
  }
  return null;
}

/** Unlock with the account's master password (vault must exist). */
export async function login(password: string): Promise<void> {
  const accountId = await localGet("account_id");
  if (!accountId) throw new Error(i18n.t("common.error.noAccountFoundCreateOne"));

  const mode = await localGet("mode");

  let encKey: number[];
  if (mode === "local-nopassword") {
    // password IS the stored hex key — convert back to bytes
    encKey = hexToBytes(password);
    if (!(await keyThatOpensVault(encKey))) throw new Error(i18n.t("common.error.incorrectPassword"));
  } else {
    const { enc_key: kek } = await deriveKeys(password, accountId);
    const opened = await keyThatOpensVault(kek);
    if (!opened) throw new Error(i18n.t("common.error.incorrectPassword"));
    encKey = opened;
  }

  setVaultKey(encKey);

  await localSet("master_password", password);
  await localSet("account_id", accountId);
  if (!mode) {
    // Heal missing mode for local accounts (e.g. Windows after mock-keychain loss).
    await localSet("mode", isHexEncoded32ByteKey(password) ? "local-nopassword" : "local");
  }
}

/**
 * How an auto-login ended. `vault-unreadable` is not a declined session:
 * the account has no master password to retype, so the unlock prompt cannot help
 * and the caller must offer the vault recovery screen instead.
 */
export type AutoLoginOutcome = "ok" | "declined" | "vault-unreadable";

/** Auto-login from the local file store — instant (no secret access). */
export async function autoLogin(): Promise<AutoLoginOutcome> {
  // A store failure here (e.g. an unreadable config directory) must degrade to
  // "no session", never throw — an unhandled rejection would abort the splash
  // init and freeze the app on its loading screen.
  let password: string | null, accountId: string | null, mode: string | null;
  try {
    [password, accountId, mode] = await Promise.all([
      localGet("master_password"),
      localGet("account_id"),
      localGet("mode"),
    ]);
  } catch {
    return "declined";
  }
  if (!password) return "declined";

  try {
    let encKey: number[];

    // In local-store mode, the stored value is already the encryption key.
    // Some older installs may miss mode/account_id metadata; heal it silently.
    if (mode === "local-nopassword" || (!mode && !accountId && isHexEncoded32ByteKey(password))) {
      if (!isHexEncoded32ByteKey(password)) return "declined";
      encKey = hexToBytes(password); // password = stored hex key

      // The key lives in the local store and is the only one this account has, so
      // a vault it cannot open is unreadable, not a wrong password. Installing it
      // regardless would defer the failure to the first secret read, inside the app.
      if (!(await keyThatOpensVault(encKey))) return "vault-unreadable";

      if (!accountId) {
        await localSet("account_id", crypto.randomUUID());
      }
      if (!mode) {
        await localSet("mode", "local-nopassword");
      }
    } else {
      if (!accountId) return "declined";
      const { enc_key: kek } = await deriveKeys(password, accountId);

      const opened = await keyThatOpensVault(kek);
      // Decline rather than install a key already proven not to open the file.
      // A password account keeps the unlock prompt: another password may open it.
      if (!opened) return "declined";
      encKey = opened;

      if (!mode) {
        // Heal missing mode for local accounts (e.g. Windows after mock-keychain loss)
        await localSet("mode", "local");
      }
    }
    setVaultKey(encKey); // instant — no secrets_unlock yet
    return "ok";
  } catch {
    return "declined";
  }
}

/** Reset the local account — wipes the vault and all local-store entries so the
 *  app starts fresh on next launch (same as first-launch home screen). */
export async function logout(): Promise<void> {
  const { resetVault } = await import("@/services/vault");
  await resetVault();
}

export async function getAccountMode(): Promise<string | null> {
  return localGet("mode");
}

/** Set a master password on a no-password account — re-encrypts secrets.enc. */
export async function setMasterPassword(password: string): Promise<void> {
  const accountId = await localGet("account_id");
  if (!accountId) throw new Error(i18n.t("common.error.noAccountFound"));

  const { enc_key } = await deriveKeys(password, accountId);

  // Re-encrypt secrets store with new key (ensure unlocked first — autoLogin sets the key lazily)
  await unlockVaultIfNeeded();
  await invoke("secrets_reencrypt", { newEncKey: enc_key });

  await localSet("master_password", password);
  await localSet("mode", "local");

  setVaultKey(enc_key);
}
