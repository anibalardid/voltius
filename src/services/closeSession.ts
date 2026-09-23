import { useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";

/** Tear down a session: disconnect (when live) and drop it. */
export function closeSession(sessionId: string): void {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  // disconnect() is async; removeSession() drops it synchronously so it can't linger as an ungrouped tab
  if (session?.type !== "multiplayer" && (session?.status === "connected" || session?.status === "connecting")) {
    void useSessionStore.getState().disconnect(sessionId);
  }
  useSessionStore.getState().removeSession(sessionId);
}

export function closeSessionTabs(sessionIds: string[]): void {
  for (const id of sessionIds) {
    closeSession(id);
    useLayoutStore.getState().removeSession(id);
  }
  if (useSessionStore.getState().sessions.length === 0) useUIStore.getState().setActiveNav("hosts");
}
