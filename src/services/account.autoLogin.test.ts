import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  setVaultKey: vi.fn(),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  verifyVaultKey: vi.fn(async (_key: number[]) => undefined as void),
  keysSet: vi.fn(),
  markIdentityUnproven: vi.fn(),
  appFetch: vi.fn(),
  /** The local file store account.ts now reads and writes. */
  store: {} as Record<string, string | null>,
  /** The legacy OS-keychain entries the one-time migration reads. */
  keychain: {} as Record<string, string | null>,
  storeThrows: false,
  keychainThrows: false,
  deriveThrows: false,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch, isAbortError: () => false }));
vi.mock("./vault", () => ({
  setVaultKey: h.setVaultKey,
  verifyVaultKey: h.verifyVaultKey,
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: h.getVaultStatus,
  unlockVaultIfNeeded: vi.fn(async () => undefined),
  wipeLocalConfig: vi.fn(async () => undefined),
  resetVault: vi.fn(async () => undefined),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: vi.fn(async () => undefined) }) },
}));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: {
    getState: () => ({
      set: h.keysSet,
      markIdentityUnproven: h.markIdentityUnproven,
      clear: vi.fn(),
      dek: null,
      x25519Private: null,
    }),
  },
}));

import { autoLogin } from "./account";
import { VaultUnreadableError } from "./vaultErrors";

/** What vault.ts raises for a key that does not decrypt the file. */
const wrongKey = () => new VaultUnreadableError();

const HEX64 = "a".repeat(64); // valid 32-byte hex key
const DERIVE_KEK = [9, 9, 9];

function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case "local_kv_get":
        if (h.storeThrows) throw new Error("local store unavailable");
        return h.store[args.key as string] ?? null;
      case "local_kv_set":
        h.store[args.key as string] = args.value as string;
        return undefined;
      case "local_kv_delete":
        delete h.store[args.key as string];
        return undefined;
      case "keychain_get":
        if (h.keychainThrows) throw new Error("keychain unavailable");
        return h.keychain[args.key as string] ?? null;
      case "keychain_delete":
        delete h.keychain[args.key as string];
        return undefined;
      case "derive_keys":
        if (h.deriveThrows) throw new Error("derive failed");
        return { auth_key: "AUTH", enc_key: DERIVE_KEK };
      default:
        return undefined;
    }
  });
}

beforeEach(() => {
  h.invoke.mockReset();
  h.setVaultKey.mockReset();
  h.getVaultStatus.mockReset();
  h.getVaultStatus.mockResolvedValue({ exists: false, path: "" });
  h.verifyVaultKey.mockReset();
  h.verifyVaultKey.mockResolvedValue(undefined);
  h.keysSet.mockReset();
  h.markIdentityUnproven.mockReset();
  h.appFetch.mockReset();
  h.appFetch.mockRejectedValue(new Error("no server in this test"));
  h.store = {};
  h.keychain = {};
  h.storeThrows = false;
  h.keychainThrows = false;
  h.deriveThrows = false;
  routeInvoke();
});

const invoked = (cmd: string) => h.invoke.mock.calls.some(([c]) => c === cmd);

// ─── fail-closed guards ──────────────────────────────────────────────────────

test("autoLogin degrades to false (never throws) when the local store is unavailable", async () => {
  h.storeThrows = true;
  await expect(autoLogin()).resolves.toBe("declined");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("autoLogin returns false when no master password is stored", async () => {
  // store empty → password null
  expect(await autoLogin()).toBe("declined");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("autoLogin returns false in server/local mode when account_id is missing", async () => {
  h.store.master_password = "pw";
  h.store.mode = "local";
  // no account_id
  expect(await autoLogin()).toBe("declined");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("autoLogin returns false when derive_keys fails", async () => {
  h.store.master_password = "pw";
  h.store.mode = "local";
  h.store.account_id = "acc";
  h.deriveThrows = true;
  expect(await autoLogin()).toBe("declined");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// ─── no OS keychain ──────────────────────────────────────────────────────────

test("autoLogin reads the local store only, never the OS keychain", async () => {
  h.store.master_password = "pw";
  h.store.account_id = "acc";
  h.store.mode = "local";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });

  expect(await autoLogin()).toBe("ok");

  expect(invoked("keychain_get")).toBe(false);
  expect(invoked("keychain_delete")).toBe(false);
});

// ─── no-password (local store) path ──────────────────────────────────────────

test("autoLogin (no-password) uses the stored hex key and heals missing account_id", async () => {
  h.store.master_password = HEX64;
  h.store.mode = "local-nopassword";
  // no account_id
  expect(await autoLogin()).toBe("ok");
  // hex decoded to 32 bytes and set as the vault key (no derive_keys call)
  expect(h.setVaultKey).toHaveBeenCalledTimes(1);
  expect(h.setVaultKey.mock.calls[0][0]).toHaveLength(32);
  expect(invoked("derive_keys")).toBe(false);
  // account_id healed
  expect(h.store.account_id).toBeTruthy();
});

test("autoLogin (no-password) returns false when the stored key is not valid hex", async () => {
  h.store.master_password = "not-hex";
  h.store.mode = "local-nopassword";
  expect(await autoLogin()).toBe("declined");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// ─── password (kek) path ─────────────────────────────────────────────────────

test("autoLogin falls back to kek when the existing vault rejects dek", async () => {
  h.store.master_password = "pw";
  h.store.mode = "server";
  h.store.account_id = "acc";
  h.store.wrapped_user_secrets = "WRAPPED";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockImplementation(async (key: number[]) => {
    if (String(key) !== String(DERIVE_KEK)) throw wrongKey(); // dek does NOT open it
  });

  expect(await autoLogin()).toBe("ok");
  expect(h.setVaultKey).toHaveBeenCalledWith(DERIVE_KEK); // kek
});

// Installing a proven-wrong key only defers the failure to the first secret read.
test("autoLogin declines the session when no key opens the existing vault", async () => {
  h.store.master_password = "pw";
  h.store.mode = "server";
  h.store.account_id = "acc";
  h.store.wrapped_user_secrets = "WRAPPED";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockRejectedValue(wrongKey());

  expect(await autoLogin()).toBe("declined");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// A no-password account has no password to retype, so "declined" would send it to
// an unlock prompt it can never satisfy. It gets the recovery screen instead.
test("autoLogin (no-password) reports an unreadable vault rather than admitting the session", async () => {
  h.store.master_password = HEX64;
  h.store.mode = "local-nopassword";
  h.store.account_id = "acc";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockRejectedValue(wrongKey());

  expect(await autoLogin()).toBe("vault-unreadable");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// The recovery screen's primary action sets the file aside. A file merely held
// open by a backup or an antivirus must land on the unlock prompt instead.
test("autoLogin (no-password) does not call a file it could not read unreadable", async () => {
  h.store.master_password = HEX64;
  h.store.mode = "local-nopassword";
  h.store.account_id = "acc";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockRejectedValue(new Error("Read failed: permission denied"));

  expect(await autoLogin()).toBe("declined");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("autoLogin (no-password) admits the session when the stored key opens the vault", async () => {
  h.store.master_password = HEX64;
  h.store.mode = "local-nopassword";
  h.store.account_id = "acc";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });

  expect(await autoLogin()).toBe("ok");
  expect(h.setVaultKey).toHaveBeenCalledTimes(1);
});

// ─── mode healing ────────────────────────────────────────────────────────────

test("autoLogin heals a missing mode to local for a password account", async () => {
  h.store.master_password = "pw"; // non-hex → not treated as a stored hex key
  h.store.account_id = "acc";
  // no mode, no wrapped secrets
  expect(await autoLogin()).toBe("ok");
  expect(h.setVaultKey).toHaveBeenCalledWith(DERIVE_KEK);
  expect(h.store.mode).toBe("local");
});
