import { test, expect } from "vitest";
import { auditContextForVaultId } from "./auditContextResolver.ts";

test("undefined/empty vaultId resolves to local 'personal'", () => {
  expect(auditContextForVaultId(undefined)).toEqual({ kind: "local", vaultId: "personal" });
  expect(auditContextForVaultId("")).toEqual({ kind: "local", vaultId: "personal" });
});

test("a vault id resolves to the local sink", () => {
  expect(auditContextForVaultId("v1")).toEqual({ kind: "local", vaultId: "v1" });
});

test("an unknown vault id resolves to local with that id", () => {
  expect(auditContextForVaultId("ghost")).toEqual({ kind: "local", vaultId: "ghost" });
});
