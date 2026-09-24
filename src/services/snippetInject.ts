import { broadcastActiveForSession } from "@/stores/layoutStore";
import { broadcastTargets, hasInputControl } from "@/services/broadcast";
import { sendSessionInput } from "@/services/sessionInput";
import type { TerminalSession } from "@/types";

type SessionType = TerminalSession["type"];
type InjectTarget = Pick<TerminalSession, "id" | "type"> & Partial<Pick<TerminalSession, "status">>;

export interface SnippetInjectResult {
  targetCount: number;
}

/** Re-read the current broadcast topology for labels and action affordances.
 * The injection function repeats this selection at click time. */
export function getSnippetInjectTargetCount(target: InjectTarget, execute: boolean): number {
  return selectSnippetInjectTargets([target], execute).length;
}

/** Insert pastes through the session's terminal (bracketed paste, input gate,
 *  broadcast fan-out via onData); execute writes the command plus the run newline. */
export async function snippetInject(
  sessionId: string,
  sessionType: SessionType,
  text: string,
  execute: boolean,
): Promise<boolean> {
  if (!execute) {
    // Lazy: sessionStore imports this module and useTerminal imports sessionStore.
    const { pasteToSession } = await import("@/services/terminalPaste");
    return pasteToSession(sessionId, text);
  }
  if (!hasInputControl(sessionId)) return false;
  await sendSessionInput(sessionId, sessionType, new TextEncoder().encode(`${text}\n`));
  return true;
}

export async function broadcastSnippetInject(
  targets: InjectTarget[],
  text: string,
  execute: boolean,
): Promise<SnippetInjectResult> {
  const selected = selectSnippetInjectTargets(targets, execute);
  const results = await Promise.all(selected.map((t) => snippetInject(t.id, t.type, text, execute)));
  return { targetCount: results.filter(Boolean).length };
}

/** Selects the exact action-time targets. An inserted paste fans out through
 * its terminal's onData, so it goes into one broadcast pane only. */
function selectSnippetInjectTargets(targets: InjectTarget[], execute: boolean): InjectTarget[] {
  const writable = targets.filter((t) =>
    (t.status === undefined || t.status === "connected") && hasInputControl(t.id),
  );
  const direct = writable.filter((t) => !broadcastActiveForSession(t.id));
  const broadcasting = writable.find((t) => broadcastActiveForSession(t.id));
  const fanOut = !broadcasting ? [] : execute ? broadcastTargets() : [broadcasting];
  return uniqueTargets([...direct, ...fanOut]);
}

function uniqueTargets(targets: InjectTarget[]): InjectTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
}
