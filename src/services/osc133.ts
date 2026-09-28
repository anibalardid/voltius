/**
 * Defensive OSC 133 parsing and command-block state.
 *
 * This module only interprets markers. It never writes to a session, evaluates
 * payloads, or infers a result from a missing marker or a disconnect.
 */

export const OSC133_MAX_PAYLOAD = 2048;
export const OSC133_MAX_BLOCKS = 200;

export type Osc133Kind = "prompt-start" | "command-start" | "command-executed" | "command-finished";

export interface Osc133Marker {
  kind: Osc133Kind;
  payload: string;
  exitCode?: number;
}

export interface Osc133ParseResult {
  marker: Osc133Marker | null;
  malformed: boolean;
}

export interface Osc133Location {
  line?: number;
}

export type CommandBlockStatus = "open" | "executing" | "finished" | "unknown";

export interface CommandBlock {
  id: number;
  generation: number;
  status: CommandBlockStatus;
  promptMetadata: string;
  commandMetadata: string;
  exitCode?: number;
  startLine?: number;
  endLine?: number;
}

export interface Osc133State {
  generation: number;
  nextId: number;
  promptMetadata: string;
  activeBlockId: number | null;
  blocks: CommandBlock[];
}

function boundedPayload(payload: string): string | null {
  if (payload.length > OSC133_MAX_PAYLOAD) return null;
  // OSC data must not be allowed to smuggle another control sequence into
  // metadata. Printable text plus tabs is sufficient for shell metadata.
  for (const char of payload) {
    const code = char.charCodeAt(0);
    if (code < 0x20 && code !== 0x09 || code === 0x7f) return null;
  }
  return payload;
}

/** Parse the payload passed by xterm's registerOscHandler(133, ...). */
export function parseOsc133(data: string, maxPayload = OSC133_MAX_PAYLOAD): Osc133ParseResult {
  if (data.length > maxPayload + 4 || data.length === 0) return { marker: null, malformed: true };

  const kind = data[0];
  const separator = data.indexOf(";");
  const payload = separator === -1 ? "" : data.slice(separator + 1);
  if (separator !== -1 && separator !== 1) return { marker: null, malformed: true };
  if (!new Set(["A", "B", "C", "D"]).has(kind)) return { marker: null, malformed: true };
  if (payload.length > maxPayload) return { marker: null, malformed: true };
  const safePayload = boundedPayload(payload);
  if (safePayload === null) return { marker: null, malformed: true };

  const markerByKind: Record<string, Osc133Kind> = {
    A: "prompt-start",
    B: "command-start",
    C: "command-executed",
    D: "command-finished",
  };

  if (kind !== "D") return { marker: { kind: markerByKind[kind], payload: safePayload }, malformed: false };

  if (!/^\d{1,3}$/.test(safePayload)) return { marker: null, malformed: true };
  const exitCode = Number(safePayload);
  if (!Number.isSafeInteger(exitCode) || exitCode > 255) return { marker: null, malformed: true };
  return { marker: { kind: "command-finished", payload: safePayload, exitCode }, malformed: false };
}

export function createOsc133State(generation = 0): Osc133State {
  return { generation, nextId: 1, promptMetadata: "", activeBlockId: null, blocks: [] };
}

/** Reset all block knowledge for a new transport generation. */
export function resetOsc133State(state: Osc133State): Osc133State {
  return createOsc133State(state.generation + 1);
}

function withActive(state: Osc133State, update: (block: CommandBlock) => CommandBlock): Osc133State {
  if (state.activeBlockId === null) return state;
  const index = state.blocks.findIndex((block) => block.id === state.activeBlockId);
  if (index === -1) return { ...state, activeBlockId: null };
  const blocks = state.blocks.slice();
  blocks[index] = update(blocks[index]);
  return { ...state, blocks };
}

/** Apply one already-parsed marker. Malformed or out-of-order markers are no-ops. */
export function applyOsc133Marker(state: Osc133State, marker: Osc133Marker, location: Osc133Location = {}): Osc133State {
  switch (marker.kind) {
    case "prompt-start":
      return { ...state, promptMetadata: marker.payload };
    case "command-start": {
      const blocks = state.blocks.slice();
      if (state.activeBlockId !== null) {
        const previous = blocks.findIndex((block) => block.id === state.activeBlockId);
        if (previous !== -1 && blocks[previous].status !== "finished") {
          blocks[previous] = { ...blocks[previous], status: "unknown" };
        }
      }
      const block: CommandBlock = {
        id: state.nextId,
        generation: state.generation,
        status: "open",
        promptMetadata: state.promptMetadata,
        commandMetadata: marker.payload,
        startLine: location.line,
      };
      return {
        ...state,
        nextId: state.nextId + 1,
        activeBlockId: block.id,
        blocks: [...blocks, block].slice(-OSC133_MAX_BLOCKS),
      };
    }
    case "command-executed":
      return withActive(state, (block) => ({ ...block, status: "executing" }));
    case "command-finished":
      return withActive(state, (block) => ({
        ...block,
        status: "finished",
        exitCode: marker.exitCode,
        endLine: location.line,
      }));
  }
}

export function finishActiveAsUnknown(state: Osc133State): Osc133State {
  return withActive(state, (block) => ({ ...block, status: "unknown" }));
}
