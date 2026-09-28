import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";

export const ZMODEM_MAX_FILE_SIZE = 256 * 1024 * 1024;
export const ZMODEM_MAX_FILE_COUNT = 10;
export const ZMODEM_MAX_NAME_LENGTH = 255;
export const ZMODEM_MAX_FRAME_BYTES = 64 * 1024;
export const ZMODEM_TIMEOUT_MS = 120_000;

const ZPAD = 0x2a;
const ZDLE = 0x18;
const ZDLEE = 0x65;
const ZRUB0 = 0x6c;
const ZRUB1 = 0x6d;
const ZBIN = 0x41;
const ZHEX = 0x42;
const ZBIN32 = 0x43;
const ZRQINIT = 0;
const ZRINIT = 1;
const ZACK = 3;
const ZFILE = 4;
const ZSKIP = 5;
const ZNAK = 6;
const ZABORT = 7;
const ZFIN = 8;
const ZRPOS = 9;
const ZDATA = 10;
const ZEOF = 11;
const ZFERR = 12;
const ZCAN = 16;
const ZCBIN = 1;
const ZCRCE = 0x68;
const ZCRCG = 0x69;
const ZCRCQ = 0x6a;
const ZCRCW = 0x6b;
const XON = 0x11;
const XOFF = 0x13;
const BACKSPACE = 0x08;

type ProtocolHeader = { type: number; position: number };
type ProtocolEvent =
  | { kind: "header"; header: ProtocolHeader }
  | { kind: "data"; data: Uint8Array; end: number };

class ZmodemProtocolError extends Error {
  constructor(message: string, readonly remoteCancellation = false) {
    super(message);
    this.name = "ZmodemProtocolError";
  }
}

export type ZmodemSupportReason = "supported" | "sshOnly" | "persistent" | "broadcast" | "platform";

export interface ZmodemSupport {
  supported: boolean;
  reason: ZmodemSupportReason;
}

export function zmodemSupport(input: {
  sessionType: "ssh" | "local" | "serial" | "multiplayer";
  persistent?: boolean;
  broadcast?: boolean;
  platform: string;
}): ZmodemSupport {
  if (input.sessionType !== "ssh") return { supported: false, reason: "sshOnly" };
  if (input.persistent) return { supported: false, reason: "persistent" };
  if (input.broadcast) return { supported: false, reason: "broadcast" };
  if (!["linux", "macos", "windows"].includes(input.platform)) return { supported: false, reason: "platform" };
  return { supported: true, reason: "supported" };
}

export function validateRemoteFilename(name: string): { ok: true; name: string } | { ok: false; reason: string } {
  if (!name || name.length > ZMODEM_MAX_NAME_LENGTH) return { ok: false, reason: "invalid filename length" };
  if (name.includes("\0") || [...name].some((char) => char < "\u0020" || char === "\u007f")) {
    return { ok: false, reason: "filename contains a control character" };
  }
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    return { ok: false, reason: "path components are not allowed" };
  }
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return { ok: false, reason: "absolute paths are not allowed" };
  const reserved = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (reserved.test(name)) return { ok: false, reason: "reserved device name" };
  return { ok: true, name };
}

export function validateZmodemLimits(size: number, count: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isSafeInteger(size) || size < 0 || size > ZMODEM_MAX_FILE_SIZE) {
    return { ok: false, reason: "file exceeds the configured size limit" };
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > ZMODEM_MAX_FILE_COUNT) {
    return { ok: false, reason: "transfer exceeds the configured file-count limit" };
  }
  return { ok: true };
}

export async function pickZmodemSources(): Promise<string[]> {
  const result = await dialogOpen({ title: "Select files to send", directory: false, multiple: true });
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

export function pickZmodemDestination(defaultPath?: string): Promise<string | null> {
  return dialogSave({ title: "Save received file", defaultPath, canCreateDirectories: false });
}

export function zmodemCrc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function hexByte(value: number): number[] {
  return [...value.toString(16).padStart(2, "0")].map((char) => char.charCodeAt(0));
}

export function encodeZmodemHexHeader(type: number, position = 0): Uint8Array {
  const body = new Uint8Array([type, position & 0xff, (position >>> 8) & 0xff, (position >>> 16) & 0xff, (position >>> 24) & 0xff]);
  const crc = zmodemCrc16(body);
  return new Uint8Array([ZPAD, ZPAD, ZDLE, ZHEX, ...[...body].flatMap(hexByte), ...hexByte(crc >>> 8), ...hexByte(crc & 0xff), 0x0d, 0x0a]);
}

function needsZmodemQuote(byte: number): boolean {
  return byte < 0x20 || byte === 0x7f || byte === 0xff || byte === ZDLE || (byte >= 0x80 && byte <= 0x9f);
}

export function encodeZmodemQuoted(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (const byte of bytes) {
    if (byte === 0x7f) out.push(ZDLE, ZRUB0);
    else if (byte === 0xff) out.push(ZDLE, ZRUB1);
    else if (byte === ZDLE) out.push(ZDLE, ZDLEE);
    else if (needsZmodemQuote(byte)) out.push(ZDLE, byte ^ 0x40);
    else out.push(byte);
  }
  return new Uint8Array(out);
}

export function encodeZmodemBinaryHeader(type: number, position = 0): Uint8Array {
  const body = new Uint8Array([type, position & 0xff, (position >>> 8) & 0xff, (position >>> 16) & 0xff, (position >>> 24) & 0xff]);
  const crc = zmodemCrc16(body);
  return new Uint8Array([ZPAD, ZDLE, ZBIN, ...encodeZmodemQuoted(body), ...encodeZmodemQuoted(new Uint8Array([crc >>> 8, crc & 0xff]))]);
}

export function encodeZmodemDataSubpacket(data: Uint8Array, end: number): Uint8Array {
  if (data.length > ZMODEM_MAX_FRAME_BYTES) throw new Error("Zmodem frame exceeds the safety limit");
  const crcInput = new Uint8Array(data.length + 1);
  crcInput.set(data);
  crcInput[data.length] = end;
  const crc = zmodemCrc16(crcInput);
  return new Uint8Array([...encodeZmodemQuoted(data), ZDLE, end, ...encodeZmodemQuoted(new Uint8Array([crc >>> 8, crc & 0xff]))]);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function sendHeader(type: number, position = 0): Uint8Array { return encodeZmodemHexHeader(type, position); }

export function zmodemCancelSequence(): Uint8Array {
  return new Uint8Array([ZDLE, ZDLE, ZDLE, ZDLE, ZDLE, BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE]);
}

/**
 * The raw-byte seam used before TextDecoder and xterm. It is deliberately
 * inert until a user arms Receive or starts Send. A protocol-looking prefix
 * is buffered only while armed; ordinary bytes are returned byte-for-byte.
 */
export class ZmodemByteDemux {
  private armed = false;
  private protocol = false;
  private candidate: number[] = [];

  arm(): void { this.armed = true; this.protocol = false; this.candidate = []; }
  enterProtocol(): void { this.armed = true; this.protocol = true; this.candidate = []; }
  reset(): void { this.armed = false; this.protocol = false; this.candidate = []; }
  isProtocol(): boolean { return this.protocol; }

  feed(input: Uint8Array): { terminal: Uint8Array; protocol: Uint8Array; detected: boolean } {
    if (!this.armed) return { terminal: input, protocol: new Uint8Array(), detected: false };
    if (this.protocol) return { terminal: new Uint8Array(), protocol: input, detected: false };

    const terminal: number[] = [];
    const protocol: number[] = [];
    let detected = false;
    for (const byte of input) {
      if (this.protocol) { protocol.push(byte); continue; }
      if (this.candidate.length === 0) {
        if (byte === ZPAD) this.candidate.push(byte);
        else terminal.push(byte);
        continue;
      }
      const padCount = this.candidate.findIndex((value) => value !== ZPAD);
      if (padCount < 0) {
        if (byte === ZPAD) { this.candidate.push(byte); continue; }
        if (byte === ZDLE) { this.candidate.push(byte); continue; }
        terminal.push(...this.candidate);
        this.candidate = byte === ZPAD ? [byte] : [];
        if (this.candidate.length === 0) terminal.push(byte);
        continue;
      }
      if (this.candidate.length === padCount + 1 && this.candidate[padCount] === ZDLE) {
        if (byte === ZHEX || byte === ZBIN || byte === ZBIN32) {
          this.candidate.push(byte);
          protocol.push(...this.candidate);
          this.candidate = [];
          this.protocol = true;
          detected = true;
        } else {
          terminal.push(...this.candidate);
          this.candidate = byte === ZPAD ? [byte] : [];
          if (this.candidate.length === 0) terminal.push(byte);
        }
        continue;
      }
      terminal.push(...this.candidate, byte);
      this.candidate = byte === ZPAD ? [byte] : [];
    }
    return { terminal: new Uint8Array(terminal), protocol: new Uint8Array(protocol), detected };
  }
}

type DecodedValue = { value: number | null; next: number };

export class ZmodemWireParser {
  private buffer = new Uint8Array();
  private mode: "header" | "data" = "header";

  reset(): void { this.buffer = new Uint8Array(); this.mode = "header"; }
  setDataMode(): void { this.mode = "data"; }

  feed(input: Uint8Array): ProtocolEvent[] {
    this.buffer = concatBytes(this.buffer, input) as Uint8Array<ArrayBuffer>;
    if (this.buffer.length > ZMODEM_MAX_FRAME_BYTES * 2) throw new Error("Zmodem input buffer exceeds the safety limit");
    for (let index = 0; index + 4 < this.buffer.length; index += 1) {
      if (this.buffer[index] === ZDLE && this.buffer[index + 1] === ZDLE && this.buffer[index + 2] === ZDLE && this.buffer[index + 3] === ZDLE && this.buffer[index + 4] === ZDLE) {
        throw new ZmodemProtocolError("Zmodem transfer cancelled by the remote", true);
      }
    }
    const events: ProtocolEvent[] = [];
    while (this.buffer.length) {
      const event = this.mode === "data" ? this.parseData() : this.parseHeader();
      if (!event) break;
      events.push(event);
    }
    return events;
  }

  private headerStart(): { format: number } | null {
    let padCount = 0;
    while (padCount < this.buffer.length && this.buffer[padCount] === ZPAD) padCount += 1;
    if (padCount === 0 || this.buffer[padCount] !== ZDLE || padCount + 1 >= this.buffer.length) return null;
    const format = padCount + 1;
    if (![ZHEX, ZBIN, ZBIN32].includes(this.buffer[format])) return null;
    return { format };
  }

  private parseHeader(): ProtocolEvent | null {
    let start = -1;
    for (let index = 0; index + 2 < this.buffer.length; index += 1) {
      if (this.buffer[index] !== ZPAD) continue;
      let padEnd = index;
      while (padEnd < this.buffer.length && this.buffer[padEnd] === ZPAD) padEnd += 1;
      if (padEnd + 1 < this.buffer.length && this.buffer[padEnd] === ZDLE && [ZHEX, ZBIN, ZBIN32].includes(this.buffer[padEnd + 1])) {
        start = index;
        break;
      }
      index = padEnd;
    }
    if (start < 0) {
      this.buffer = this.buffer.slice(Math.max(0, this.buffer.length - 3));
      return null;
    }
    if (start > 0) this.buffer = this.buffer.slice(start);
    const header = this.headerStart();
    if (!header) return null;
    const format = header.format;
    if (this.buffer[format] === ZHEX) {
      const digitsStart = format + 1;
      const digitsEnd = digitsStart + 14;
      if (this.buffer.length < digitsEnd) return null;
      const digits = this.buffer.slice(digitsStart, digitsEnd);
      if (![...digits].every((byte) => /[0-9a-f]/i.test(String.fromCharCode(byte)))) throw new Error("invalid Zmodem hexadecimal header");
      const values: number[] = [];
      for (let index = 0; index < 14; index += 2) values.push(Number.parseInt(String.fromCharCode(digits[index], digits[index + 1]), 16));
      const expected = (values[5] << 8) | values[6];
      if (zmodemCrc16(new Uint8Array(values.slice(0, 5))) !== expected) throw new Error("invalid Zmodem header CRC");
      let consumed = digitsEnd;
      if (this.buffer[consumed] === 0x0d && this.buffer[consumed + 1] === 0x0a) consumed += 2;
      this.buffer = this.buffer.slice(consumed);
      this.updateModeAfterHeader(values[0]);
      return { kind: "header", header: { type: values[0], position: this.position(values) } };
    }
    if (this.buffer[format] === ZBIN32) throw new Error("32-bit CRC Zmodem frames are not supported in this release");
    const decoded = this.readDecodedValues(format + 1, 7);
    if (!decoded) return null;
    const values = decoded.values;
    if (zmodemCrc16(new Uint8Array(values.slice(0, 5))) !== ((values[5] << 8) | values[6])) throw new Error("invalid Zmodem binary header CRC");
    this.buffer = this.buffer.slice(decoded.next);
    this.updateModeAfterHeader(values[0]);
    return { kind: "header", header: { type: values[0], position: this.position(values) } };
  }

  private readDecodedValues(start: number, count: number): { values: number[]; next: number } | null {
    const values: number[] = [];
    let index = start;
    while (values.length < count) {
      if (index >= this.buffer.length) return null;
      const decoded = this.decodeValue(index);
      if (!decoded) return null;
      if (decoded.value !== null) values.push(decoded.value);
      index = decoded.next;
    }
    return { values, next: index };
  }

  private decodeValue(index: number): DecodedValue | null {
    const byte = this.buffer[index];
    if (byte === XON || byte === XOFF) return { value: null, next: index + 1 };
    if (byte !== ZDLE) return { value: byte, next: index + 1 };
    if (index + 1 >= this.buffer.length) return null;
    const escaped = this.buffer[index + 1];
    if (escaped === ZRUB0) return { value: 0x7f, next: index + 2 };
    if (escaped === ZRUB1) return { value: 0xff, next: index + 2 };
    if (escaped === ZDLEE) return { value: ZDLE, next: index + 2 };
    if ((escaped & 0x60) === 0x40) return { value: escaped ^ 0x40, next: index + 2 };
    if (escaped === ZDLE) throw new ZmodemProtocolError("invalid Zmodem escape");
    throw new ZmodemProtocolError("invalid Zmodem escape");
  }

  private parseData(): ProtocolEvent | null {
    const data: number[] = [];
    let index = 0;
    while (index < this.buffer.length) {
      const byte = this.buffer[index];
      if (byte === XON || byte === XOFF) { index += 1; continue; }
      if (byte !== ZDLE) {
        data.push(byte);
        index += 1;
        if (data.length > ZMODEM_MAX_FRAME_BYTES) throw new Error("Zmodem data frame exceeds the safety limit");
        continue;
      }
      if (index + 1 >= this.buffer.length) return null;
      const end = this.buffer[index + 1];
      if ([ZCRCE, ZCRCG, ZCRCQ, ZCRCW].includes(end)) {
        const crc = this.readDecodedValues(index + 2, 2);
        if (!crc) return null;
        const crcInput = new Uint8Array(data.length + 1);
        crcInput.set(data); crcInput[data.length] = end;
        if (zmodemCrc16(crcInput) !== ((crc.values[0] << 8) | crc.values[1])) throw new Error("invalid Zmodem data CRC");
        this.buffer = this.buffer.slice(crc.next);
        this.mode = end === ZCRCG || end === ZCRCQ ? "data" : "header";
        return { kind: "data", data: new Uint8Array(data), end };
      }
      const decoded = this.decodeValue(index);
      if (!decoded) return null;
      if (decoded.value !== null) data.push(decoded.value);
      index = decoded.next;
      if (data.length > ZMODEM_MAX_FRAME_BYTES) throw new Error("Zmodem data frame exceeds the safety limit");
    }
    return null;
  }

  private updateModeAfterHeader(type: number): void {
    if (type === ZFILE || type === ZDATA) this.mode = "data";
  }

  private position(values: number[]): number {
    return (values[1] | (values[2] << 8) | (values[3] << 16) | (values[4] << 24)) >>> 0;
  }
}

export interface ZmodemOffer { name: string; size: number; count: number }
export type ZmodemStatus = "idle" | "armed" | "offer" | "receiving" | "sending" | "done" | "rejected" | "cancelled" | "error";
export interface ZmodemSnapshot {
  status: ZmodemStatus;
  offer: ZmodemOffer | null;
  completedFiles: number;
  totalFiles: number;
  transferredBytes: number;
  totalBytes: number;
  error: string | null;
}

type SourceInfo = { name: string; size: number };
type SourceFile = SourceInfo & { path: string };
type SendBytes = (bytes: Uint8Array) => Promise<void> | void;

export class ZmodemSession {
  private readonly demux = new ZmodemByteDemux();
  private readonly parser = new ZmodemWireParser();
  private readonly listeners = new Set<() => void>();
  private readonly send: SendBytes;
  private readonly sessionId: string;
  private eventQueue: Promise<void> = Promise.resolve();
  private snapshot: ZmodemSnapshot = { status: "idle", offer: null, completedFiles: 0, totalFiles: 0, transferredBytes: 0, totalBytes: 0, error: null };
  private receiveCount = 0;
  private pendingOffer: ZmodemOffer | null = null;
  private tempHandle: string | null = null;
  private receiveBytes = 0;
  private expectingFileInfo = false;
  private destination: string | null = null;
  private sources: SourceFile[] = [];
  private sourceIndex = 0;
  private sourceOffset = 0;
  private sendingData = false;
  private preparing = false;
  private operationGeneration = 0;
  private cancellationRequested = false;
  private cancelOperation: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(send: SendBytes, sessionId = "") { this.send = send; this.sessionId = sessionId; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getSnapshot(): ZmodemSnapshot { return this.snapshot; }
  isActive(): boolean { return this.preparing || this.isProtocolActive(); }
  private isProtocolActive(): boolean { return this.demux.isProtocol() || ["armed", "offer", "receiving", "sending"].includes(this.snapshot.status); }
  private isBusy(): boolean { return this.preparing || this.tempHandle !== null || this.cancelOperation !== null || this.isProtocolActive(); }
  async flush(): Promise<void> { await this.eventQueue; }

  armReceive(): void {
    if (this.isBusy() || this.cancellationRequested) return;
    this.resetState("armed");
    this.demux.arm();
    this.armTimeout();
  }

  async startSend(paths: string[]): Promise<void> {
    if (this.isBusy() || this.cancellationRequested || !paths.length || paths.length > ZMODEM_MAX_FILE_COUNT) return;
    const operation = ++this.operationGeneration;
    this.preparing = true;
    try {
      const prepared = await Promise.all(paths.map(async (path): Promise<SourceFile | null> => {
        const info = await invoke<SourceInfo>("zmodem_source_info", { path });
        if (operation !== this.operationGeneration) return null;
        const validName = validateRemoteFilename(info.name);
        if (!validName.ok) throw new Error("selected file has an unsafe name");
        const validSize = validateZmodemLimits(info.size, paths.length);
        if (!validSize.ok) throw new Error(validSize.reason);
        return { path, name: validName.name, size: info.size };
      }));
      if (operation !== this.operationGeneration) return;
      const sources = prepared.filter((source): source is SourceFile => source !== null);
      this.sources = sources;
      this.sourceIndex = 0;
      this.sourceOffset = 0;
      this.snapshot = { status: "sending", offer: null, completedFiles: 0, totalFiles: sources.length, transferredBytes: 0, totalBytes: sources.reduce((sum, source) => sum + source.size, 0), error: null };
      this.demux.arm();
      this.armTimeout();
      this.notify();
      this.preparing = false;
      if (operation !== this.operationGeneration) return;
      await this.write(new TextEncoder().encode("rz\r"));
    } catch (error) {
      if (operation !== this.operationGeneration) return;
      await this.fail(error instanceof Error ? error.message : "Could not prepare the selected files");
    } finally {
      if (operation === this.operationGeneration) this.preparing = false;
    }
  }

  async acceptReceive(destination: string): Promise<void> {
    if (this.preparing || !this.pendingOffer || this.snapshot.status !== "offer") return;
    const operation = ++this.operationGeneration;
    this.preparing = true;
    try {
      const tempHandle = await invoke<string>("zmodem_temp_create", { sessionId: this.sessionId, destination });
      if (operation !== this.operationGeneration) {
        await this.abortTempHandle(tempHandle);
        return;
      }
      this.tempHandle = tempHandle;
      this.receiveBytes = 0;
      this.snapshot = { ...this.snapshot, status: "receiving", error: null };
      this.notify();
      if (operation !== this.operationGeneration) return;
      this.destination = destination;
      this.preparing = false;
      await this.write(sendHeader(ZRPOS, 0));
    } catch (error) {
      if (operation !== this.operationGeneration) return;
      await this.fail(error instanceof Error ? error.message : "Could not create a temporary file");
    } finally {
      if (operation === this.operationGeneration) this.preparing = false;
    }
  }

  async rejectOffer(): Promise<void> {
    if (this.preparing || !this.pendingOffer) return;
    this.pendingOffer = null;
    this.expectingFileInfo = false;
    this.snapshot = { ...this.snapshot, status: "rejected", offer: null };
    this.notify();
    try {
      await this.write(sendHeader(ZSKIP));
    } catch (error) {
      await this.fail(error instanceof Error ? error.message : "Could not reject the Zmodem offer");
      return;
    }
    if (this.cancellationRequested || this.snapshot.status === "cancelled" || this.snapshot.status === "error") return;
    this.snapshot = { ...this.snapshot, status: "armed" };
    this.notify();
  }

  async cancel(): Promise<void> {
    if (this.cancelOperation) return this.cancelOperation;
    if (!this.isBusy()) return;
    const protocolActive = this.isProtocolActive();
    this.cancellationRequested = true;
    this.operationGeneration += 1;
    this.preparing = false;
    this.cancelOperation = (async () => {
      if (protocolActive) await this.write(zmodemCancelSequence(), true).catch(() => {});
      await this.cleanupTemp();
      this.finish("cancelled", null);
      this.eventQueue.then(() => {
        this.cancellationRequested = false;
        this.cancelOperation = null;
      }, () => {
        this.cancellationRequested = false;
        this.cancelOperation = null;
      });
    })();
    return this.cancelOperation;
  }

  consume(input: Uint8Array): Uint8Array {
    const split = this.demux.feed(input);
    if (input.length && this.isActive()) this.armTimeout();
    if (split.protocol.length) {
      try {
        for (const event of this.parser.feed(split.protocol)) this.enqueue(event);
      } catch (error) {
        this.enqueueFailure(error instanceof Error ? error.message : "Malformed Zmodem data", error instanceof ZmodemProtocolError && error.remoteCancellation);
      }
    }
    return split.terminal;
  }

  private enqueue(event: ProtocolEvent): void {
    this.eventQueue = this.eventQueue.then(async () => {
      if (!this.isActive() || this.snapshot.status === "error" || this.snapshot.status === "cancelled") return;
      await this.handle(event);
    }).catch(async (error) => {
      await this.fail(error instanceof Error ? error.message : "Malformed Zmodem data");
    });
  }

  private enqueueFailure(message: string, remoteCancellation: boolean): void {
    this.eventQueue = this.eventQueue.then(() => this.fail(message, !remoteCancellation, remoteCancellation));
  }

  private async handle(event: ProtocolEvent): Promise<void> {
    if (this.cancellationRequested) return;
    if (event.kind === "data") {
      if (this.expectingFileInfo) {
        this.expectingFileInfo = false;
        const metadata = new TextDecoder().decode(event.data);
        const separator = metadata.indexOf("\0");
        const name = separator < 0 ? "" : metadata.slice(0, separator);
        const sizeText = separator < 0 ? "" : metadata.slice(separator + 1).split(/\s+/)[0];
        const size = Number(sizeText);
        const validName = validateRemoteFilename(name);
        const validLimits = validateZmodemLimits(size, this.receiveCount + 1);
        if (!validName.ok || !validLimits.ok) {
          this.snapshot = { ...this.snapshot, status: "armed", error: !validName.ok ? validName.reason : validLimits.ok ? "" : validLimits.reason };
          this.notify();
          await this.write(sendHeader(ZSKIP));
          return;
        }
        this.receiveCount += 1;
        this.pendingOffer = { name: validName.name, size, count: this.receiveCount };
        this.snapshot = { ...this.snapshot, status: "offer", offer: this.pendingOffer, totalFiles: this.receiveCount, totalBytes: this.snapshot.totalBytes + size };
        this.notify();
        return;
      }
      if (this.snapshot.status === "receiving" && this.tempHandle) {
        this.receiveBytes += event.data.length;
        if (this.receiveBytes > (this.pendingOffer?.size ?? ZMODEM_MAX_FILE_SIZE)) throw new Error("received data exceeds the offered size");
        await invoke("zmodem_temp_write", { sessionId: this.sessionId, tempHandle: this.tempHandle, data: Array.from(event.data) });
        this.snapshot = { ...this.snapshot, transferredBytes: this.receiveBytes };
        this.notify();
        if (event.end === ZCRCQ || event.end === ZCRCW) await this.write(sendHeader(ZACK, this.receiveBytes));
      }
      return;
    }

    const { type, position } = event.header;
    if ([ZCAN, ZABORT].includes(type)) {
      await this.fail(type === ZCAN ? "Zmodem transfer cancelled by the remote" : "Zmodem transfer aborted by the remote", false, type === ZCAN);
      return;
    }
    if (type === ZFERR) { await this.fail("The remote reported a Zmodem file error"); return; }

    if (this.snapshot.status === "sending") {
      if (type === ZRINIT) await this.sendCurrentFile();
      else if (type === ZRPOS) await this.sendCurrentData(position);
      else if (type === ZSKIP) {
        this.sourceIndex += 1;
        this.snapshot = { ...this.snapshot, completedFiles: Math.min(this.sources.length, this.snapshot.completedFiles + 1) };
        await this.sendCurrentFile();
      } else if (type === ZNAK) await this.sendCurrentFile();
      else if (type === ZFIN) await this.completeProtocol();
      return;
    }

    if (type === ZRQINIT) { await this.write(sendHeader(ZRINIT)); return; }
    if (type === ZFILE) { this.expectingFileInfo = true; return; }
    if (type === ZDATA) return;
    if (type === ZSKIP) {
      this.pendingOffer = null;
      this.expectingFileInfo = false;
      this.snapshot = { ...this.snapshot, status: "armed", offer: null };
      this.notify();
      return;
    }
    if (type === ZNAK) { await this.write(sendHeader(ZRINIT)); return; }
    if (type === ZEOF && this.snapshot.status === "receiving") {
      if (this.receiveBytes !== this.pendingOffer?.size) throw new Error("received size does not match the offer");
      const destination = this.destination;
      const tempHandle = this.tempHandle;
      if (!destination || !tempHandle) throw new Error("missing receive destination");
      await invoke("zmodem_temp_commit", { sessionId: this.sessionId, tempHandle, destination });
      this.tempHandle = null; this.pendingOffer = null; this.destination = null;
      this.snapshot = { ...this.snapshot, status: "armed", offer: null, completedFiles: this.snapshot.completedFiles + 1 };
      this.demux.enterProtocol();
      this.notify();
      await this.write(sendHeader(ZRINIT));
      return;
    }
    if (type === ZFIN) {
      if (this.snapshot.status === "receiving" || this.tempHandle) {
        await this.fail("Remote ended the Zmodem transfer before the received file was complete", false);
        return;
      }
      await this.completeProtocol();
    }
  }

  private async sendCurrentFile(): Promise<void> {
    const source = this.sources[this.sourceIndex];
    if (this.cancellationRequested) return;
    if (!source) { await this.write(sendHeader(ZFIN)); return; }
    this.sourceOffset = 0;
    const metadata = new TextEncoder().encode(`${source.name}\0${source.size} 0 0 0 0 0\0`);
    await this.write(concatBytes(sendHeader(ZFILE, ZCBIN), encodeZmodemDataSubpacket(metadata, ZCRCW)));
  }

  private async sendCurrentData(position: number): Promise<void> {
    if (this.sendingData) return;
    if (this.cancellationRequested) return;
    const source = this.sources[this.sourceIndex];
    if (!source || position > source.size) throw new Error("remote requested an invalid file position");
    this.sendingData = true;
    this.sourceOffset = position;
    try {
      await this.write(sendHeader(ZDATA, position));
      if (this.cancellationRequested) return;
      if (source.size === position) {
        await this.write(encodeZmodemDataSubpacket(new Uint8Array(), ZCRCE));
      } else {
        while (this.sourceOffset < source.size) {
          if (this.cancellationRequested) return;
          const length = Math.min(ZMODEM_MAX_FRAME_BYTES, source.size - this.sourceOffset);
          const data = await invoke<number[]>("zmodem_source_read", { path: source.path, offset: this.sourceOffset, length });
          if (this.cancellationRequested) return;
          const bytes = new Uint8Array(data);
          if (!bytes.length || bytes.length > length) throw new Error("source file changed during transfer");
          this.sourceOffset += bytes.length;
          const isLast = this.sourceOffset >= source.size;
          await this.write(encodeZmodemDataSubpacket(bytes, isLast ? ZCRCE : ZCRCG));
          if (this.cancellationRequested) return;
          this.snapshot = { ...this.snapshot, transferredBytes: this.snapshot.transferredBytes + bytes.length };
          this.notify();
        }
      }
      if (this.cancellationRequested) return;
      await this.write(sendHeader(ZEOF, this.sourceOffset));
      if (this.cancellationRequested) return;
      this.sourceIndex += 1;
      this.snapshot = { ...this.snapshot, completedFiles: this.snapshot.completedFiles + 1 };
      this.notify();
    } finally { this.sendingData = false; }
  }

  private async completeProtocol(): Promise<void> {
    if (this.cancellationRequested) return;
    await this.write(new Uint8Array([0x4f, 0x4f]));
    if (this.cancellationRequested) return;
    this.finish("done", null);
  }

  private resetState(status: ZmodemStatus): void {
    this.snapshot = { status, offer: null, completedFiles: 0, totalFiles: 0, transferredBytes: 0, totalBytes: 0, error: null };
    this.pendingOffer = null; this.sources = []; this.tempHandle = null; this.receiveBytes = 0; this.destination = null; this.expectingFileInfo = false; this.receiveCount = 0;
    this.parser.reset(); this.notify();
  }

  private async fail(message: string, sendCancel = true, cancelled = false): Promise<void> {
    if (this.preparing) {
      this.operationGeneration += 1;
      this.preparing = false;
    }
    if (this.cancellationRequested) {
      await this.cleanupTemp();
      this.finish("cancelled", message);
      return;
    }
    const protocolActive = this.isActive();
    if (sendCancel && protocolActive) await this.write(zmodemCancelSequence(), true).catch(() => {});
    await this.cleanupTemp();
    this.finish(cancelled ? "cancelled" : "error", message);
  }

  private async cleanupTemp(): Promise<void> {
    if (!this.tempHandle) return;
    const handle = this.tempHandle;
    try {
      await this.abortTempHandle(handle);
      if (this.tempHandle === handle) this.tempHandle = null;
    } catch {
      // Keep the opaque handle so a later cancellation can retry native cleanup.
    }
  }

  private async abortTempHandle(handle: string): Promise<void> {
    await invoke("zmodem_temp_abort", { sessionId: this.sessionId, tempHandle: handle });
  }

  private write(bytes: Uint8Array, allowAfterCancellation = false): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      if (this.cancellationRequested && !allowAfterCancellation) return;
      await this.send(bytes);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  private finish(status: ZmodemStatus, error: string | null): void {
    this.demux.reset();
    this.parser.reset();
    this.clearTimeout();
    this.pendingOffer = null;
    this.expectingFileInfo = false;
    this.destination = null;
    this.sources = [];
    this.sourceIndex = 0;
    this.sourceOffset = 0;
    this.snapshot = { ...this.snapshot, status, offer: null, error };
    this.notify();
  }

  private armTimeout(): void {
    this.clearTimeout();
    this.timeout = setTimeout(() => {
      if (!this.isActive()) return;
      this.enqueueFailure("Zmodem transfer timed out", false);
    }, ZMODEM_TIMEOUT_MS);
  }

  private clearTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
}

const sessions = new Map<string, ZmodemSession>();
export function getZmodemSession(sessionId: string, send?: SendBytes): ZmodemSession | null {
  if (!sessions.has(sessionId) && send) sessions.set(sessionId, new ZmodemSession(send, sessionId));
  return sessions.get(sessionId) ?? null;
}
export function disposeZmodemSession(sessionId: string): void { sessions.delete(sessionId); }
