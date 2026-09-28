import { Icon } from "@iconify/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getPlatform } from "@/utils/platform";
import { broadcastActiveForSession } from "@/stores/layoutStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { sendSessionInput } from "@/services/sessionInput";
import {
  getZmodemSession,
  pickZmodemDestination,
  pickZmodemSources,
  ZmodemSession,
  zmodemSupport,
} from "@/services/zmodem";
import type { TerminalSession } from "@/types";

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

function useZmodemSession(sessionId: string, sessionType: TerminalSession["type"]): ZmodemSession {
  return useMemo(
    () => sessionType === "ssh"
      ? getZmodemSession(sessionId, (bytes) => sendSessionInput(sessionId, "ssh", bytes))!
      : new ZmodemSession(() => {}),
    [sessionId, sessionType],
  );
}

export function ZmodemTransferBar({ session }: { session: TerminalSession }) {
  const { t } = useTranslation();
  const enabled = useTerminalSettingsStore((state) => state.zmodemEnabled);
  const zmodem = useZmodemSession(session.id, session.type);
  const snapshot = useSyncExternalStore(zmodem.subscribe.bind(zmodem), zmodem.getSnapshot.bind(zmodem), zmodem.getSnapshot.bind(zmodem));
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => { getPlatform().then(setPlatform).catch(() => setPlatform("unknown")); }, []);
  useEffect(() => {
    if (!enabled && zmodem.isActive()) void zmodem.cancel();
  }, [enabled, zmodem]);

  const support = zmodemSupport({
    sessionType: session.type,
    persistent: session.persist,
    broadcast: broadcastActiveForSession(session.id),
    platform: platform ?? "unknown",
  });
  const canStart = support.supported && session.status === "connected";
  if (!enabled) return null;

  const active = zmodem.isActive();
  const statusText = snapshot.status === "done"
    ? t("terminal.zmodem.completed")
    : snapshot.status === "error"
    ? snapshot.error ?? t("terminal.zmodem.failed")
    : snapshot.status === "cancelled"
    ? t("terminal.zmodem.cancelled")
    : snapshot.status === "rejected"
    ? t("terminal.zmodem.rejected")
    : null;

  const handleSend = async () => {
    const paths = await pickZmodemSources();
    if (paths.length) await zmodem.startSend(paths);
  };

  const handleAccept = async () => {
    if (!snapshot.offer) return;
    const destination = await pickZmodemDestination(snapshot.offer.name);
    if (destination) await zmodem.acceptReceive(destination);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-(--t-border) bg-(--t-bg-status-bar) text-xs">
      <Icon icon="lucide:arrow-left-right" width={13} className="shrink-0 text-(--t-text-dim)" />
      {!support.supported ? (
        <>
          <span className="text-(--t-text-dim)">{t(`terminal.zmodem.unsupported.${support.reason}`)}</span>
          <button className="px-2 py-0.5 rounded border border-(--t-border) opacity-50" disabled>{t("terminal.zmodem.receive")}</button>
          <button className="px-2 py-0.5 rounded border border-(--t-border) opacity-50" disabled>{t("terminal.zmodem.send")}</button>
        </>
      ) : snapshot.status === "offer" && snapshot.offer ? (
        <>
          <span className="text-(--t-text-primary) truncate" title={snapshot.offer.name}>
            {t("terminal.zmodem.offer", { name: snapshot.offer.name, size: bytesLabel(snapshot.offer.size), count: snapshot.offer.count })}
          </span>
          <button className="px-2 py-0.5 rounded bg-(--t-accent) text-white" disabled={!canStart} onClick={() => void handleAccept()}>
            {t("terminal.zmodem.chooseDestination")}
          </button>
          <button className="px-2 py-0.5 rounded border border-(--t-border)" onClick={() => void zmodem.rejectOffer()}>
            {t("terminal.zmodem.reject")}
          </button>
        </>
      ) : snapshot.status === "armed" || snapshot.status === "receiving" || snapshot.status === "sending" ? (
        <>
          <span className="text-(--t-text-dim)">
            {snapshot.status === "armed" ? t("terminal.zmodem.armed") : snapshot.status === "receiving" ? t("terminal.zmodem.receiving") : t("terminal.zmodem.sending")}
            {snapshot.totalBytes > 0 && ` · ${bytesLabel(snapshot.transferredBytes)} / ${bytesLabel(snapshot.totalBytes)}`}
          </span>
          <button className="ml-auto px-2 py-0.5 rounded border border-(--t-status-error) text-(--t-status-error)" onClick={() => void zmodem.cancel()}>
            {t("terminal.zmodem.cancel")}
          </button>
        </>
      ) : (
        <>
          <button className="px-2 py-0.5 rounded border border-(--t-border)" disabled={!canStart || active} onClick={() => zmodem.armReceive()}>
            {t("terminal.zmodem.receive")}
          </button>
          <button className="px-2 py-0.5 rounded border border-(--t-border)" disabled={!canStart || active} onClick={() => void handleSend()}>
            {t("terminal.zmodem.send")}
          </button>
          {statusText && <span className="ml-auto text-(--t-text-dim)">{statusText}</span>}
        </>
      )}
    </div>
  );
}
