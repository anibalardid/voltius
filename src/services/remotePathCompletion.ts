import type { RemoteDirectoryEntry } from "./ssh";

export const REMOTE_COMPLETION_MAX_ENTRIES = 200;
export const REMOTE_COMPLETION_TIMEOUT_MS = 1500;
const MAX_PATH_LENGTH = 4096;
const UNSAFE_PATH = /[\u0000-\u001f\u007f\\'"`;$|&<>]/;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const SAFE_UNQUOTED_BASENAME = /^[A-Za-z0-9._-]+$/;

export interface RemotePathToken {
  start: number;
  end: number;
  token: string;
  remoteDirectory: string;
  replacementPrefix: string;
  typedPrefix: string;
}

export interface RemoteCompletionContext {
  enabled: boolean;
  draft: string;
  cwd?: string;
  sessionId: string;
  connectionId: string;
  sessionType: "ssh" | "local" | "serial" | "multiplayer";
  sshSessionKnown: boolean;
  connected: boolean;
  cursorKnown: boolean;
  alternateScreen: boolean;
  mouseTracking: boolean;
  persistent: boolean;
  broadcast: boolean;
}

function normalizeAbsolutePath(path: string): string | null {
  if (
    !path.startsWith("/") ||
    WINDOWS_DRIVE_PATH.test(path) ||
    path.length > MAX_PATH_LENGTH ||
    UNSAFE_PATH.test(path)
  ) return null;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}

export function normalizeRemoteDirectory(cwd: string | undefined, relative: string): string | null {
  if (
    WINDOWS_DRIVE_PATH.test(relative) ||
    relative.length > MAX_PATH_LENGTH ||
    UNSAFE_PATH.test(relative) ||
    relative.startsWith("~")
  ) return null;
  if (relative.startsWith("/")) return normalizeAbsolutePath(relative);
  const base = cwd ? normalizeAbsolutePath(cwd) : null;
  if (!base) return null;
  const combined = `${base}/${relative}`;
  return normalizeAbsolutePath(combined);
}

/** Parse only the final, unquoted shell token. Shell quoting and metacharacters are deliberately rejected. */
export function parseRemotePathToken(draft: string, cwd?: string): RemotePathToken | null {
  if (!draft || /[\u0000-\u001f\u007f]/.test(draft) || draft.endsWith(" ") || draft.endsWith("\t")) return null;
  const match = /(^|[\t ])([^\t ]+)$/.exec(draft);
  if (!match) return null;
  const token = match[2];
  const start = draft.length - token.length;
  if (UNSAFE_PATH.test(token) || token.startsWith("~")) return null;

  const slash = token.lastIndexOf("/");
  const directoryPart = slash >= 0 ? token.slice(0, slash + 1) : token === "." || token === ".." ? token : ".";
  const typedPrefix = slash >= 0 ? token.slice(slash + 1) : token === "." || token === ".." ? "" : token;
  const remoteDirectory = normalizeRemoteDirectory(cwd, directoryPart || ".");
  if (!remoteDirectory) return null;

  let replacementPrefix = slash >= 0 ? token.slice(0, slash + 1) : "";
  if (token === ".") replacementPrefix = "./";
  if (token === "..") replacementPrefix = "../";
  return { start, end: draft.length, token, remoteDirectory, replacementPrefix, typedPrefix };
}

/** Bounds and sanitizes an already-materialized directory response. This does not control SFTP READDIR requests. */
export function boundRemoteEntries(entries: RemoteDirectoryEntry[]): RemoteDirectoryEntry[] {
  return entries
    .filter((entry) =>
      typeof entry.name === "string" &&
      entry.name.length > 0 &&
      entry.name.length <= 256 &&
      !/[\u0000-\u001f\u007f/]/.test(entry.name),
    )
    .slice(0, REMOTE_COMPLETION_MAX_ENTRIES);
}

function shellQuoteBasename(name: string): string {
  if (SAFE_UNQUOTED_BASENAME.test(name)) return name;
  return `'${name.replace(/'/g, "'\\''")}'`;
}

export interface RemotePathSuggestion {
  command: string;
  entryId: string;
  sessionName: string;
  timestamp: number;
  label: "Remote directory suggestion";
  isDir: boolean;
}

export function canRequestRemoteCompletion(context: RemoteCompletionContext): boolean {
  return (
    context.enabled && context.connected && context.cursorKnown && !context.alternateScreen && !context.mouseTracking &&
    context.sessionType === "ssh" && context.sshSessionKnown && !context.broadcast && !!context.sessionId &&
    parseRemotePathToken(context.draft, context.cwd) !== null
  );
}

export function remotePathSuggestions(
  context: RemoteCompletionContext,
  entries: RemoteDirectoryEntry[],
  sessionName = "SSH",
  now = Date.now(),
): RemotePathSuggestion[] {
  if (!canRequestRemoteCompletion(context)) return [];
  const parsed = parseRemotePathToken(context.draft, context.cwd);
  if (!parsed) return [];
  return boundRemoteEntries(entries)
    .filter((entry) => entry.name.toLowerCase().startsWith(parsed.typedPrefix.toLowerCase()))
    .map((entry) => ({
      command: `${context.draft.slice(0, parsed.start)}${parsed.replacementPrefix}${shellQuoteBasename(entry.name)}${entry.isDir ? "/" : ""}`,
      entryId: `remote:${parsed.remoteDirectory}:${entry.name}`,
      sessionName,
      timestamp: now,
      label: "Remote directory suggestion" as const,
      isDir: entry.isDir,
    }));
}

export async function requestRemotePathSuggestions(
  context: RemoteCompletionContext,
  listDirectory: (sessionId: string, path: string) => Promise<RemoteDirectoryEntry[]>,
  sessionName = "SSH",
): Promise<RemotePathSuggestion[]> {
  if (!canRequestRemoteCompletion(context)) return [];
  const parsed = parseRemotePathToken(context.draft, context.cwd);
  if (!parsed) return [];
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const entries = await Promise.race([
      listDirectory(context.sessionId, parsed.remoteDirectory),
      new Promise<RemoteDirectoryEntry[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error("remote completion timeout")), REMOTE_COMPLETION_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    return remotePathSuggestions(context, entries, sessionName);
  } catch {
    return [];
  }
}

/**
 * The generation catches editor mutations; this fingerprint catches context
 * mutations that do not necessarily redraw the draft (for example broadcast
 * or persistence toggles) while a native listing is in flight.
 */
export function remoteCompletionContextFingerprint(context: RemoteCompletionContext): string {
  return JSON.stringify([
    context.enabled,
    context.draft,
    context.cwd,
    context.sessionId,
    context.connectionId,
    context.sessionType,
    context.sshSessionKnown,
    context.connected,
    context.cursorKnown,
    context.alternateScreen,
    context.mouseTracking,
    context.persistent,
    context.broadcast,
  ]);
}

export function isRemoteResultCurrent(
  requestGeneration: number,
  currentGeneration: number,
  requestContextFingerprint?: string,
  currentContext?: RemoteCompletionContext | null,
): boolean {
  if (requestGeneration !== currentGeneration) return false;
  if (requestContextFingerprint === undefined) return true;
  return currentContext !== null && currentContext !== undefined &&
    remoteCompletionContextFingerprint(currentContext) === requestContextFingerprint;
}
