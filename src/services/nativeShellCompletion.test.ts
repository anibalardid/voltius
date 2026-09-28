import { describe, expect, it } from "vitest";
import {
  applyNativeShellCompletionEvent,
  createNativeShellCompletionState,
  parseNativeShellCompletionEvent,
  replaceNativeCompletionSpan,
} from "./nativeShellCompletion";

describe("native shell completion protocol", () => {
  it("decodes candidates and descriptions from OSC payloads", () => {
    expect(parseNativeShellCompletionEvent("C;6563686f")).toEqual({ kind: "candidate", text: "echo" });
    expect(parseNativeShellCompletionEvent("D?description;636f6d6d616e64")).toEqual({ kind: "description", text: "command" });
  });

  it("uses the shell's actual editor line and rejects a cursor away from the end", () => {
    expect(parseNativeShellCompletionEvent("A;6364202f;4")).toEqual({
      kind: "start", line: "cd /", cursorAtEnd: true,
    });
    expect(parseNativeShellCompletionEvent("A;6364202f;2")).toEqual({
      kind: "start", line: "cd /", cursorAtEnd: false,
    });
    expect(parseNativeShellCompletionEvent("A;bad;4")).toEqual({ kind: "ignored" });
  });

  it("reports the arming marker so a dead remote rcfile is visible in the log", () => {
    // Absence of this marker is the only thing that separates "the rcfile never
    // ran" from "the remote shell ignores us"; without it both look the same.
    expect(parseNativeShellCompletionEvent("R")).toEqual({ kind: "armed" });
  });

  it("collects one shell response without accepting events outside a response", () => {
    let state = createNativeShellCompletionState();
    state = applyNativeShellCompletionEvent(state, parseNativeShellCompletionEvent("C;6563686f"));
    expect(state.candidates).toEqual([]);

    state = applyNativeShellCompletionEvent(state, parseNativeShellCompletionEvent("A"));
    state = applyNativeShellCompletionEvent(state, parseNativeShellCompletionEvent("S;5,2"));
    state = applyNativeShellCompletionEvent(state, parseNativeShellCompletionEvent("C;6563686f"));
    state = applyNativeShellCompletionEvent(state, parseNativeShellCompletionEvent("D?description;636f6d6d616e64"));
    state = applyNativeShellCompletionEvent(state, parseNativeShellCompletionEvent("B"));

    expect(state).toMatchObject({
      receiving: false,
      replacementStartBytes: 5,
      replacementLengthBytes: 2,
      candidates: [{ text: "echo", description: "command" }],
    });
  });

  it("replaces a UTF-8 byte span without splitting a character", () => {
    expect(replaceNativeCompletionSpan("echo café", "coffee", 5, 5)).toBe("echo coffee");
  });

  it("falls back to the final shell token when no span is supplied", () => {
    expect(replaceNativeCompletionSpan("git che", "checkout", null, null)).toBe("git checkout");
  });
});
