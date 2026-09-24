import { resolveSnippetPayload } from "./snippetRunCore.ts";
import { test } from "vitest";

test("snippetRunCore", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const ctx = { connectionHost: "h", connectionUsername: "u", connectionName: "n", clipboard: "" };

// No variables: payload is the bare resolved text (the execution newline is the
// backend's job via the execute flag, never added here).
{
  const sn = { id: "1", name: "s", steps: [{ kind: "script", content: "echo hi" }] } as any;
  const r = resolveSnippetPayload(sn, ctx);
  assertEqual(r.missing.length, 0, "no missing vars");
  assertEqual(r.payload, "echo hi", "payload is bare resolved text, no newline");
}

// Dynamic clipboard content is part of the payload but is masked in the display
// template, keeping the two representations separate.
{
  const sn = { id: "3", name: "clipboard", steps: [{ kind: "script", content: "echo {{clipboard}}" }] } as any;
  const r = resolveSnippetPayload(sn, { ...ctx, clipboard: "secret-from-clipboard" });
  assertEqual(r.payload, "echo secret-from-clipboard", "clipboard remains in the payload");
  assertEqual(r.displayPartialTemplate, "echo ••••••••", "clipboard is masked in the preview");
}

// A user variable present and unfilled → reported as missing; pending carries a partialTemplate string.
{
  const sn = { id: "2", name: "v", steps: [{ kind: "script", content: "deploy {{env}}" }] } as any;
  const r = resolveSnippetPayload(sn, ctx);
  assertEqual(r.missing.length, 1, "exactly one missing user var");
  assertEqual(r.partialTemplate, "deploy {{env}}", "user var left intact in partialTemplate");
}
});
