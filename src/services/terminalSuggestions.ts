import type { CommandHistoryEntry } from "@/stores/commandHistoryStore";
import { rankCommandHistory } from "./commandHistorySearch";

export interface SuggestionContext {
  draft: string;
  entries: CommandHistoryEntry[];
  sessionId: string;
  connectionId: string;
  connectionName: string;
  sessionType: "ssh" | "local" | "serial" | "multiplayer";
  connected: boolean;
  cursorKnown: boolean;
  alternateScreen: boolean;
  mouseTracking: boolean;
  cwd?: string;
  persistent?: boolean;
  broadcast?: boolean;
  sshSessionKnown?: boolean;
}

export interface LocalSuggestion {
  command: string;
  entryId: string;
  sessionName: string;
  timestamp: number;
  label: "Voltius local suggestion";
}

export interface RemoteSuggestion extends Omit<LocalSuggestion, "label"> {
  label: "Remote directory suggestion";
  isDir: boolean;
}

export interface NativeShellSuggestion extends Omit<LocalSuggestion, "label"> {
  label: "Remote shell suggestion";
  description?: string;
}

export type TerminalSuggestion = LocalSuggestion | RemoteSuggestion | NativeShellSuggestion;

const SECRET_PATTERN = /(?:password|passwd|token|secret|api[_-]?key|private[_-]?key|--pass(?:word)?(?:=|\s))/i;

/** Conservative privacy filter for the local suggestion index. */
export function isSafeSuggestion(command: string): boolean {
  return command.length <= 1000 && !command.includes("\n") && !SECRET_PATTERN.test(command);
}

/**
 * Rank suggestions from device-local history. Remote path suggestions are
 * requested separately by the terminal controller. An empty result is the safe
 * fallback for serial, multiplayer, disconnected, TUI, and uncertain cursor
 * contexts.
 */
export function getLocalSuggestions(context: SuggestionContext, limit = 8): LocalSuggestion[] {
  if (!context.connected || !context.cursorKnown || context.alternateScreen || context.mouseTracking) return [];
  if (context.sessionType === "serial" || context.sessionType === "multiplayer") return [];
  if (context.draft.length > 1000 || /[\u0000-\u001f\u007f]/.test(context.draft)) return [];

  const scoped = context.entries.filter((entry) =>
    isSafeSuggestion(entry.command) &&
    (entry.sessionId === context.sessionId || entry.connectionId === context.connectionId || entry.sessionName === context.connectionName),
  );
  return rankCommandHistory(scoped, context.draft)
    .filter((entry) => entry.command !== context.draft)
    .slice(0, limit)
    .map((entry) => ({
      command: entry.command,
      entryId: entry.id,
      sessionName: entry.sessionName,
      timestamp: entry.timestamp,
      label: "Voltius local suggestion" as const,
    }));
}

/** Replacement bytes for explicit insertion. It deliberately contains no Enter. */
export function suggestionInsertInput(draft: string, suggestion: string): string {
  return "\x7f".repeat(Array.from(draft).length) + suggestion;
}
