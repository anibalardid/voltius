import { attachTerminalClipboard, type TerminalClipboardHandle } from "@/components/terminal/terminalClipboard";
import { useEffect, useRef, useCallback } from "react";
import { Terminal, type IBufferCell, type IBufferRange, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createWebglAddon } from "@/utils/webglAddon";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onSshOutput, onSshRestoreOutput, onSshClosed, onSshCwd, sshListRemoteDir } from "@/services/ssh";
import { localReady, onLocalOutput, onLocalClosed } from "@/services/local";
import { onSerialOutput, onSerialClosed } from "@/services/serial";
import { sendSessionInput as sendSessionInputRaw, sendSessionResize } from "@/services/sessionInput";
import { log } from "@/lib/logger";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { getToggle, useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { matchShortcut } from "@/stores/shortcutStore";
import { matchPanelShortcut } from "@/hooks/panelShortcuts";
import { useSessionStore } from "@/stores/sessionStore";
import type { SessionCloseIntent } from "@/stores/reconnectBackoffCore";
import { useTerminalCwdStore } from "@/stores/terminalCwdStore";
import { broadcastActiveForSession, findLeaf, getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { broadcastTargets } from "@/services/broadcast";
import { useCommandHistoryStore } from "@/stores/commandHistoryStore";
import { consumeLatchForChar } from "@/stores/modifierLatchStore";
import { sampleLineDensities, scrollDeltaForRatio, type TerminalMinimapCell, type TerminalMinimapSample } from "@/components/terminal/minimapMath";
import { wheelToRows } from "@/components/terminal/terminalWheelCore";
import { keyToBytes } from "@/services/terminalKeyCore";
import { handleDuplicateShortcut } from "@/services/duplicateSession";
import { recordSessionOutput } from "@/services/sessionLogging";
import {
  notifyTerminalLifecycle,
  resetTerminalLifecycleNotifications,
  type LifecycleNotification,
} from "@/services/terminalLifecycleNotifications";
import type { TerminalTheme } from "@/themes/types";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { terminalFontStack } from "@/utils/fontStack";
import { applyTerminalTheme, clampTerminalLineHeight, subscribeTerminalCursor, subscribeTerminalTheme } from "@/utils/terminalTheme";
import { getPlatform } from "@/utils/platform";
import {
  applyOsc133Marker,
  createOsc133State,
  parseOsc133,
  resetOsc133State,
  type CommandBlock,
  type Osc133State,
} from "@/services/osc133";
import {
  getLocalSuggestions,
  suggestionInsertInput,
  type TerminalSuggestion,
} from "@/services/terminalSuggestions";
import {
  canRequestRemoteCompletion,
  isRemoteResultCurrent,
  remoteCompletionContextFingerprint,
  requestRemotePathSuggestions,
  type RemoteCompletionContext,
} from "@/services/remotePathCompletion";
import { disposeZmodemSession, getZmodemSession, type ZmodemSession } from "@/services/zmodem";

interface UseTerminalOptions {
  sessionId: string;
  sessionType: "ssh" | "local" | "serial";
  onClosed?: (remoteExit: boolean, closeIntent?: SessionCloseIntent) => void;
  /** If provided, input is only sent to the process when this returns true. */
  inputGate?: React.RefObject<() => boolean>;
  encoding?: string;
  onResize?: (cols: number, rows: number) => void;
}

/** The interactive terminal must never reject on a dropped keystroke; the
 *  shared helper rejects, so the swallow lives here at the call site — logged,
 *  not silent, since a rejected transport write is a real symptom. */
function sendSessionInput(sessionId: string, sessionType: "ssh" | "local" | "serial", data: Uint8Array) {
  void sendSessionInputRaw(sessionId, sessionType, data).catch((err) => {
    log.debug(`terminal input write failed for ${sessionType} session ${sessionId}`, err);
  });
}

/** Same contract as `sendSessionInput` for the resize path: a resize aimed at a
 *  session the backend hasn't registered yet (the terminal mounts while the
 *  transport is still connecting) must not surface as an unhandled rejection. */
function sendResize(sessionId: string, sessionType: "ssh" | "local" | "serial", cols: number, rows: number) {
  void sendSessionResize(sessionId, sessionType, cols, rows).catch((err) => {
    log.debug(`terminal resize failed for ${sessionType} session ${sessionId}`, err);
  });
}

function isHttpUrl(uri: string) {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Single opener for every link path in a terminal: the regex matcher
// (WebLinksAddon), OSC 8 hyperlinks (linkHandler), and the alt+click capture
// that runs while a TUI holds the mouse.
function openTerminalLink(event: MouseEvent, uri: string) {
  if (!event.altKey || !isHttpUrl(uri)) return;
  openUrl(uri).catch(() => {});
}

function focusPaneInDirection(direction: "left" | "right" | "up" | "down") {
  const layout = useLayoutStore.getState();
  if (!layout.activePaneId) return;
  const activeEl = document.querySelector<HTMLElement>(`[data-pane-id="${layout.activePaneId}"]`);
  if (!activeEl) return;
  const activeRect = activeEl.getBoundingClientRect();
  const activeCenter = { x: activeRect.left + activeRect.width / 2, y: activeRect.top + activeRect.height / 2 };
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-pane-id]")).filter((el) => el.dataset.paneId !== layout.activePaneId);

  let best: { paneId: string; distance: number } | null = null;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const dx = center.x - activeCenter.x;
    const dy = center.y - activeCenter.y;
    if (direction === "left" && dx >= 0) continue;
    if (direction === "right" && dx <= 0) continue;
    if (direction === "up" && dy >= 0) continue;
    if (direction === "down" && dy <= 0) continue;
    const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const distance = primary * primary + secondary * secondary * 2;
    if (!best || distance < best.distance) best = { paneId: el.dataset.paneId!, distance };
  }

  if (!best) return;
  const leaf = findLeaf(layout.root, best.paneId);
  if (!leaf) return;
  layout.setActivePane(leaf.id);
  useSessionStore.getState().setActive(leaf.sessionId);
}

// ─── Module-level terminal cache ──────────────────────────────────────────────
// Xterm instances are keyed by sessionId and survive component remounts.
// This prevents the scrollback buffer from being wiped when pane layouts change.

export interface TerminalSearchSnapshot {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  resultIndex: number;  // -1 when no active match
  resultCount: number;
  invalidRegex: boolean;
  /** Increments on every open() call so the input can re-focus + select-all even when already open. */
  focusTick: number;
}

interface SearchState {
  snapshot: TerminalSearchSnapshot;
  subscribers: Set<() => void>;
}

export interface TerminalMinimapSnapshot {
  bufferLength: number;
  viewportY: number;
  baseY: number;
  rows: number;
  cols: number;
  version: number;
}

interface MinimapState {
  snapshot: TerminalMinimapSnapshot;
  subscribers: Set<() => void>;
  frame: number | null;
}

interface BlockState {
  state: Osc133State;
  markers: Map<number, IMarker>;
  subscribers: Set<() => void>;
}

interface DraftState {
  text: string;
  trusted: boolean;
  cursorAtEnd: boolean;
}

export interface TerminalSuggestionSnapshot {
  open: boolean;
  suggestions: TerminalSuggestion[];
  selectedIndex: number;
  draft: string;
}

interface SuggestionState {
  snapshot: TerminalSuggestionSnapshot;
  subscribers: Set<() => void>;
  generation: number;
}

export interface TerminalMinimapController {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => TerminalMinimapSnapshot;
  sample: (height: number) => TerminalMinimapSample[];
  scrollToRatio: (ratio: number) => void;
  focus: () => void;
}

type CacheEntry = {
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  search: SearchState;
  minimap: MinimapState;
  sessionType: "ssh" | "local" | "serial";
  connectedRef: { current: boolean };
  /** Clipboard handle of the mount this terminal is currently attached to. Lives
   *  on the entry, not on the hook: a mount that switches session keeps its refs,
   *  so a hook-owned handle would send this terminal's Ctrl+V to the new session. */
  clip: TerminalClipboardHandle | null;
  /** Mirror of the useTerminal `inputGate` so module-level senders (writeToSession)
   *  honor the same multiplayer control-holder gate as the onData handler. */
  inputGateRef: { current: (() => boolean) | undefined };
  onClosedRef: { current: ((remoteExit: boolean, closeIntent?: SessionCloseIntent) => void) | undefined };
  onResizeRef: { current: ((cols: number, rows: number) => void) | undefined };
  lifecycleEventSequence: number;
  blocks: BlockState;
  draft: DraftState;
  intentionalShellExit: boolean;
  zmodem: ZmodemSession | null;
  suggestions: SuggestionState;
  suppressOsc133Writes: number;
  dispose: () => void; // full teardown, called only when the session is deleted
};

const terminalCache = new Map<string, CacheEntry>();

// ─── Search controller (module-level, callable from anywhere) ────────────────

const EMPTY_SNAPSHOT: TerminalSearchSnapshot = {
  open: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  resultIndex: -1,
  resultCount: 0,
  invalidRegex: false,
  focusTick: 0,
};

function notifySearch(entry: CacheEntry) {
  entry.search.subscribers.forEach((fn) => fn());
}

function minimapSnapshot(entry: CacheEntry): TerminalMinimapSnapshot {
  const buffer = entry.terminal.buffer.active;
  return {
    bufferLength: buffer.length,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    rows: entry.terminal.rows,
    cols: entry.terminal.cols,
    version: entry.minimap.snapshot.version + 1,
  };
}

function notifyMinimap(entry: CacheEntry) {
  entry.minimap.snapshot = minimapSnapshot(entry);
  entry.minimap.subscribers.forEach((fn) => fn());
}

function notifyBlocks(entry: CacheEntry): void {
  entry.blocks.subscribers.forEach((fn) => fn());
}

function notifySuggestions(entry: CacheEntry): void {
  entry.suggestions.subscribers.forEach((fn) => fn());
}

const EMPTY_SUGGESTION_SNAPSHOT: TerminalSuggestionSnapshot = {
  open: false,
  suggestions: [],
  selectedIndex: 0,
  draft: "",
};

function invalidateDraft(entry: CacheEntry): void {
  entry.suggestions.generation += 1;
  entry.draft.trusted = false;
  entry.draft.cursorAtEnd = false;
  entry.suggestions.snapshot = { ...EMPTY_SUGGESTION_SNAPSHOT, draft: entry.draft.text };
  notifySuggestions(entry);
}

function updateDraft(entry: CacheEntry, data: string): void {
  entry.suggestions.generation += 1;
  if (data.startsWith("\x1b")) {
    invalidateDraft(entry);
    return;
  }

  for (const char of data) {
    const code = char.charCodeAt(0);
    if (char === "\r" || char === "\n" || code === 0x03 || code === 0x15) {
      entry.draft.text = "";
      entry.draft.trusted = true;
      entry.draft.cursorAtEnd = true;
      continue;
    }
    if (char === "\x7f" || char === "\b") {
      if (entry.draft.trusted && entry.draft.cursorAtEnd) entry.draft.text = Array.from(entry.draft.text).slice(0, -1).join("");
      continue;
    }
    if (code >= 0x20 && code !== 0x7f) {
      if (entry.draft.trusted && entry.draft.cursorAtEnd) {
        entry.draft.text += char;
        entry.draft.trusted = true;
        entry.draft.cursorAtEnd = true;
      } else {
        invalidateDraft(entry);
        return;
      }
      continue;
    }
    invalidateDraft(entry);
    return;
  }

  if (entry.suggestions.snapshot.open) refreshSuggestions(entry);
}

function suggestionContext(entry: CacheEntry) {
  const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === entry.sessionId);
  const sessionType = session?.type === "multiplayer" ? "multiplayer" : entry.sessionType;
  return {
    draft: entry.draft.text,
    entries: useCommandHistoryStore.getState().entries,
    sessionId: entry.sessionId,
    connectionId: session?.connectionId ?? "",
    connectionName: session?.connectionName ?? "",
    sessionType,
    connected: entry.connectedRef.current,
    cursorKnown: entry.draft.trusted && entry.suppressOsc133Writes === 0,
    alternateScreen: entry.terminal.buffer.active.type === "alternate",
    mouseTracking: entry.terminal.modes.mouseTrackingMode !== "none",
    cwd: useTerminalCwdStore.getState().cwds[entry.sessionId],
    persistent: session?.persist === true,
    broadcast: broadcastActiveForSession(entry.sessionId),
    sshSessionKnown: session?.type === "ssh",
  } as const;
}

function refreshSuggestions(entry: CacheEntry): void {
  const generation = ++entry.suggestions.generation;
  const current = entry.suggestions.snapshot;
  const context = suggestionContext(entry);
  const suggestions = getLocalSuggestions(context);
  const selectedIndex = Math.min(current.selectedIndex, Math.max(0, suggestions.length - 1));
  entry.suggestions.snapshot = { ...current, suggestions, selectedIndex, draft: entry.draft.text };
  if (suggestions.length === 0) entry.suggestions.snapshot.open = false;
  notifySuggestions(entry);

  // The explicit picker and safe Tab requests share the same bounded remote
  // listing path. Unsafe contexts return before this request is made.
  const remoteContext = remoteSuggestionContext(entry);
  if (!remoteContext || !canRequestRemoteCompletion(remoteContext)) return;
  const requestContextFingerprint = remoteCompletionContextFingerprint(remoteContext);
  void requestRemotePathSuggestions(remoteContext, sshListRemoteDir, context.connectionName || "SSH")
    .then((remoteSuggestions) => {
      const currentRemoteContext = remoteSuggestionContext(entry);
      if (
        terminalCache.get(entry.sessionId) !== entry ||
        !isRemoteResultCurrent(
          generation,
          entry.suggestions.generation,
          requestContextFingerprint,
          currentRemoteContext,
        )
      ) return;
      if (remoteSuggestions.length === 0) return;
      const latest = entry.suggestions.snapshot;
      const localCommands = new Set(latest.suggestions.map((suggestion) => suggestion.command));
      const merged = [
        ...latest.suggestions,
        ...remoteSuggestions.filter((suggestion) => !localCommands.has(suggestion.command)),
      ];
      entry.suggestions.snapshot = {
        ...latest,
        suggestions: merged,
        selectedIndex: Math.min(latest.selectedIndex, merged.length - 1),
        draft: entry.draft.text,
      };
      notifySuggestions(entry);
    });
}

function remoteSuggestionContext(entry: CacheEntry): RemoteCompletionContext | null {
  const context = suggestionContext(entry);
  return {
    enabled: useTerminalSettingsStore.getState().remotePathCompletionEnabled,
    draft: context.draft,
    cwd: context.cwd,
    sessionId: context.sessionId,
    connectionId: context.connectionId,
    sessionType: context.sessionType,
    sshSessionKnown: context.sshSessionKnown,
    connected: context.connected,
    cursorKnown: context.cursorKnown,
    alternateScreen: context.alternateScreen,
    mouseTracking: context.mouseTracking,
    persistent: context.persistent,
    broadcast: context.broadcast,
  };
}

function blockLine(entry: CacheEntry, block: CommandBlock): number | null {
  const marker = entry.blocks.markers.get(block.id);
  if (marker && !marker.isDisposed && marker.line >= 0) return marker.line;
  return block.startLine ?? null;
}

function navigateBlock(entry: CacheEntry, direction: "previous" | "next"): boolean {
  if (entry.terminal.buffer.active.type === "alternate" || entry.terminal.modes.mouseTrackingMode !== "none") return false;
  const current = entry.terminal.buffer.active.viewportY;
  const blocks = entry.blocks.state.blocks
    .map((block) => ({ block, line: blockLine(entry, block) }))
    .filter((item): item is { block: CommandBlock; line: number } => item.line !== null && item.line >= 0);
  if (blocks.length === 0) return false;
  const target = direction === "previous"
    ? [...blocks].reverse().find((item) => item.line < current) ?? blocks[0]
    : blocks.find((item) => item.line > current + Math.max(0, entry.terminal.rows - 1)) ?? blocks[blocks.length - 1];
  entry.terminal.scrollToLine(target.line);
  return true;
}

function terminalFeedback(entry: CacheEntry, notification: LifecycleNotification): void {
  // This is xterm display output only; it never traverses the session input path.
  // Keep it plain text so an explicit BEL notification cannot recursively trigger
  // another lifecycle signal.
  entry.terminal.write(`\r\n\x1b[90m[Voltius] ${notification.title}: ${notification.body}\x1b[0m\r\n`);
}

function broadcastGroupId(sessionId: string): string | undefined {
  if (!broadcastActiveForSession(sessionId)) return undefined;
  return broadcastTargets().map((target) => target.id).sort().join(",");
}

function sessionIsConnected(sessionId: string, sessionType: CacheEntry["sessionType"]): boolean {
  if (sessionType === "serial") return true;
  return useSessionStore.getState().sessions.some(
    (session) => session.id === sessionId && session.status === "connected",
  );
}

// Scroll position lives in the xterm buffer, not a store, so the workspace
// snapshot can't subscribe to it directly. Terminals notify these listeners on
// scroll; the snapshot sync registers a debounced write so the persisted offset
// tracks the viewport like cwd/layout do.
const scrollListeners = new Set<() => void>();

/** Subscribe to "a terminal scrolled" — returns an unsubscribe fn. */
export function subscribeTerminalScroll(fn: () => void): () => void {
  scrollListeners.add(fn);
  return () => scrollListeners.delete(fn);
}

function notifyScrollListeners(): void {
  scrollListeners.forEach((fn) => fn());
}

/** Lines the viewport is scrolled up from the live prompt (0 = at bottom).
 * Read by the workspace snapshot so restore can re-apply the position. */
export function getScrollOffset(sessionId: string): number {
  const entry = terminalCache.get(sessionId);
  if (!entry) return 0;
  const buffer = entry.terminal.buffer.active;
  return Math.max(0, buffer.baseY - buffer.viewportY);
}

// ─── Restore scroll position ─────────────────────────────────────────────────
// On workspace restore the buffer is rebuilt from a history replay + attach
// redraw streamed as plain output, with no "replay complete" signal. We re-arm
// a settle timer on each write and apply the saved offset once output goes
// quiet, with a hard cap so it fires even if output never fully settles.

const RESTORE_SETTLE_MS = 400;
const RESTORE_HARD_CAP_MS = 3000;
const pendingRestoreScroll = new Map<string, number>();
const restoreScrollTimers = new Map<
  string,
  { settle: ReturnType<typeof setTimeout> | null; cap: ReturnType<typeof setTimeout> }
>();

function applyRestoreScroll(sessionId: string): void {
  const offset = pendingRestoreScroll.get(sessionId);
  const timers = restoreScrollTimers.get(sessionId);
  if (timers) {
    if (timers.settle) clearTimeout(timers.settle);
    clearTimeout(timers.cap);
    restoreScrollTimers.delete(sessionId);
  }
  pendingRestoreScroll.delete(sessionId);
  if (!offset) return;
  const entry = terminalCache.get(sessionId);
  if (!entry) return;
  // Anchor to the bottom (where the attach redraw leaves us) then scroll up the
  // saved offset; xterm clamps at the top if the rebuilt buffer is shorter.
  entry.terminal.scrollToBottom();
  entry.terminal.scrollLines(-offset);
}

/** Record a scroll offset to re-apply after this session's restore replay.
 * Called before reconnect; a no-op for 0 (the session was at the bottom). */
export function setRestoreScrollOffset(sessionId: string, offset: number): void {
  if (offset <= 0) return;
  pendingRestoreScroll.set(sessionId, offset);
  restoreScrollTimers.set(sessionId, {
    settle: null,
    cap: setTimeout(() => applyRestoreScroll(sessionId), RESTORE_HARD_CAP_MS),
  });
}

function noteRestoreOutput(sessionId: string): void {
  const timers = restoreScrollTimers.get(sessionId);
  if (!timers) return;
  if (timers.settle) clearTimeout(timers.settle);
  timers.settle = setTimeout(() => applyRestoreScroll(sessionId), RESTORE_SETTLE_MS);
}

function scheduleMinimapNotify(entry: CacheEntry) {
  if (entry.minimap.frame !== null) return;
  entry.minimap.frame = requestAnimationFrame(() => {
    entry.minimap.frame = null;
    notifyMinimap(entry);
  });
}

function sampleMinimap(entry: CacheEntry, height: number): TerminalMinimapSample[] {
  const buffer = entry.terminal.buffer.active;
  const maxSamples = Math.max(1, Math.floor(height));
  const length = Math.max(1, buffer.length);
  const cols = Math.max(1, entry.terminal.cols);
  const theme = useThemeStore.getState().getActiveTheme().terminal;
  const lines: string[] = [];
  const cellRows: TerminalMinimapCell[][] = [];
  const nullCell = buffer.getNullCell();
  const rows = Math.min(maxSamples, length);

  for (let y = 0; y < rows; y += 1) {
    const start = length <= maxSamples ? y : Math.floor((y / rows) * length);
    const end = length <= maxSamples ? y + 1 : Math.max(start + 1, Math.floor(((y + 1) / rows) * length));
    let text = "";
    let cells: TerminalMinimapCell[] = [];

    for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
      const line = buffer.getLine(lineIndex);
      if (!line) continue;
      const lineText = line.translateToString(true);
      if (!text && lineText) {
        text = lineText;
        const maxCells = Math.min(line.length, cols);
        cells = [];
        for (let x = 0; x < maxCells; x += 1) {
          const cell = line.getCell(x, nullCell);
          if (!cell || cell.getWidth() === 0 || !cell.getChars().trim() || cell.isInvisible()) continue;
          cells.push({
            x,
            width: Math.max(1, cell.getWidth()),
            fg: colorForCell(cell, "fg", theme),
            bg: cell.isBgDefault() ? undefined : colorForCell(cell, "bg", theme),
          });
        }
      }
    }
    lines.push(text);
    cellRows.push(cells);
  }

  return sampleLineDensities(lines, maxSamples, cols).map((sample, index) => ({
    ...sample,
    cells: cellRows[index],
  }));
}

function colorForCell(cell: IBufferCell, target: "fg" | "bg", theme: TerminalTheme): string {
  const color = target === "fg" ? cell.getFgColor() : cell.getBgColor();
  const isDefault = target === "fg" ? cell.isFgDefault() : cell.isBgDefault();
  const isRgb = target === "fg" ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = target === "fg" ? cell.isFgPalette() : cell.isBgPalette();

  if (isDefault) return target === "fg" ? theme.foreground : theme.background;
  if (isRgb) return `#${color.toString(16).padStart(6, "0")}`;
  if (isPalette) return ansiPaletteColor(color, theme);
  return target === "fg" ? theme.foreground : theme.background;
}

function ansiPaletteColor(index: number, theme: TerminalTheme): string {
  const basic = [
    theme.black, theme.red, theme.green, theme.yellow,
    theme.blue, theme.magenta, theme.cyan, theme.white,
    theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow,
    theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite,
  ];
  if (index < basic.length) return basic[index];
  if (index >= 16 && index <= 231) {
    const n = index - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    return rgbHex(r === 0 ? 0 : 55 + r * 40, g === 0 ? 0 : 55 + g * 40, b === 0 ? 0 : 55 + b * 40);
  }
  if (index >= 232 && index <= 255) {
    const v = 8 + (index - 232) * 10;
    return rgbHex(v, v, v);
  }
  return theme.foreground;
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

function scrollMinimapToRatio(entry: CacheEntry, ratio: number) {
  const buffer = entry.terminal.buffer.active;
  const delta = scrollDeltaForRatio(ratio, buffer.length, entry.terminal.rows, buffer.viewportY);
  entry.terminal.scrollLines(delta);
  scheduleMinimapNotify(entry);
}

function searchDecorations() {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--t-accent").trim() || "#6366f1";
  return {
    matchBackground: accent + "55",
    matchBorder: accent,
    matchOverviewRuler: accent,
    activeMatchBackground: accent,
    activeMatchBorder: accent,
    activeMatchColorOverviewRuler: accent,
  };
}

function isRegexValid(pattern: string): boolean {
  try { new RegExp(pattern); return true; } catch { return false; }
}

function runSearch(entry: CacheEntry, direction: "next" | "prev", incremental: boolean) {
  const s = entry.search.snapshot;
  if (!s.query) {
    entry.searchAddon.clearDecorations();
    entry.search.snapshot = { ...s, resultIndex: -1, resultCount: 0, invalidRegex: false };
    notifySearch(entry);
    return;
  }
  if (s.regex && !isRegexValid(s.query)) {
    entry.searchAddon.clearDecorations();
    entry.search.snapshot = { ...s, resultIndex: -1, resultCount: 0, invalidRegex: true };
    notifySearch(entry);
    return;
  }
  if (s.invalidRegex) {
    entry.search.snapshot = { ...s, invalidRegex: false };
  }
  const opts: ISearchOptions = {
    regex: s.regex,
    caseSensitive: s.caseSensitive,
    wholeWord: s.wholeWord,
    incremental,
    decorations: searchDecorations(),
  };
  if (direction === "next") entry.searchAddon.findNext(s.query, opts);
  else entry.searchAddon.findPrevious(s.query, opts);
}

export interface TerminalSearchController {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => TerminalSearchSnapshot;
  open: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
  toggleRegex: () => void;
}

export interface TerminalBlockController {
  subscribe: (fn: () => void) => () => void;
  getBlocks: () => CommandBlock[];
  previous: () => boolean;
  next: () => boolean;
}

export interface TerminalSuggestionController {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => TerminalSuggestionSnapshot;
  open: () => void;
  dismiss: () => void;
  select: (index: number) => void;
  previous: () => void;
  next: () => void;
  accept: () => void;
}

/** Live terminal dimensions, so request_pty starts at the real window size
 * (screen/tmux pin their layout to the size at creation). */
export function getTerminalDims(sessionId: string): { cols: number; rows: number } | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  const { cols, rows } = entry.terminal;
  if (!cols || !rows) return null;
  return { cols, rows };
}

/** Re-fit a session's xterm to its current container (call on viewport/keyboard resize).
 *  Fast-path complement to the per-container ResizeObserver: fires immediately on the
 *  caller's frame rather than after the observer's debounce, for snappier keyboard reflow. */
export function refitSession(sessionId: string): void {
  const entry = terminalCache.get(sessionId);
  if (!entry) return;
  try { entry.fitAddon.fit(); } catch { /* container not laid out yet */ }
}

/** Programmatically send input to a session's PTY (used by the mobile extra-keys row).
 *  Mirrors the onData path: honors the multiplayer input gate, respects connected state,
 *  records history, encodes + sends. Does not replicate the split-pane broadcast branch
 *  (mobile sends to the active session only). */
export function writeToSession(sessionId: string, data: string): void {
  const entry = terminalCache.get(sessionId);
  if (!entry) return;
  if (entry.inputGateRef.current && !entry.inputGateRef.current()) return;
  if (!entry.connectedRef.current) return;
  if (entry.zmodem?.isActive()) return;
  const sess = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  if (sess) {
    useCommandHistoryStore.getState().addInput(sessionId, sess.connectionName, sess.connectionId, data);
  }
  const bytes = new TextEncoder().encode(data);
  sendSessionInput(sessionId, entry.sessionType, bytes);
}

/** Whether the session's xterm is in application-cursor-keys mode (DECCKM).
 *  Arrows must send ESC O x instead of ESC [ x when set. */
export function getAppCursorMode(sessionId: string): boolean {
  const entry = terminalCache.get(sessionId);
  return entry?.terminal.modes.applicationCursorKeysMode ?? false;
}

export interface TerminalApi {
  scrollLines(delta: number): void;
  cols(): number;
  rows(): number;
  /** Absolute buffer line at the top of the viewport. */
  viewportTop(): number;
  /** The live `.xterm-screen` element (for cell-metric measurement), or null. */
  screenEl(): HTMLElement | null;
  /** Rendered text of an absolute buffer line (trimmed-right false). */
  lineText(line: number): string;
  select(col: number, line: number, len: number): void;
  selectLines(start: number, end: number): void;
  selectAll(): void;
  clearSelection(): void;
  getSelection(): string;
  getSelectionPosition(): IBufferRange | undefined;
  paste(text: string): void;
}

/** Give the keyboard back to a session's terminal — after an inline rename, a
 * modal, anything that borrowed focus. No-op when nothing is cached. */
export function focusSession(sessionId: string): void {
  terminalCache.get(sessionId)?.terminal.focus();
}

/** Narrow facade over a cached terminal for the mobile gesture layer. Null when no
 *  terminal is cached for the session yet. */
export function getTerminalApi(sessionId: string): TerminalApi | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  const term = entry.terminal;
  return {
    scrollLines: (delta) => term.scrollLines(delta),
    cols: () => term.cols,
    rows: () => term.rows,
    viewportTop: () => term.buffer.active.viewportY,
    screenEl: () => term.element?.querySelector<HTMLElement>(".xterm-screen") ?? null,
    lineText: (line) => term.buffer.active.getLine(line)?.translateToString(false) ?? "",
    select: (col, line, len) => term.select(col, line, len),
    selectLines: (start, end) => term.selectLines(start, end),
    selectAll: () => term.selectAll(),
    clearSelection: () => term.clearSelection(),
    getSelection: () => term.getSelection(),
    getSelectionPosition: () => term.getSelectionPosition(),
    paste: (text) => term.paste(text),
  };
}

/**
 * Snapshot of the last `maxLines` buffer lines of a session as text (trailing
 * blank lines trimmed). "" when no terminal is cached. Backs the gated
 * `terminal:read` plugin verb. Reads the xterm buffer directly — no Rust.
 */
export function readTerminalSnapshot(sessionId: string, maxLines = 200): string {
  const entry = terminalCache.get(sessionId);
  if (!entry) return "";
  const buffer = entry.terminal.buffer.active;
  let end = buffer.length;
  while (end > 0 && !buffer.getLine(end - 1)?.translateToString(true)) {
    end -= 1;
  }
  const start = Math.max(0, end - maxLines);
  const lines: string[] = [];
  for (let i = start; i < end; i += 1) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

/**
 * The session's current selection as text, or "" when nothing is selected or
 * no terminal is cached. Backs the gated `terminal:read` plugin verb.
 */
export function readTerminalSelection(sessionId: string): string {
  const entry = terminalCache.get(sessionId);
  if (!entry) return "";
  return entry.terminal.getSelection();
}

/** Test seam: replace the module-private terminal cache. Do not use in app code. */
export function __setTerminalCacheForTest(next: typeof terminalCache): void {
  terminalCache.clear();
  for (const [k, v] of next) terminalCache.set(k, v);
}

export function getTerminalSearchController(sessionId: string): TerminalSearchController | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  const sub = entry.search.subscribers;
  return {
    subscribe: (fn) => { sub.add(fn); return () => { sub.delete(fn); }; },
    getSnapshot: () => entry.search.snapshot,
    open: () => {
      const cur = entry.search.snapshot;
      const wasOpen = cur.open;
      // Only pre-fill from a single-line terminal selection on the first open.
      const selection = entry.terminal.getSelection();
      const initialQuery =
        !wasOpen && selection && !selection.includes("\n") ? selection : cur.query;
      entry.search.snapshot = {
        ...cur,
        open: true,
        query: initialQuery,
        focusTick: cur.focusTick + 1,
      };
      notifySearch(entry);
      if (!wasOpen && initialQuery && initialQuery !== cur.query) runSearch(entry, "next", true);
    },
    close: () => {
      entry.searchAddon.clearDecorations();
      entry.search.snapshot = { ...entry.search.snapshot, open: false, resultIndex: -1, resultCount: 0, invalidRegex: false };
      notifySearch(entry);
      entry.terminal.focus();
    },
    setQuery: (q) => {
      entry.search.snapshot = { ...entry.search.snapshot, query: q };
      runSearch(entry, "next", true);
    },
    next: () => runSearch(entry, "next", false),
    prev: () => runSearch(entry, "prev", false),
    toggleCaseSensitive: () => {
      entry.search.snapshot = { ...entry.search.snapshot, caseSensitive: !entry.search.snapshot.caseSensitive };
      runSearch(entry, "next", true);
    },
    toggleWholeWord: () => {
      entry.search.snapshot = { ...entry.search.snapshot, wholeWord: !entry.search.snapshot.wholeWord };
      runSearch(entry, "next", true);
    },
    toggleRegex: () => {
      entry.search.snapshot = { ...entry.search.snapshot, regex: !entry.search.snapshot.regex };
      runSearch(entry, "next", true);
    },
  };
}

export function getTerminalMinimapController(sessionId: string): TerminalMinimapController | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  const subscribers = entry.minimap.subscribers;
  return {
    subscribe: (fn) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
    getSnapshot: () => entry.minimap.snapshot,
    sample: (height) => sampleMinimap(entry, height),
    scrollToRatio: (ratio) => scrollMinimapToRatio(entry, ratio),
    focus: () => entry.terminal.focus(),
  };
}

export function getTerminalBlockController(sessionId: string): TerminalBlockController | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  return {
    subscribe: (fn) => { entry.blocks.subscribers.add(fn); return () => entry.blocks.subscribers.delete(fn); },
    getBlocks: () => entry.blocks.state.blocks,
    previous: () => navigateBlock(entry, "previous"),
    next: () => navigateBlock(entry, "next"),
  };
}

export function getTerminalSuggestionController(sessionId: string): TerminalSuggestionController | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  return {
    subscribe: (fn) => { entry.suggestions.subscribers.add(fn); return () => entry.suggestions.subscribers.delete(fn); },
    getSnapshot: () => entry.suggestions.snapshot,
    open: () => {
      refreshSuggestions(entry);
      const remotePending = remoteSuggestionContext(entry);
      if (entry.suggestions.snapshot.suggestions.length === 0 && (!remotePending || !canRequestRemoteCompletion(remotePending))) return;
      entry.suggestions.snapshot = { ...entry.suggestions.snapshot, open: true, selectedIndex: 0, draft: entry.draft.text };
      notifySuggestions(entry);
    },
    dismiss: () => {
      entry.suggestions.snapshot = { ...EMPTY_SUGGESTION_SNAPSHOT, draft: entry.draft.text };
      notifySuggestions(entry);
      entry.terminal.focus();
    },
    select: (index) => {
      if (index < 0 || index >= entry.suggestions.snapshot.suggestions.length) return;
      entry.suggestions.snapshot = { ...entry.suggestions.snapshot, selectedIndex: index };
      notifySuggestions(entry);
    },
    previous: () => {
      const { suggestions, selectedIndex } = entry.suggestions.snapshot;
      if (!suggestions.length) return;
      entry.suggestions.snapshot = { ...entry.suggestions.snapshot, selectedIndex: (selectedIndex - 1 + suggestions.length) % suggestions.length };
      notifySuggestions(entry);
    },
    next: () => {
      const { suggestions, selectedIndex } = entry.suggestions.snapshot;
      if (!suggestions.length) return;
      entry.suggestions.snapshot = { ...entry.suggestions.snapshot, selectedIndex: (selectedIndex + 1) % suggestions.length };
      notifySuggestions(entry);
    },
    accept: () => {
      const current = entry.suggestions.snapshot;
      const selected = current.suggestions[current.selectedIndex];
      if (!current.open || !selected || !entry.draft.trusted || selected.command === entry.draft.text) return;
      entry.suggestions.generation += 1;
        writeToSession(sessionId, suggestionInsertInput(entry.draft.text, selected.command));
        entry.draft.text = selected.command;
        entry.draft.trusted = true;
        entry.draft.cursorAtEnd = true;
      entry.suggestions.snapshot = { ...EMPTY_SUGGESTION_SNAPSHOT, draft: entry.draft.text };
      notifySuggestions(entry);
      entry.terminal.focus();
    },
  };
}

function canHandleRemoteCompletionTab(entry: CacheEntry): boolean {
  const context = remoteSuggestionContext(entry);
  return context !== null && canRequestRemoteCompletion(context);
}

export function isTerminalBlockNavKey(e: KeyboardEvent): boolean {
  return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "PageUp" || e.key === "PageDown");
}

export function handleTerminalBlockNav(sessionId: string, e: KeyboardEvent): boolean {
  if (!isTerminalBlockNavKey(e)) return false;
  const controller = getTerminalBlockController(sessionId);
  if (!controller || controller.getBlocks().length === 0) return false;
  if (e.type === "keydown") {
    if (e.key === "PageUp") controller.previous();
    else controller.next();
  }
  return true;
}

/** Open the search widget for a given session (no-op if the session has no cached terminal yet). */
export function openTerminalSearch(sessionId: string): void {
  getTerminalSearchController(sessionId)?.open();
}

/**
 * Take a chord for the terminal canvas and return xterm's "skip this key" verdict.
 *
 * xterm returns early on a false verdict *without* calling its own cancel(), so
 * the event keeps propagating to useKeyboard's window listener. That listener
 * runs the Ctrl+F and Ctrl+G branches above its `isInput` guard — the canvas is
 * a textarea, so every other shortcut it owns is already unreachable from here —
 * and would run its copy of the shortcut on top of this one.
 */
function claimChord(e: KeyboardEvent): false {
  e.preventDefault();
  e.stopPropagation();
  return false;
}

/** Ctrl+G / Shift+Ctrl+G — the search widget's find-next / find-previous chord. */
export function isTerminalSearchNavKey(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.altKey && (e.key === "g" || e.key === "G");
}

/**
 * Move an open search widget to its next (or, with shift, previous) hit.
 *
 * Returns whether the chord was consumed. A closed widget consumes nothing:
 * Ctrl+G then still belongs to the shell as ^G, which is readline's `abort` and
 * the only way out of a Ctrl+R reverse-i-search (#208).
 */
export function handleTerminalSearchNav(sessionId: string, e: KeyboardEvent): boolean {
  const ctrl = getTerminalSearchController(sessionId);
  if (!ctrl?.getSnapshot().open) return false;
  // The chord is consumed for keyup/keypress too, but only keydown moves the hit.
  if (e.type === "keydown") {
    if (e.shiftKey) ctrl.prev();
    else ctrl.next();
  }
  return true;
}

useSessionStore.subscribe((state, previous) => {
  const currentIds = new Set(state.sessions.map((s) => s.id));
  for (const [id, entry] of terminalCache) {
    if (!currentIds.has(id)) {
      entry.dispose();
      terminalCache.delete(id);
    }
  }

  // Local sessions ride the same transition as SSH: the terminal mounts while
  // the session is still "connecting", so treating it as connected before the
  // backend registered it sent resizes at a session id the backend answered
  // with "Session not found".
  for (const [id, entry] of terminalCache) {
    const session = state.sessions.find((s) => s.id === id);
    const previousSession = previous.sessions.find((s) => s.id === id);
    const sessionContextChanged = session?.connectionId !== previousSession?.connectionId ||
      session?.persist !== previousSession?.persist ||
      session?.type !== previousSession?.type;
    if (sessionContextChanged) {
      entry.suggestions.generation += 1;
      if (entry.suggestions.snapshot.open) refreshSuggestions(entry);
    }
    const nowConnected = session?.status === "connected";
    if (nowConnected && !entry.connectedRef.current) {
      entry.connectedRef.current = true;
      entry.intentionalShellExit = false;
      // A reconnect is a new OSC generation. Replayed scrollback and a fresh
      // shell prompt must not complete or duplicate blocks from the old PTY.
      entry.blocks.state = resetOsc133State(entry.blocks.state);
      entry.blocks.markers.forEach((marker) => marker.dispose());
      entry.blocks.markers.clear();
      entry.suppressOsc133Writes = 0;
       entry.draft.text = "";
       entry.draft.trusted = true;
       entry.draft.cursorAtEnd = true;
      entry.suggestions.snapshot = { ...EMPTY_SUGGESTION_SNAPSHOT };
      notifyBlocks(entry);
      notifySuggestions(entry);
      resetTerminalLifecycleNotifications(id);
      if (entry.sessionType === "serial") continue;
      entry.fitAddon.fit();
      sendResize(id, entry.sessionType, entry.terminal.cols, entry.terminal.rows);
    } else if (!nowConnected) {
      entry.connectedRef.current = false;
      invalidateDraft(entry);
    }
  }
});

// Cwd arrives asynchronously through OSC 7 or the persistent-session poller.
// Treat it as editor context: an in-flight listing for the old directory must
// never be allowed to populate the current picker.
useTerminalCwdStore.subscribe((state, previous) => {
  for (const [id, entry] of terminalCache) {
    if (state.cwds[id] === previous.cwds[id]) continue;
    entry.suggestions.generation += 1;
    if (entry.suggestions.snapshot.open) refreshSuggestions(entry);
  }
});

useLayoutStore.subscribe((state, previous) => {
  for (const [id, entry] of terminalCache) {
    const wasBroadcast = previous.broadcastActive && previous.splitTabActive && getPaneSessionIds(previous.root).includes(id);
    const isBroadcast = state.broadcastActive && state.splitTabActive && getPaneSessionIds(state.root).includes(id);
    if (wasBroadcast === isBroadcast) continue;
    entry.suggestions.generation += 1;
    if (entry.suggestions.snapshot.open) refreshSuggestions(entry);
  }
});

useTerminalSettingsStore.subscribe((state, previous) => {
  if (state.remotePathCompletionEnabled === previous.remotePathCompletionEnabled) return;
  for (const [, entry] of terminalCache) {
    entry.suggestions.generation += 1;
    if (entry.suggestions.snapshot.open) refreshSuggestions(entry);
  }
});

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTerminal({ sessionId, sessionType, onClosed, inputGate, encoding, onResize }: UseTerminalOptions) {
  const mountCleanupRef = useRef<(() => void) | null>(null);

  // Keep the cached entry's callback refs current on every render
  useEffect(() => {
    const entry = terminalCache.get(sessionId);
    if (entry) {
      entry.inputGateRef.current = inputGate?.current;
      entry.onClosedRef.current = onClosed;
      entry.onResizeRef.current = onResize;
    }
  });

  // Container-specific listeners, registered on each mount and torn down when
  // the ref detaches. The teardown also pulls the terminal element out of the
  // container: a pane that switches session keeps the same container node, so
  // leaving the old element behind would show the previous session's buffer.
  const bindContainer = useCallback((entry: CacheEntry, container: HTMLDivElement) => {
    const { terminal, fitAddon } = entry;
    const clip = attachTerminalClipboard(terminal, container, { osc52: true });
    entry.clip = clip;

    const handleWindowResize = () => fitAddon.fit();
    window.addEventListener("resize", handleWindowResize);

    let fitTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (fitTimer !== null) clearTimeout(fitTimer);
      fitTimer = setTimeout(() => { fitTimer = null; fitAddon.fit(); }, 50);
    });
    resizeObserver.observe(container);

    mountCleanupRef.current = () => {
      clip.dispose();
      if (entry.clip === clip) entry.clip = null;
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver.disconnect();
      if (fitTimer !== null) clearTimeout(fitTimer);
      terminal.element?.remove();
      mountCleanupRef.current = null;
    };
  }, []);

  const attach = useCallback(
    (container: HTMLDivElement | null) => {
      // React hands the ref a null when the callback identity changes (session
      // switch on a live pane) as well as on unmount — both mean "detach".
      if (!container) {
        mountCleanupRef.current?.();
        return;
      }
      if (mountCleanupRef.current) return;

      const existing = terminalCache.get(sessionId);

      // ── Reuse existing terminal ───────────────────────────────────────────
      if (existing) {
        const { terminal, fitAddon } = existing;
        existing.connectedRef.current = sessionIsConnected(sessionId, existing.sessionType);
        existing.inputGateRef.current = inputGate?.current;
        existing.onClosedRef.current = onClosed;
        existing.onResizeRef.current = onResize;

        if (terminal.element) container.appendChild(terminal.element);

        fitAddon.fit();

        bindContainer(existing, container);
        return;
      }

      // ── Create new terminal ───────────────────────────────────────────────
      const activeTheme = useThemeStore.getState().getActiveTheme();
      const { scrollbackLines: scrollback, cursorStyle } = useTerminalSettingsStore.getState();
      const term = new Terminal({
        altClickMovesCursor: false,
        // macOS has no Shift bypass for mouse-reporting apps; Alt+click is the only one.
        macOptionClickForcesSelection: true,
        cursorBlink: getToggle("cursor-blink"),
        cursorStyle,
        fontSize: activeTheme.terminalFontSize,
        lineHeight: clampTerminalLineHeight(activeTheme.terminalLineHeight),
        fontFamily: terminalFontStack(activeTheme.terminalFontFamily),
        scrollback,
        theme: activeTheme.terminal,
        overviewRuler: { width: 4 },
        allowProposedApi: true,
        // Some remote prompts/programs (e.g. sudo password entry) don't
        // support bracketed paste and echo the \x1b[200~/201~ markers back
        // literally, corrupting the buffer. Let users opt out entirely.
        ignoreBracketedPasteMode: getToggle("ignore-bracketed-paste"),
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      const searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);

      let linkTooltip: HTMLDivElement | null = null;
      // The link under the cursor, mirrored out of the hover callbacks so the
      // alt+click capture below knows whether the click lands on one.
      let hoveredLink: string | null = null;
      const hideLinkTooltip = () => {
        hoveredLink = null;
        linkTooltip?.remove();
        linkTooltip = null;
      };
      const showLinkTooltip = (event: MouseEvent, uri: string) => {
        if (!isHttpUrl(uri)) return;
        hoveredLink = uri;
        if (!linkTooltip) {
          linkTooltip = document.createElement("div");
          linkTooltip.className = "xterm-hover";
          Object.assign(linkTooltip.style, {
            position: "fixed",
            zIndex: "10000",
            pointerEvents: "none",
            padding: "4px 8px",
            borderRadius: "6px",
            background: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            color: "var(--t-text)",
            fontFamily: terminalFontStack(activeTheme.terminalFontFamily),
            fontSize: "12px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
            opacity: "0",
            transform: "translateY(4px)",
            transition: "opacity 150ms ease-out, transform 150ms ease-out",
            willChange: "opacity, transform",
            whiteSpace: "nowrap",
          });
          document.body.appendChild(linkTooltip);
          const tooltip = linkTooltip;
          requestAnimationFrame(() => {
            if (linkTooltip !== tooltip) return;
            tooltip.style.opacity = "1";
            tooltip.style.transform = "translateY(0)";
          });
        }
        linkTooltip.textContent = "Alt+click to open";
        linkTooltip.style.left = `${event.clientX + 12}px`;
        linkTooltip.style.top = `${event.clientY + 12}px`;
      };

      term.loadAddon(new WebLinksAddon(openTerminalLink, {
        hover: showLinkTooltip,
        leave: hideLinkTooltip,
      }));

      // xterm always registers its own OSC 8 provider, which outranks the addon
      // above on hyperlinked text. Without a handler it falls back to xterm's
      // default: a confirm() that Tauri turns async (so its Promise always reads
      // truthy) followed by a window.open() the webview refuses — the click was
      // swallowed and nothing opened. Route it through the same policy instead.
      term.options.linkHandler = {
        activate: openTerminalLink,
        hover: showLinkTooltip,
        leave: hideLinkTooltip,
      };

      const encoder = new TextEncoder();
      const decoder = encoding ? new TextDecoder(encoding) : null;
      const renderOutput = (data: Uint8Array, afterWrite?: () => void, suppressOsc133 = false) => {
        if (suppressOsc133) entry.suppressOsc133Writes += 1;
        term.write(decoder ? decoder.decode(data) : data, () => {
          if (suppressOsc133) entry.suppressOsc133Writes = Math.max(0, entry.suppressOsc133Writes - 1);
          scheduleMinimapNotify(entry);
          if (term.buffer.active.type === "alternate" || term.modes.mouseTrackingMode !== "none") invalidateDraft(entry);
          afterWrite?.();
        });
        if (term.buffer.active.type === "alternate" || term.modes.mouseTrackingMode !== "none") invalidateDraft(entry);
      };
      const writeOutput = (data: Uint8Array, afterWrite?: () => void) => {
        renderOutput(data, afterWrite);
        recordSessionOutput(sessionId, data);
      };

      // Build the cache entry first so closures below can reference it
      const entry: CacheEntry = {
        sessionId,
        terminal: term,
        fitAddon,
        searchAddon,
        search: { snapshot: { ...EMPTY_SNAPSHOT }, subscribers: new Set() },
        minimap: {
          snapshot: { bufferLength: 0, viewportY: 0, baseY: 0, rows: term.rows, cols: term.cols, version: 0 },
          subscribers: new Set(),
          frame: null,
        },
        sessionType,
        // Serial is live the moment its port opens. SSH/local can already be
        // connected when a restored terminal mounts, so read the store's
        // authoritative state instead of waiting for a transition that may
        // never arrive. Unknown or non-connected states stay safely false.
        connectedRef: { current: sessionIsConnected(sessionId, sessionType) },
        clip: null,
        inputGateRef: { current: inputGate?.current },
        onClosedRef: { current: onClosed },
        onResizeRef: { current: onResize },
        lifecycleEventSequence: 0,
        blocks: { state: createOsc133State(), markers: new Map(), subscribers: new Set() },
        draft: { text: "", trusted: true, cursorAtEnd: true },
        intentionalShellExit: false,
        zmodem: null,
         suggestions: { snapshot: { ...EMPTY_SUGGESTION_SNAPSHOT }, subscribers: new Set(), generation: 0 },
        suppressOsc133Writes: 0,
        dispose: () => {}, // filled in below
      };
      terminalCache.set(sessionId, entry);
      if (sessionType === "ssh") {
        entry.zmodem = getZmodemSession(sessionId, (bytes) => sendSessionInputRaw(sessionId, "ssh", bytes));
      }
      notifyMinimap(entry);

      const searchResultsDispose = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
        entry.search.snapshot = { ...entry.search.snapshot, resultIndex, resultCount };
        notifySearch(entry);
      });

      const scrollDispose = term.onScroll(() => {
        scheduleMinimapNotify(entry);
        notifyScrollListeners();
      });
      const bufferChangeDispose = term.buffer.onBufferChange(() => scheduleMinimapNotify(entry));
      const bellDispose = term.onBell(() => {
        const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === sessionId);
        const groupId = broadcastGroupId(sessionId);
        void notifyTerminalLifecycle(
          {
            kind: "terminal-bell",
            sessionId,
            sessionName: session?.title || session?.connectionName || "Terminal session",
            sessionType,
            // Broadcast targets do not share a transport event id. A short
            // time bucket gives simultaneous fan-out bells one logical id
            // without suppressing later, intentional bells.
            eventId: groupId
              ? `broadcast:${Math.floor(Date.now() / 500)}`
              : `${sessionId}:${++entry.lifecycleEventSequence}`,
            broadcastGroupId: groupId,
          },
          (notification) => terminalFeedback(entry, notification),
        );
      });

      // Intercept app shortcuts before xterm processes them
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        const layout = useLayoutStore.getState();
        const isSplitPaneTerminal = layout.splitTabActive && getPaneSessionIds(layout.root).includes(sessionId);
        if (isSplitPaneTerminal && e.ctrlKey && e.shiftKey && e.key === "Enter") {
          if (e.type === "keydown") {
            const activePaneId = layout.activePaneId;
            if (activePaneId) layout.setMaximized(layout.maximizedPaneId === activePaneId ? null : activePaneId);
          }
          return false;
        }
        if (isSplitPaneTerminal && e.key === "Escape" && layout.maximizedPaneId) {
          if (e.type === "keydown") useLayoutStore.getState().setMaximized(null);
          return false;
        }
        if (isSplitPaneTerminal && e.ctrlKey && e.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
          if (e.type === "keydown") {
            const direction = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : "down";
            focusPaneInDirection(direction);
          }
          return false;
        }
        if (matchShortcut("omni", e)) {
          if (e.type === "keydown") useUIStore.getState().setOmniOpen(true);
          return false;
        }
        const clipResult = entry.clip?.handleKeyEvent(e);
        if (clipResult != null) return clipResult;
        if (matchShortcut("terminal-search", e)) {
          if (e.type === "keydown") getTerminalSearchController(sessionId)?.open();
          return claimChord(e);
        }
        // Returning false makes xterm skip the key entirely — correct while the
        // search widget owns Ctrl+G, wrong once it is closed, when the shell needs
        // ^G. xterm marks ctrl+letter cancel:true and calls preventDefault itself,
        // so the webview's native find-next stays suppressed on the pass-through.
        // This pane owns its own widget; useKeyboard keys off activeSessionId.
        if (isTerminalSearchNavKey(e)) {
          if (!handleTerminalSearchNav(sessionId, e)) return true;
          return claimChord(e);
        }
        const suggestionController = getTerminalSuggestionController(sessionId);
        const suggestionOpen = suggestionController?.getSnapshot().open ?? false;
        if (suggestionOpen && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) {
          if (e.type === "keydown") {
            if (e.key === "ArrowUp") suggestionController?.previous();
            else if (e.key === "ArrowDown") suggestionController?.next();
            else if (e.key === "Enter") suggestionController?.accept();
            else suggestionController?.dismiss();
          }
          return claimChord(e);
        }
        const isUnmodifiedTab = e.key === "Tab" && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
        if (isUnmodifiedTab && canHandleRemoteCompletionTab(entry)) {
          if (e.type === "keydown") {
            const current = suggestionController?.getSnapshot();
            const selected = current?.open && current.suggestions[current.selectedIndex];
            if (selected) suggestionController?.accept();
            else suggestionController?.open();
          }
          return claimChord(e);
        }
        if (matchShortcut("terminal-suggestions", e)) {
          if (e.type === "keydown") suggestionController?.open();
          return claimChord(e);
        }
        if (isTerminalBlockNavKey(e)) {
          if (!handleTerminalBlockNav(sessionId, e)) return true;
          return claimChord(e);
        }
        const panelSection = matchPanelShortcut(e);
        if (panelSection) {
          if (e.type === "keydown") useUIStore.getState().toggleRightPanel(panelSection);
          return false;
        }
        if (handleDuplicateShortcut(e, sessionId)) return false;
        return true;
      });

      // Route already-encoded input bytes to the PTY, fanning out to every pane
      // when split-pane broadcast is active. Shared by typed input (onData) and
      // synthesized alt-screen scroll arrows so both honor broadcast identically.
      const routeInputBytes = (bytes: Uint8Array) => {
        if (entry.zmodem?.isActive()) return;
        if (broadcastActiveForSession(sessionId)) {
          for (const target of broadcastTargets()) {
            sendSessionInput(target.id, target.type === "serial" ? "serial" : target.type as "ssh" | "local", bytes);
          }
          return;
        }
        sendSessionInput(sessionId, sessionType, bytes);
      };

      // Alternate-screen scroll: full-screen apps (nano/less/vim) run in the
      // alternate buffer, where xterm has no scrollback to move — so a wheel or
      // touchpad scroll would otherwise do nothing (#50). Translate it into Up/Down
      // arrow presses, unless the app is tracking the mouse itself (e.g. vim
      // `set mouse=a`), in which case xterm forwards the wheel as mouse events.
      let wheelCarry = 0;
      term.attachCustomWheelEventHandler((e: WheelEvent) => {
        if (term.buffer.active.type !== "alternate") return true;
        if (term.modes.mouseTrackingMode !== "none") return true;
        // We own this event now: stop the page/ancestor from also scrolling, and
        // return false so xterm skips its own (sub-pixel-dampened) translation.
        e.preventDefault();
        if (inputGate && !inputGate.current?.()) return false;
        if (!entry.connectedRef.current) return false;

        const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
        const cellHeight = screen && term.rows ? screen.clientHeight / term.rows : 0;
        const { rows, carry } = wheelToRows({
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          cellHeight,
          viewportRows: term.rows,
          carry: wheelCarry,
          maxRows: term.rows, // one page per event caps runaway flings
        });
        wheelCarry = carry;
        if (rows !== 0) {
          const seq = keyToBytes(rows < 0 ? "Up" : "Down", {
            ctrl: false,
            alt: false,
            appCursor: term.modes.applicationCursorKeysMode,
          }).repeat(Math.abs(rows));
          routeInputBytes(encoder.encode(seq));
        }
        return false;
      });

      term.open(container);

      // While a TUI holds the mouse, xterm only keeps a click for itself when
      // Shift is down (Alt on macOS) — so on Windows/Linux our alt+click was
      // *both* reported to the app and matched locally, and an app that opens
      // URLs itself (Claude Code) opened a second copy. Claim alt+click over a
      // link before xterm's own listeners see it, and open it ourselves since
      // stopping propagation also stops xterm's link activation.
      if (term.element) {
        const claimAltClickOnLink = (e: MouseEvent) => {
          if (e.button !== 0 || !e.altKey || !hoveredLink) return;
          if (term.modes.mouseTrackingMode === "none") return;
          e.stopPropagation();
          if (e.type === "mouseup") openTerminalLink(e, hoveredLink);
        };
        for (const type of ["mousedown", "mouseup", "click"] as const) {
          term.element.addEventListener(type, claimAltClickOnLink, true);
        }
      }

      // Android: stop xterm's hidden textarea from summoning the WebView's own (broken) IME —
      // a native overlay owns the soft keyboard instead (see services/androidKeyboard.ts, #34).
      void getPlatform().then((os) => {
        if (os !== "android") return;
        const ta = term.element?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
        if (!ta) return;
        // Keep xterm's textarea from ever becoming a live IME target: inputmode=none stops it
        // summoning the WebView's own (broken) keyboard, readOnly stops Chromium binding an
        // editable InputConnection to it. The native overlay is the sole editor; input is fed
        // back via window.__voltiusTermInput (see services/androidKeyboard.ts, #34).
        ta.readOnly = true;
        ta.setAttribute("inputmode", "none");
        ta.setAttribute("autocorrect", "off");
        ta.setAttribute("autocapitalize", "off");
        ta.setAttribute("autocomplete", "off");
        ta.spellcheck = false;
      });

      try {
        term.loadAddon(createWebglAddon());
      } catch {
        // WebGL not available, use default canvas renderer
      }

      // OSC 7 — shell-reported cwd (file://host/path). Used by the right-panel
      // SFTP tab's "follow cwd" feature. Silently no-ops for shells that don't
      // emit it.
      const oscCwdDispose = term.parser.registerOscHandler(7, (data) => {
        try {
          if (!data.startsWith("file://")) return false;
          // Manual parse — URL constructor mangles Windows backslashes and
          // throws on unencoded characters that cmd's $P happily includes.
          const rest = data.slice("file://".length);
          const slashIdx = rest.indexOf("/");
          if (slashIdx === -1) return true;
          const host = rest.slice(0, slashIdx);
          const raw = rest.slice(slashIdx);
          let path: string;
          try { path = decodeURIComponent(raw); } catch { path = raw; }
          // Windows drive paths arrive as `/C:\Users\foo` (from cmd's $P) —
          // strip the leading slash, normalize backslashes for display.
          if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
          path = path.replace(/\\/g, "/");
          // WSL sessions emit host=wsl.localhost with the distro embedded as
          // the first path segment. Convert to a UNC path that Windows' fs
          // API can actually read (`\\wsl.localhost\<distro>\…`).
          if (host === "wsl.localhost" || host === "wsl$") {
            path = `//${host}${path}`;
          }
          if (path) useTerminalCwdStore.getState().setCwd(sessionId, path);
        } catch { /* malformed OSC 7 payload */ }
        return true;
      });

      // OSC 133 is deliberately additive: malformed markers, unsupported
      // shells, multiplexers, replay output, alternate-screen TUIs, and serial
      // sessions remain ordinary terminal output with no input side effects.
      const osc133Dispose = term.parser.registerOscHandler(133, (data) => {
        if (entry.sessionType === "serial") return false;
        if (entry.suppressOsc133Writes > 0 || term.buffer.active.type === "alternate" || term.modes.mouseTrackingMode !== "none") return true;
        const parsed = parseOsc133(data);
        if (parsed.malformed || !parsed.marker) return true;

        let marker: IMarker | undefined;
        if (parsed.marker.kind === "command-start" || parsed.marker.kind === "command-finished") {
          try { marker = term.registerMarker(); } catch { /* marker support is optional */ }
        }
        const before = entry.blocks.state;
        entry.blocks.state = applyOsc133Marker(before, parsed.marker, marker ? { line: marker.line } : undefined);
        if (marker && parsed.marker.kind === "command-start" && entry.blocks.state.activeBlockId !== null) {
          entry.blocks.markers.set(entry.blocks.state.activeBlockId, marker);
        }
        notifyBlocks(entry);
        return true;
      });

      const onDataDispose = term.onData((data) => {
        if (inputGate && !inputGate.current?.()) return;
        if (!entry.connectedRef.current) return;
        if (entry.zmodem?.isActive()) return;

        // Mobile extra-keys row: apply a latched virtual Ctrl/Alt to this typed char
        // (e.g. latch Ctrl, type "c" → Ctrl-C). Inert on desktop (latch never armed).
        const latched = consumeLatchForChar(data);
        if (latched !== null) data = latched;

        entry.intentionalShellExit = false;
          if (term.buffer.active.type === "alternate" || term.modes.mouseTrackingMode !== "none") {
            invalidateDraft(entry);
          } else {
            const intentionalShellExit = data === "\x04" &&
              entry.sessionType === "ssh" &&
              entry.connectedRef.current &&
              term.buffer.active.type === "normal" &&
              entry.suppressOsc133Writes === 0 &&
              entry.draft.trusted &&
            entry.draft.cursorAtEnd &&
            entry.draft.text.length === 0 &&
            !broadcastActiveForSession(sessionId);
          entry.intentionalShellExit = intentionalShellExit;
          updateDraft(entry, data);
        }

        const sess = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        if (sess) {
          useCommandHistoryStore
            .getState()
            .addInput(sessionId, sess.connectionName, sess.connectionId, data);
        }

        routeInputBytes(encoder.encode(data));
      });

      const unlistenPromises: Promise<UnlistenFn>[] = [];

      if (sessionType === "local") {
        const localListeners = [
          onLocalOutput(sessionId, (data) => writeOutput(data)),
          onLocalClosed(sessionId, () => {
            invalidateDraft(entry);
            const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === sessionId);
            void notifyTerminalLifecycle(
              {
                kind: "session-ended",
                sessionId,
                sessionName: session?.title || session?.connectionName || "Local session",
                sessionType,
                reason: "local-exit",
              },
              (notification) => terminalFeedback(entry, notification),
            );
            entry.onClosedRef.current?.(false);
          }),
        ];
        unlistenPromises.push(...localListeners);
        // A PTY writes its banner and first prompt before these listeners are
        // registered — Tauri drops an emit with no listener, which left the
        // terminal blank behind a live shell. The backend holds that output
        // until this ack, then replays it.
        void Promise.all(localListeners)
          .then(() => localReady(sessionId))
          .catch((err) => log.debug(`local session ${sessionId} readiness ack failed`, err));
      } else if (sessionType === "serial") {
        unlistenPromises.push(
          onSerialOutput(sessionId, (data) => writeOutput(data)),
        );
        unlistenPromises.push(
          onSerialClosed(sessionId, () => {
            invalidateDraft(entry);
            const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === sessionId);
            void notifyTerminalLifecycle(
              {
                kind: "session-ended",
                sessionId,
                sessionName: session?.title || session?.connectionName || "Serial session",
                sessionType,
                reason: "serial-close",
              },
              (notification) => terminalFeedback(entry, notification),
            );
            entry.onClosedRef.current?.(false);
          }),
        );
      } else {
        unlistenPromises.push(
          onSshOutput(sessionId, (data) => {
            const terminalBytes = entry.zmodem?.consume(data) ?? data;
            if (terminalBytes.length) writeOutput(terminalBytes, () => noteRestoreOutput(sessionId));
          }),
        );
        unlistenPromises.push(
          onSshRestoreOutput(sessionId, (data) => {
            // Restore output is historical replay, not a new command lifecycle.
            // Suppress OSC 133 state updates so reattachment cannot duplicate
            // blocks or manufacture a result from stale scrollback.
            renderOutput(data, () => noteRestoreOutput(sessionId), true);
          }),
        );
        unlistenPromises.push(
          onSshClosed(sessionId, (remoteExit) => {
            const closeIntent = entry.intentionalShellExit ? "intentional-shell-exit" : undefined;
            entry.intentionalShellExit = false;
            invalidateDraft(entry);
            if (entry.zmodem?.isActive()) void entry.zmodem.cancel();
            const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === sessionId);
            void notifyTerminalLifecycle(
              {
                kind: "session-ended",
                sessionId,
                sessionName: session?.title || session?.connectionName || "SSH session",
                sessionType,
                reason: remoteExit ? "remote-exit" : "disconnect",
              },
              (notification) => terminalFeedback(entry, notification),
            );
            entry.onClosedRef.current?.(remoteExit, closeIntent);
          }),
        );
        // Persistent sessions (tmux/screen) hide the shell's OSC 7 from the
        // terminal, so the backend polls the multiplexer for the cwd instead.
        unlistenPromises.push(
          onSshCwd(sessionId, (cwd) => {
            if (cwd) useTerminalCwdStore.getState().setCwd(sessionId, cwd);
          }),
        );
      }

      const onResizeDispose = term.onResize(({ cols, rows }) => {
        entry.onResizeRef.current?.(cols, rows);
        scheduleMinimapNotify(entry);
        if (!entry.connectedRef.current) return;
        sendResize(sessionId, sessionType, cols, rows);
      });

      fitAddon.fit();

      // Full teardown — only called when the session is deleted from the store
      entry.dispose = () => {
        entry.intentionalShellExit = false;
        entry.suggestions.generation += 1;
        onDataDispose.dispose();
        onResizeDispose.dispose();
        oscCwdDispose.dispose();
        osc133Dispose.dispose();
         searchResultsDispose.dispose();
         scrollDispose.dispose();
         bufferChangeDispose.dispose();
         bellDispose.dispose();
        if (entry.minimap.frame !== null) cancelAnimationFrame(entry.minimap.frame);
        entry.search.subscribers.clear();
        entry.minimap.subscribers.clear();
        entry.suggestions.subscribers.clear();
        hideLinkTooltip();
        Promise.all(unlistenPromises).then((fns) => fns.forEach((fn) => fn()));
         term.dispose();
         if (entry.zmodem?.isActive()) void entry.zmodem.cancel();
         disposeZmodemSession(sessionId);
      };

      bindContainer(entry, container);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, sessionType, encoding],
  );

  // Live bracketed-paste toggle updates
  useEffect(() => {
    return useToggleSettingsStore.subscribe(() => {
      const entry = terminalCache.get(sessionId);
      if (!entry) return;
      entry.terminal.options.ignoreBracketedPasteMode = getToggle("ignore-bracketed-paste");
    });
  }, [sessionId]);

  // Live theme updates
  useEffect(() => {
    return subscribeTerminalTheme(() => {
      const entry = terminalCache.get(sessionId);
      return { term: entry?.terminal, fit: entry?.fitAddon };
    });
  }, [sessionId]);

  // Live cursor style/blink updates
  useEffect(() => {
    return subscribeTerminalCursor(() => terminalCache.get(sessionId)?.terminal);
  }, [sessionId]);

  // Live theme preview
  useEffect(() => {
    const handler = (e: Event) => {
      const entry = terminalCache.get(sessionId);
      if (!entry) return;
      const { terminal: term, fitAddon } = entry;
      applyTerminalTheme(term, fitAddon, (e as CustomEvent).detail);
    };
    window.addEventListener("theme-preview", handler);
    return () => window.removeEventListener("theme-preview", handler);
  }, [sessionId]);

  // Mount-only cleanup — does NOT dispose the terminal (cache survives unmount)
  useEffect(() => {
    return () => {
      mountCleanupRef.current?.();
    };
  }, []);

  const focus = useCallback(() => {
    terminalCache.get(sessionId)?.terminal.focus();
  }, [sessionId]);

  const fit = useCallback(() => {
    const entry = terminalCache.get(sessionId);
    if (!entry) return;
    const { terminal: term, fitAddon } = entry;
    fitAddon.fit();
    // Force-send current dimensions — xterm suppresses onResize when cols/rows
    // haven't changed, which causes the PTY to stay at its initial 80x24 when
    // the session becomes active after connecting.
    if (!entry.connectedRef.current) return;
    sendResize(sessionId, sessionType, term.cols, term.rows);
  }, [sessionId, sessionType]);

  return { attach, focus, fit };
}
