import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  resetVault: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("./vault", () => ({
  setVaultKey: vi.fn(),
  verifyVaultKey: vi.fn(async () => undefined),
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  unlockVaultIfNeeded: vi.fn(async () => undefined),
  resetVault: h.resetVault,
}));

import { logout } from "./account";

beforeEach(() => { vi.clearAllMocks(); });

test("signing out resets the local vault", async () => {
  await logout();
  expect(h.resetVault).toHaveBeenCalled();
});

test("a failing reset never rejects the caller", async () => {
  h.resetVault.mockRejectedValueOnce(new Error("secrets busy"));
  await expect(logout()).rejects.toThrow("secrets busy");
});
