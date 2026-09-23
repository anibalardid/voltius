import { test, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { resolveVaultIdForSave, useDefaultVaultId } from "./useWritableVaultIds";
import { useVaultStore } from "@/stores/vaultStore";

beforeEach(() => {
  useVaultStore.setState({ vaults: [], selectedVaultIds: [] } as never);
});

// ─── resolveVaultIdForSave ───
test("resolveVaultIdForSave: personal passthrough", () => {
  expect(resolveVaultIdForSave("personal")).toBe("personal");
});
test("resolveVaultIdForSave: maps local vault uuid to its teamId", () => {
  useVaultStore.setState({ vaults: [{ id: "v1", teamId: "team-abc" }] } as never);
  expect(resolveVaultIdForSave("v1")).toBe("team-abc");
});
test("resolveVaultIdForSave: unknown vault id returned unchanged", () => {
  expect(resolveVaultIdForSave("v-unknown")).toBe("v-unknown");
});

// ─── useDefaultVaultId ───
test("new items default to the vault currently open", () => {
  useVaultStore.setState({
    vaults: [{ id: "work", name: "Work" }],
    selectedVaultIds: ["work"],
  } as never);
  const { result } = renderHook(() => useDefaultVaultId());
  expect(result.current).toBe("work");
});

test("several vaults on screen fall back to personal", () => {
  useVaultStore.setState({
    vaults: [{ id: "work", name: "Work" }],
    selectedVaultIds: ["personal", "work"],
  } as never);
  const { result } = renderHook(() => useDefaultVaultId());
  expect(result.current).toBe("personal");
});
