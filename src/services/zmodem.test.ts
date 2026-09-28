import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  encodeZmodemBinaryHeader,
  encodeZmodemDataSubpacket,
  encodeZmodemHexHeader,
  ZMODEM_MAX_FILE_COUNT,
  ZMODEM_MAX_FILE_SIZE,
  ZmodemByteDemux,
  ZmodemSession,
  ZmodemWireParser,
  zmodemCancelSequence,
  zmodemSupport,
  validateRemoteFilename,
  validateZmodemLimits,
} from "./zmodem";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

async function settle(session: ZmodemSession): Promise<void> {
  await session.flush();
  await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function hasHeader(writes: Uint8Array[], type: number): boolean {
  return writes.some((write) => {
    const parser = new ZmodemWireParser();
    try {
      return parser.feed(write).some((event) => event.kind === "header" && event.header.type === type);
    } catch {
      return false;
    }
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command) => {
    if (command === "zmodem_temp_create") return "opaque-temp-handle";
    return undefined;
  });
});

describe("Zmodem raw-byte seam", () => {
  it("passes ordinary bytes through unchanged when not armed", () => {
    const input = new Uint8Array([0, 1, 0x18, 0xff, 0x41]);
    const demux = new ZmodemByteDemux();
    const result = demux.feed(input);
    expect([...result.terminal]).toEqual([...input]);
    expect(result.protocol).toHaveLength(0);
  });

  it("requires explicit arming before detecting a protocol prefix", () => {
    const demux = new ZmodemByteDemux();
    const prefix = new Uint8Array([0x2a, 0x2a, 0x18, 0x42]);
    expect(demux.feed(prefix).terminal).toEqual(prefix);
    demux.arm();
    const result = demux.feed(prefix);
    expect(result.detected).toBe(true);
    expect([...result.protocol]).toEqual([...prefix]);
    expect(result.terminal).toHaveLength(0);
  });

  it("keeps fragmented protocol prefixes out of terminal output", () => {
    const demux = new ZmodemByteDemux();
    demux.arm();
    expect(demux.feed(new Uint8Array([0x2a, 0x2a])).terminal).toHaveLength(0);
    const result = demux.feed(new Uint8Array([0x18, 0x41, 0x01, 0x02]));
    expect(result.detected).toBe(true);
    expect(result.terminal).toHaveLength(0);
    expect([...result.protocol]).toEqual([0x2a, 0x2a, 0x18, 0x41, 0x01, 0x02]);
  });

  it("detects standard binary framing with exactly one ZPAD", () => {
    const demux = new ZmodemByteDemux();
    demux.arm();
    const prefix = encodeZmodemBinaryHeader(0);
    const result = demux.feed(prefix);
    expect(result.detected).toBe(true);
    expect(result.terminal).toHaveLength(0);
    expect([...result.protocol.slice(0, 3)]).toEqual([0x2a, 0x18, 0x41]);
  });

  it("never returns protocol bytes to the terminal seam after detection", () => {
    const demux = new ZmodemByteDemux();
    demux.arm();
    const result = demux.feed(concat(new Uint8Array([65]), encodeZmodemHexHeader(0)));
    expect([...result.terminal]).toEqual([65]);
    expect(result.protocol.length).toBeGreaterThan(0);
  });
});

describe("Zmodem canonical wire vectors", () => {
  it("parses a fragmented seven-byte ZHEX header and optional CRLF", () => {
    const parser = new ZmodemWireParser();
    const frame = encodeZmodemHexHeader(0x09, 0x12345678);
    const events = [];
    for (const byte of frame) events.push(...parser.feed(new Uint8Array([byte])));
    expect(events).toHaveLength(1);
    const header = events[0];
    expect(header?.kind).toBe("header");
    if (header?.kind === "header") expect(header.header).toEqual({ type: 0x09, position: 0x12345678 });
  });

  it("round-trips escaped payload and CRC bytes including rubouts, flow control, ZDLE, and high controls", () => {
    const parser = new ZmodemWireParser();
    parser.setDataMode();
    const payload = new Uint8Array([0x7f, 0xff, 0x11, 0x13, 0x18, 0x80, 0x9f]);
    const [event] = parser.feed(encodeZmodemDataSubpacket(payload, 0x68));
    expect(event?.kind).toBe("data");
    if (event?.kind === "data") {
      expect(event.data).toEqual(payload);
      expect(event.end).toBe(0x68);
    }
  });

  it("keeps data mode after ZCRCG and parses the following subpacket", () => {
    const parser = new ZmodemWireParser();
    parser.setDataMode();
    const events = parser.feed(concat(
      encodeZmodemDataSubpacket(new Uint8Array([1, 2]), 0x69),
      encodeZmodemDataSubpacket(new Uint8Array([3]), 0x68),
    ));
    expect(events.filter((event) => event.kind === "data").map((event) => [...event.data])).toEqual([[1, 2], [3]]);
  });

  it("keeps data mode after ZCRCQ, then returns to header mode after ZCRCW", () => {
    const parser = new ZmodemWireParser();
    parser.setDataMode();
    const continuation = parser.feed(concat(
      encodeZmodemDataSubpacket(new Uint8Array([1]), 0x6a),
      encodeZmodemDataSubpacket(new Uint8Array([2]), 0x6b),
    ));
    expect(continuation.filter((event) => event.kind === "data")).toHaveLength(2);
    expect(parser.feed(encodeZmodemHexHeader(3))).toHaveLength(1);
  });

  it("rejects an invalid escape and detects the canonical incoming CAN run", () => {
    const parser = new ZmodemWireParser();
    parser.setDataMode();
    expect(() => parser.feed(new Uint8Array([0x18, 0x00]))).toThrow("invalid Zmodem escape");
    expect(() => parser.feed(new Uint8Array([0x18, 0x18, 0x18, 0x18, 0x18]))).toThrow("cancelled");
  });
});

describe("Zmodem safety policy", () => {
  it.each(["/tmp/file", "..", "../file", "a/b", "a\\b", "CON", "nul.txt", "bad\u0001name", ""]) (
    "rejects unsafe remote name %j",
    (name) => expect(validateRemoteFilename(name).ok).toBe(false),
  );

  it("accepts a plain bounded filename", () => {
    expect(validateRemoteFilename("report.bin")).toEqual({ ok: true, name: "report.bin" });
  });

  it("enforces size and file-count limits", () => {
    expect(validateZmodemLimits(ZMODEM_MAX_FILE_SIZE, ZMODEM_MAX_FILE_COUNT)).toEqual({ ok: true });
    expect(validateZmodemLimits(ZMODEM_MAX_FILE_SIZE + 1, 1).ok).toBe(false);
    expect(validateZmodemLimits(1, ZMODEM_MAX_FILE_COUNT + 1).ok).toBe(false);
  });
});

describe("Zmodem session gating", () => {
  it("supports only desktop, non-persistent interactive SSH", () => {
    expect(zmodemSupport({ sessionType: "ssh", platform: "macos" }).supported).toBe(true);
    expect(zmodemSupport({ sessionType: "local", platform: "macos" }).reason).toBe("sshOnly");
    expect(zmodemSupport({ sessionType: "ssh", persistent: true, platform: "linux" }).reason).toBe("persistent");
    expect(zmodemSupport({ sessionType: "ssh", broadcast: true, platform: "linux" }).reason).toBe("broadcast");
    expect(zmodemSupport({ sessionType: "ssh", platform: "android" }).reason).toBe("platform");
  });

  it("cancellation writes only through the supplied direct transport and resets the seam", async () => {
    const writes: Uint8Array[] = [];
    const session = new ZmodemSession((bytes) => { writes.push(bytes); });
    session.armReceive();
    session.consume(new Uint8Array([0x2a, 0x2a, 0x18, 0x42]));
    await session.cancel();
    expect(writes).toHaveLength(1);
    expect(session.getSnapshot().status).toBe("cancelled");
    expect([...session.consume(new Uint8Array([65, 66]))]).toEqual([65, 66]);
  });
});

describe("Zmodem session sequencing and outcomes", () => {
  it("cancels while a source read is pending and never sends ZEOF", async () => {
    const readStarted = deferred<void>();
    const readResult = deferred<number[]>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "zmodem_source_info") return { name: "source.bin", size: 3 };
      if (command === "zmodem_source_read") {
        readStarted.resolve();
        return readResult.promise;
      }
      return undefined;
    });
    const writes: Uint8Array[] = [];
    const session = new ZmodemSession((bytes) => { writes.push(bytes); }, "session-a");
    await session.startSend(["/tmp/source.bin"]);
    session.consume(encodeZmodemHexHeader(1));
    await settle(session);
    session.consume(encodeZmodemHexHeader(9));
    await readStarted.promise;

    const cancellation = session.cancel();
    await cancellation;
    expect(session.getSnapshot().status).toBe("cancelled");
    expect(writes).toContainEqual(zmodemCancelSequence());

    readResult.resolve([1, 2, 3]);
    await settle(session);
    expect(hasHeader(writes, 11)).toBe(false);
  });

  it("cancels behind a delayed transport write without racing protocol writes", async () => {
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    let delayNextWrite = false;
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const writes: Uint8Array[] = [];
    const send = async (bytes: Uint8Array): Promise<void> => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      writes.push(bytes);
      try {
        if (!delayNextWrite) return;
        delayNextWrite = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      } finally {
        activeWrites -= 1;
      }
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "zmodem_source_info") return { name: "source.bin", size: 1 };
      if (command === "zmodem_source_read") return [7];
      return undefined;
    });
    const session = new ZmodemSession(send, "session-a");
    await session.startSend(["/tmp/source.bin"]);
    session.consume(encodeZmodemHexHeader(1));
    await settle(session);
    delayNextWrite = true;
    session.consume(encodeZmodemHexHeader(9));
    await writeStarted.promise;

    const cancellation = session.cancel();
    releaseWrite.resolve();
    await cancellation;
    await settle(session);
    expect(session.getSnapshot().status).toBe("cancelled");
    expect(writes).toContainEqual(zmodemCancelSequence());
    expect(hasHeader(writes, 11)).toBe(false);
    expect(activeWrites).toBe(0);
    expect(maxActiveWrites).toBe(1);
  });

  it("sets the ZFILE binary transfer flag", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "zmodem_source_info") return { name: "source.bin", size: 0 };
      return undefined;
    });
    const writes: Uint8Array[] = [];
    const session = new ZmodemSession((bytes) => { writes.push(bytes); }, "session-a");
    await session.startSend(["/tmp/source.bin"]);
    session.consume(encodeZmodemHexHeader(1));
    await settle(session);
    const parser = new ZmodemWireParser();
    const events = parser.feed(writes[1]);
    expect(events[0]).toMatchObject({ kind: "header", header: { type: 4, position: 1 } });
  });

  it("serializes a native write before the ZEOF commit", async () => {
    const order: string[] = [];
    invokeMock.mockImplementation(async (command) => {
      if (command === "zmodem_temp_create") return "opaque-temp-handle";
      if (command === "zmodem_temp_write") { order.push("write"); return undefined; }
      if (command === "zmodem_temp_commit") { order.push("commit"); return undefined; }
      return undefined;
    });
    const session = new ZmodemSession(() => {}, "session-a");
    session.armReceive();
    session.consume(concat(
      encodeZmodemHexHeader(4, 0),
      encodeZmodemDataSubpacket(new TextEncoder().encode("file.bin\u00002 0 0 0 0 0\u0000"), 0x6b),
    ));
    await settle(session);
    await session.acceptReceive("/tmp/file.bin");
    session.consume(concat(
      encodeZmodemHexHeader(10, 0),
      encodeZmodemDataSubpacket(new Uint8Array([1, 2]), 0x68),
      encodeZmodemHexHeader(11, 2),
    ));
    await settle(session);
    expect(order).toEqual(["write", "commit"]);
    expect(session.getSnapshot().completedFiles).toBe(1);
  });

  it("cleans up an incomplete receive when the remote sends ZFIN early", async () => {
    const aborts: string[] = [];
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "zmodem_temp_create") return "opaque-temp-handle";
      if (command === "zmodem_temp_abort") {
        aborts.push((args as { tempHandle: string }).tempHandle);
        return undefined;
      }
      return undefined;
    });
    const session = new ZmodemSession(() => {}, "session-a");
    session.armReceive();
    session.consume(concat(
      encodeZmodemHexHeader(4, 0),
      encodeZmodemDataSubpacket(new TextEncoder().encode("file.bin\u00002 0 0 0 0 0\u0000"), 0x6b),
    ));
    await settle(session);
    await session.acceptReceive("/tmp/file.bin");
    session.consume(concat(
      encodeZmodemHexHeader(10, 0),
      encodeZmodemDataSubpacket(new Uint8Array([1]), 0x68),
      encodeZmodemHexHeader(8),
    ));
    await settle(session);
    expect(aborts).toEqual(["opaque-temp-handle"]);
    expect(session.getSnapshot().status).toBe("error");
  });

  it("allows only one start preparation before source metadata resolves", async () => {
    const sourceInfo = deferred<{ name: string; size: number }>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "zmodem_source_info") return sourceInfo.promise;
      return undefined;
    });
    const session = new ZmodemSession(() => {}, "session-a");
    const first = session.startSend(["/tmp/source.bin"]);
    const second = session.startSend(["/tmp/source.bin"]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    sourceInfo.resolve({ name: "source.bin", size: 0 });
    await Promise.all([first, second]);
    expect(session.getSnapshot().status).toBe("sending");
  });

  it("cancels delayed source metadata without starting a send", async () => {
    const sourceInfo = deferred<{ name: string; size: number }>();
    const writes: Uint8Array[] = [];
    invokeMock.mockImplementation(async (command) => {
      if (command === "zmodem_source_info") return sourceInfo.promise;
      return undefined;
    });
    const session = new ZmodemSession((bytes) => { writes.push(bytes); }, "session-a");
    const preparation = session.startSend(["/tmp/source.bin"]);
    expect(session.isActive()).toBe(true);
    await session.cancel();
    expect(session.isActive()).toBe(false);
    sourceInfo.resolve({ name: "source.bin", size: 0 });
    await preparation;
    expect(writes).toHaveLength(0);
    expect(session.getSnapshot().status).toBe("cancelled");
  });

  it("allows only one receive preparation before temp creation resolves", async () => {
    const tempCreated = deferred<string>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "zmodem_temp_create") return tempCreated.promise;
      return undefined;
    });
    const session = new ZmodemSession(() => {}, "session-a");
    session.armReceive();
    session.consume(concat(
      encodeZmodemHexHeader(4, 0),
      encodeZmodemDataSubpacket(new TextEncoder().encode("file.bin\u00000 0 0 0 0 0\u0000"), 0x6b),
    ));
    await settle(session);
    const first = session.acceptReceive("/tmp/file.bin");
    const second = session.acceptReceive("/tmp/file.bin");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    tempCreated.resolve("opaque-temp-handle");
    await Promise.all([first, second]);
    expect(session.getSnapshot().status).toBe("receiving");
  });

  it("cancels delayed temp creation and aborts the late handle without sending ZRPOS", async () => {
    const tempCreated = deferred<string>();
    const aborts: string[] = [];
    const writes: Uint8Array[] = [];
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "zmodem_temp_create") return tempCreated.promise;
      if (command === "zmodem_temp_abort") {
        aborts.push((args as { tempHandle: string }).tempHandle);
        return undefined;
      }
      return undefined;
    });
    const session = new ZmodemSession((bytes) => { writes.push(bytes); }, "session-a");
    session.armReceive();
    session.consume(concat(
      encodeZmodemHexHeader(4, 0),
      encodeZmodemDataSubpacket(new TextEncoder().encode("file.bin\u00000 0 0 0 0 0\u0000"), 0x6b),
    ));
    await settle(session);
    const preparation = session.acceptReceive("/tmp/file.bin");
    expect(session.isActive()).toBe(true);
    await session.cancel();
    tempCreated.resolve("late-temp-handle");
    await preparation;
    expect(aborts).toEqual(["late-temp-handle"]);
    expect(hasHeader(writes, 9)).toBe(false);
    expect(session.getSnapshot().status).toBe("cancelled");
  });

  it("routes a rejected-offer transport failure through session cleanup", async () => {
    const send = vi.fn(() => Promise.reject(new Error("transport unavailable")));
    const session = new ZmodemSession(send, "session-a");
    session.armReceive();
    session.consume(concat(
      encodeZmodemHexHeader(4, 0),
      encodeZmodemDataSubpacket(new TextEncoder().encode("file.bin\u00000 0 0 0 0 0\u0000"), 0x6b),
    ));
    await settle(session);
    await session.rejectOffer();
    expect(session.getSnapshot().status).toBe("error");
    expect(session.getSnapshot().error).toContain("transport unavailable");
  });

  it("supports a skipped offer followed by another file and handles remote CAN", async () => {
    const session = new ZmodemSession(() => {}, "session-a");
    session.armReceive();
    const offer = (name: string) => concat(
      encodeZmodemHexHeader(4, 1),
      encodeZmodemDataSubpacket(new TextEncoder().encode(`${name}\u00001 0 0 0 0 0\u0000`), 0x6b),
    );
    session.consume(offer("first.bin"));
    await settle(session);
    await session.rejectOffer();
    session.consume(offer("second.bin"));
    await settle(session);
    expect(session.getSnapshot().offer?.name).toBe("second.bin");
    session.consume(encodeZmodemHexHeader(16));
    await settle(session);
    expect(session.getSnapshot().status).toBe("cancelled");
  });

  it("routes ZFERR through cleanup and does not leak an unhandled handler rejection", async () => {
    const session = new ZmodemSession(() => {}, "session-a");
    session.armReceive();
    session.consume(encodeZmodemHexHeader(12));
    await settle(session);
    expect(session.getSnapshot().status).toBe("error");
    expect(session.getSnapshot().error).toContain("file error");
  });
});
