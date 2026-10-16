import { useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useCloseTabPrompt } from "@/stores/closeTabPrompt";

/** Tear down a session: disconnect (when live) and drop it.
 *  `endRemote` stops a persistent SSH session the way Ctrl+D does. */
export function closeSession(sessionId: string, endRemote = false): void {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  // disconnect() is async; removeSession() drops it synchronously so it can't linger as an ungrouped tab
  if (session?.type !== "multiplayer" && (session?.status === "connected" || session?.status === "connecting")) {
    void useSessionStore.getState().disconnect(sessionId, endRemote);
  }
  useSessionStore.getState().removeSession(sessionId);
}

/** User pressed a tab's X. Persistent SSH asks; everything else just closes. */
export function requestCloseTab(sessionId: string): void {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  if (session?.type === "ssh" && session.persist && (session.status === "connected" || session.status === "connecting")) {
    useCloseTabPrompt.getState().ask(sessionId);
    return;
  }
  closeSession(sessionId);
}

export function closeSessionTabs(sessionIds: string[]): void {
  for (const id of sessionIds) {
    closeSession(id);
    useLayoutStore.getState().removeSession(id);
  }
  if (useSessionStore.getState().sessions.length === 0) useUIStore.getState().setActiveNav("hosts");
}
