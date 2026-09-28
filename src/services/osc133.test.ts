import { describe, expect, it } from "vitest";
import {
  applyOsc133Marker,
  createOsc133State,
  parseOsc133,
  resetOsc133State,
} from "./osc133";

describe("OSC 133 parser", () => {
  it("parses A/B/C/D markers and an exit code", () => {
    expect(parseOsc133("A;cwd=/tmp").marker).toEqual({ kind: "prompt-start", payload: "cwd=/tmp" });
    expect(parseOsc133("B;command=git status").marker).toEqual({ kind: "command-start", payload: "command=git status" });
    expect(parseOsc133("C").marker).toEqual({ kind: "command-executed", payload: "" });
    expect(parseOsc133("D;17").marker).toEqual({ kind: "command-finished", payload: "17", exitCode: 17 });
  });

  it("rejects malformed, hostile, and oversized payloads without throwing", () => {
    for (const input of ["", "E;bad", "A;\u001b]133;D;0", "D;256", `B;${"x".repeat(2049)}`]) {
      expect(parseOsc133(input).marker).toBeNull();
      expect(parseOsc133(input).malformed).toBe(true);
    }
  });

  it("does not infer a result from out-of-order markers", () => {
    const state = createOsc133State();
    expect(applyOsc133Marker(state, parseOsc133("D;0").marker!)).toEqual(state);
    expect(applyOsc133Marker(state, parseOsc133("C").marker!)).toEqual(state);
  });

  it("tracks metadata, status, bounded history, and reconnect generations", () => {
    let state = createOsc133State();
    state = applyOsc133Marker(state, parseOsc133("A;prompt").marker!);
    state = applyOsc133Marker(state, parseOsc133("B;cmd").marker!, { line: 12 });
    state = applyOsc133Marker(state, parseOsc133("C").marker!);
    state = applyOsc133Marker(state, parseOsc133("D;0").marker!, { line: 13 });
    expect(state.blocks[0]).toMatchObject({ status: "finished", exitCode: 0, promptMetadata: "prompt", commandMetadata: "cmd", startLine: 12, endLine: 13 });

    const reset = resetOsc133State(state);
    expect(reset.generation).toBe(1);
    expect(reset.blocks).toEqual([]);
    expect(reset.activeBlockId).toBeNull();
  });
});
