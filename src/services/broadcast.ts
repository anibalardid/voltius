import { getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TerminalSession } from "@/types";

/**
 * The panes a broadcast actually reaches, in pane order. Only meaningful once
 * `broadcastActiveForSession` is true — callers still send to the origin session
 * alone when it is not.
 *
 * Skipped: a pane that is not connected.
 */
export function broadcastTargets(): TerminalSession[] {
  const sessions = useSessionStore.getState().sessions;
  const targets: TerminalSession[] = [];
  for (const targetId of getPaneSessionIds(useLayoutStore.getState().root)) {
    const target = sessions.find((s) => s.id === targetId);
    if (!target || target.status !== "connected" || target.type === "multiplayer") continue;
    targets.push(target);
  }
  return targets;
}

/** Local-only: input is never held by another participant. */
export function hasInputControl(_sessionId: string): boolean {
  return true;
}
