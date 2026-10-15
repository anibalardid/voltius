import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useIsMobile } from "@/utils/platform";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { readWorkspaceSnapshot } from "@/stores/workspaceSnapshotStore";
import { usePersistentSessionPicker } from "@/stores/persistentSessionPicker";
import { useSessionStore } from "@/stores/sessionStore";
import { Modal, ModalCard } from "@/components/shared/Modal";
import BottomSheet from "@/components/mobile/sheets/BottomSheet";
import type { ListedPersistentSession } from "@/services/ssh";

function labelFor(sessionId: string, connectionId: string): string | null {
  const live = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  if (live?.title?.trim()) return live.title.trim();
  const saved = readWorkspaceSnapshot()?.sessions.find(
    (s) => s.id === sessionId && s.connectionId === connectionId,
  );
  return saved?.title?.trim() || null;
}

function SessionRows({
  connectionId,
  sessions,
  onResume,
  onAskKill,
}: {
  connectionId: string;
  sessions: ListedPersistentSession[];
  onResume: (sessionId: string) => void;
  onAskKill: (session: ListedPersistentSession) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1.5">
      {sessions.map((session) => {
        const label = labelFor(session.sessionId, connectionId) ?? session.sessionId.slice(0, 8);
        const when = session.created
          ? new Date(session.created * 1000).toLocaleString()
          : null;
        const state = session.clients > 0
          ? t("terminal.persistentSessions.inUse")
          : t("terminal.persistentSessions.detached");
        return (
          <li key={`${session.backend}-${session.sessionId}`} className="flex items-stretch gap-1.5">
            <button
              type="button"
              onClick={() => onResume(session.sessionId)}
              className="flex-1 min-h-11 min-w-0 px-3 py-2 rounded-lg text-left bg-(--t-bg-base) border border-(--t-border) hover:border-(--t-accent) active:border-(--t-accent)"
            >
              <span className="block text-sm font-medium text-(--t-text-primary) truncate">{label}</span>
              <span className="block text-xs text-(--t-text-dim) truncate">
                {t("terminal.persistentSessions.resume")} · {session.backend} · {state}{when ? ` · ${when}` : ""}
              </span>
            </button>
            <button
              type="button"
              aria-label={t("terminal.persistentSessions.closeSession")}
              onClick={() => onAskKill(session)}
              className="shrink-0 min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg border border-(--t-border) text-(--t-text-dim) hover:text-(--t-status-error) active:text-(--t-status-error)"
            >
              <Icon icon="lucide:x" width={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PickerBody({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation();
  const connections = useAllConnections();
  const connection = connections.find((c) => c.id === connectionId);
  const loading = usePersistentSessionPicker((s) => s.loading);
  const sessions = usePersistentSessionPicker((s) => s.sessions);
  const close = usePersistentSessionPicker((s) => s.close);
  const remove = usePersistentSessionPicker((s) => s.remove);
  const connect = useSessionStore((s) => s.connect);
  const resumePersistent = useSessionStore((s) => s.resumePersistent);
  const killPersistent = useSessionStore((s) => s.killPersistent);
  const [pending, setPending] = useState<ListedPersistentSession | null>(null);
  const [killing, setKilling] = useState(false);
  const [killError, setKillError] = useState(false);

  const startNew = () => {
    close();
    void connect(connectionId, { offerSessions: false });
  };

  const resume = (sessionId: string) => {
    close();
    void resumePersistent(connectionId, sessionId);
  };

  const confirmKill = async () => {
    if (!pending) return;
    setKilling(true);
    setKillError(false);
    try {
      await killPersistent(connectionId, pending.sessionId);
      remove(pending.sessionId);
      setPending(null);
    } catch {
      setKillError(true);
    } finally {
      setKilling(false);
    }
  };

  if (pending) {
    return (
      <div className="flex flex-col gap-3 p-1">
        <p className="text-sm font-semibold text-(--t-text-primary)">
          {t("terminal.persistentSessions.killTitle")}
        </p>
        <p className="text-sm text-(--t-text-secondary)">
          {pending.clients > 0
            ? t("terminal.persistentSessions.killBodyInUse")
            : t("terminal.persistentSessions.killBody")}
        </p>
        {killError && (
          <p className="text-xs text-(--t-status-error)">{t("terminal.persistentSessions.killFailed")}</p>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => { setPending(null); setKillError(false); }}
            className="btn btn-secondary min-h-11 flex-1 rounded-lg text-sm font-medium"
          >
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            disabled={killing}
            onClick={() => void confirmKill()}
            className="btn btn-danger min-h-11 flex-1 rounded-lg text-sm font-medium"
          >
            {t("terminal.persistentSessions.killConfirm")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-1">
      <p className="text-xs text-(--t-text-dim) truncate">
        {connection ? connectionDisplayName(connection) : ""}
      </p>
      {loading ? (
        <p className="text-sm text-(--t-text-secondary) py-6 text-center">
          {t("terminal.persistentSessions.looking")}
        </p>
      ) : (
        <SessionRows
          connectionId={connectionId}
          sessions={sessions}
          onResume={resume}
          onAskKill={setPending}
        />
      )}
      <button
        type="button"
        onClick={startNew}
        disabled={loading}
        className="btn btn-primary min-h-11 w-full rounded-lg text-sm font-medium"
      >
        {t("terminal.persistentSessions.newSession")}
      </button>
    </div>
  );
}

export function PersistentSessionPicker() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const connectionId = usePersistentSessionPicker((s) => s.connectionId);
  const close = usePersistentSessionPicker((s) => s.close);
  if (!connectionId) return null;

  if (isMobile) {
    return (
      <BottomSheet title={t("terminal.persistentSessions.title")} onClose={close}>
        <PickerBody connectionId={connectionId} />
      </BottomSheet>
    );
  }

  return (
    <Modal onClose={close}>
      <ModalCard solid className="w-[min(28rem,calc(100vw-3rem))] max-h-[min(32rem,80vh)] overflow-y-auto p-4">
        <h2 className="text-sm font-semibold text-(--t-text-primary) px-1 pb-2">
          {t("terminal.persistentSessions.title")}
        </h2>
        <PickerBody connectionId={connectionId} />
      </ModalCard>
    </Modal>
  );
}
