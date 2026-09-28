export interface NativeShellCompletionCandidate {
  text: string;
  description?: string;
}

export interface NativeShellCompletionState {
  receiving: boolean;
  candidates: NativeShellCompletionCandidate[];
  replacementStartBytes: number | null;
  replacementLengthBytes: number | null;
}

export type NativeShellCompletionEvent =
  | { kind: "start"; line?: string; cursorAtEnd?: boolean }
  | { kind: "end" }
  | { kind: "candidate"; text: string }
  | { kind: "description"; text: string }
  | { kind: "replacement"; startBytes: number; lengthBytes: number }
  | { kind: "armed" }
  | { kind: "ignored" };

export function createNativeShellCompletionState(): NativeShellCompletionState {
  return createNativeShellCompletionStateBase();
}

function decodeHex(value: string): string | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) return null;
  try {
    const bytes = new Uint8Array(value.length / 2);
    for (let i = 0; i < value.length; i += 2) bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function parseNativeShellCompletionEvent(data: string): NativeShellCompletionEvent {
  if (data === "A") return { kind: "start" };
  if (data.startsWith("A;")) {
    const [, encoded, point, extra] = data.split(";");
    const line = decodeHex(encoded);
    const cursor = Number(point);
    if (extra === undefined && line !== null && /^\d+$/.test(point) && Number.isSafeInteger(cursor)) {
      const atEnd = cursor === line.length || cursor === new TextEncoder().encode(line).length;
      return { kind: "start", line, cursorAtEnd: atEnd };
    }
    return { kind: "ignored" };
  }
  if (data === "B") return { kind: "end" };
  // Emitted once by the shell's startup file when the completion hook armed.
  // Its absence in the log is the only reliable signal that the remote rcfile
  // never ran, which otherwise looks identical to "the shell ignores us".
  if (data === "R") return { kind: "armed" };

  const [kind, payload = ""] = data.split(";", 2);
  if (kind === "C") {
    const text = decodeHex(payload);
    return text === null ? { kind: "ignored" } : { kind: "candidate", text };
  }
  if (kind === "D?description") {
    const text = decodeHex(payload);
    return text === null ? { kind: "ignored" } : { kind: "description", text };
  }
  if (kind === "S") {
    const [start, length] = payload.split(",").map(Number);
    if (Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= 0 && length >= 0) {
      return { kind: "replacement", startBytes: start, lengthBytes: length };
    }
  }
  return { kind: "ignored" };
}

export function applyNativeShellCompletionEvent(
  state: NativeShellCompletionState,
  event: NativeShellCompletionEvent,
): NativeShellCompletionState {
  if (event.kind === "start") return withNativeShellCompletionState({ receiving: true });
  if (!state.receiving) return state;
  if (event.kind === "candidate") {
    return { ...state, candidates: [...state.candidates, { text: event.text }] };
  }
  if (event.kind === "description" && state.candidates.length > 0) {
    const candidates = [...state.candidates];
    candidates[candidates.length - 1] = { ...candidates[candidates.length - 1], description: event.text };
    return { ...state, candidates };
  }
  if (event.kind === "replacement") {
    return { ...state, replacementStartBytes: event.startBytes, replacementLengthBytes: event.lengthBytes };
  }
  if (event.kind === "end") return { ...state, receiving: false };
  return state;
}

function byteOffsetToStringIndex(value: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  const bytes = new TextEncoder();
  let index = 0;
  let consumed = 0;
  for (const character of value) {
    const next = consumed + bytes.encode(character).length;
    if (next > byteOffset) break;
    consumed = next;
    index += character.length;
  }
  return index;
}

export function replaceNativeCompletionSpan(
  buffer: string,
  candidate: string,
  replacementStartBytes: number | null,
  replacementLengthBytes: number | null,
): string {
  if (replacementStartBytes === null || replacementLengthBytes === null) {
    const start = Math.max(buffer.lastIndexOf(" "), buffer.lastIndexOf("\t")) + 1;
    return `${buffer.slice(0, start)}${candidate}`;
  }
  const start = byteOffsetToStringIndex(buffer, replacementStartBytes);
  const end = byteOffsetToStringIndex(buffer, replacementStartBytes + replacementLengthBytes);
  return `${buffer.slice(0, start)}${candidate}${buffer.slice(end)}`;
}

function withNativeShellCompletionState(overrides: Partial<NativeShellCompletionState> = {}): NativeShellCompletionState {
  return { ...createNativeShellCompletionStateBase(), ...overrides };
}

function createNativeShellCompletionStateBase(): NativeShellCompletionState {
  return {
    receiving: false,
    candidates: [],
    replacementStartBytes: null,
    replacementLengthBytes: null,
  };
}
