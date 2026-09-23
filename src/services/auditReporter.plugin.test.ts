import { describe, test, expect, vi, beforeEach } from "vitest";

const reportLocalClientEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/localAuditService", () => ({ reportLocalClientEvent }));

const { reportPluginAuditEvent, localSinkVaultId, boundLocalMetadata } = await import("@/services/auditReporter");

beforeEach(() => {
  reportLocalClientEvent.mockClear();
});

describe("localSinkVaultId", () => {
  test("uses the vault id for a local context", () => {
    expect(localSinkVaultId({ kind: "local", vaultId: "personal" })).toBe("personal");
  });
});

describe("reportPluginAuditEvent", () => {
  test("writes the local sink", () => {
    reportPluginAuditEvent({ kind: "local", vaultId: "personal" }, "agent.command_run");
    expect(reportLocalClientEvent).toHaveBeenCalledTimes(1);
  });

  test("localMetadata reaches the local sink", () => {
    reportPluginAuditEvent(
      { kind: "local", vaultId: "personal" },
      "agent.command_run",
      { metadata: { shared: 1 }, localMetadata: { command: "rm -rf /" } },
    );

    const local = reportLocalClientEvent.mock.calls[0][1] as { metadata: Record<string, unknown> };
    expect(local.metadata).toEqual({ shared: 1, command: "rm -rf /" });
  });

  test("a caller-supplied localMetadata.plugin_id does not override the stamped one", () => {
    reportPluginAuditEvent(
      { kind: "local", vaultId: "personal" },
      "agent.command_run",
      { metadata: { plugin_id: "agent" }, localMetadata: { plugin_id: "other-plugin" } },
    );
    const local = reportLocalClientEvent.mock.calls[0][1] as { metadata: Record<string, unknown> };
    expect(local.metadata.plugin_id).toBe("agent");
  });

  test("an empty payload leaves the local metadata undefined", () => {
    reportPluginAuditEvent({ kind: "local", vaultId: "personal" }, "agent.command_run");
    const local = reportLocalClientEvent.mock.calls[0][1] as { metadata?: Record<string, unknown> };
    expect(local.metadata).toBeUndefined();
  });

  test("bounds an oversize metadata payload locally", () => {
    const huge = "x".repeat(600_000);
    reportPluginAuditEvent(
      { kind: "local", vaultId: "personal" },
      "agent.command_run",
      { metadata: { blob: huge, plugin_id: "agent" } },
    );

    const local = reportLocalClientEvent.mock.calls[0][1] as { metadata: Record<string, unknown> };
    expect(local.metadata).toEqual({ blob: "x".repeat(2000), blob_truncated: true, plugin_id: "agent" });
  });

  test("plugin_id survives a dropped local payload", () => {
    reportPluginAuditEvent(
      { kind: "local", vaultId: "personal" },
      "agent.command_run",
      { metadata: { plugin_id: "agent" }, localMetadata: { blob: { a: "x".repeat(600_000) } } },
    );
    const local = reportLocalClientEvent.mock.calls[0][1] as { metadata: Record<string, unknown> };
    expect(local.metadata).toEqual({ localMetadata_dropped: true, plugin_id: "agent" });
  });
});

describe("boundLocalMetadata", () => {
  test("truncates an oversize string and flags it", () => {
    const bounded = boundLocalMetadata({ command: "x".repeat(2500) })!;
    expect(bounded.command).toHaveLength(2000);
    expect(bounded.command_truncated).toBe(true);
  });

  test("leaves an exactly-2000-char string alone and unflagged", () => {
    const exact = "x".repeat(2000);
    const bounded = boundLocalMetadata({ command: exact })!;
    expect(bounded.command).toBe(exact);
    expect(bounded.command_truncated).toBeUndefined();
  });

  test("passes a non-string value through untouched", () => {
    expect(boundLocalMetadata({ count: 42 })!.count).toBe(42);
  });

  test("drops a nested oversize value entirely", () => {
    expect(boundLocalMetadata({ blob: { a: "x".repeat(600_000) } })).toEqual({ localMetadata_dropped: true });
  });

  test("truncates a huge serialized key stream and keeps the rest of the row", () => {
    const bounded = boundLocalMetadata({ keys: JSON.stringify(["x".repeat(4096)]), tool: "send_keys" })!;
    expect(bounded.keys).toHaveLength(2000);
    expect(bounded.keys_truncated).toBe(true);
    expect(bounded.tool).toBe("send_keys");
    expect(bounded.localMetadata_dropped).toBeUndefined();
  });

  test("drops an array of many medium strings that exceeds the budget", () => {
    const items = Array.from({ length: 400 }, () => "x".repeat(1999));
    expect(boundLocalMetadata({ items })).toEqual({ localMetadata_dropped: true });
  });

  test("leaves an ordinary small payload unchanged and unmarked", () => {
    const bounded = boundLocalMetadata({ command: "ls", count: 1 })!;
    expect(bounded).toEqual({ command: "ls", count: 1 });
    expect(bounded.localMetadata_dropped).toBeUndefined();
  });

  test("drops a circular reference rather than throwing", () => {
    const circular: Record<string, unknown> = { command: "ls" };
    circular.self = circular;
    expect(boundLocalMetadata(circular)).toEqual({ localMetadata_dropped: true });
  });
});
