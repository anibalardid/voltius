import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { pickLocalPath } from "@/services/sftp";
import {
  clearAllSessionRecordings,
  clearSessionRecording,
  getSessionLogConfig,
  listSessionRecordings,
  setSessionLoggingEnabled,
  setSessionLogDirectory,
  setSessionLogRetention,
  type SessionRecording,
} from "@/services/sessionLogging";
import { useSessionLoggingStore } from "@/stores/sessionLoggingStore";
import { Toggle } from "@/components/shared/Toggle";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
}

export default function SessionLoggingSettings() {
  const { t } = useTranslation();
  const enabled = useSessionLoggingStore((state) => state.enabled);
  const config = useSessionLoggingStore((state) => state.config);
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      await getSessionLogConfig();
      setRecordings(await listSessionRecordings());
    } catch {
      setError(t("settings.terminal.sessionLogging.loadError"));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const chooseDirectory = async () => {
    setBusy(true);
    setError(null);
    try {
      const directory = await pickLocalPath({
        directory: true,
        title: t("settings.terminal.sessionLogging.chooseDirectory"),
      });
      if (!directory) return;
      await setSessionLogDirectory(directory);
      setRecordings(await listSessionRecordings());
    } catch {
      setError(t("settings.terminal.sessionLogging.changeDirectoryError"));
    } finally {
      setBusy(false);
    }
  };

  const resetDirectory = async () => {
    setBusy(true);
    setError(null);
    try {
      await setSessionLogDirectory(null);
      setRecordings(await listSessionRecordings());
    } catch {
      setError(t("settings.terminal.sessionLogging.changeDirectoryError"));
    } finally {
      setBusy(false);
    }
  };

  const updateRetention = async (field: "maxFileBytes" | "maxTotalBytes" | "maxAgeDays", value: number) => {
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      await setSessionLogRetention({ ...config.retention, [field]: value });
    } catch {
      setError(t("settings.terminal.sessionLogging.retentionError"));
    } finally {
      setBusy(false);
    }
  };

  const clearOne = async (fileName: string) => {
    if (!window.confirm(t("settings.terminal.sessionLogging.confirmClearOne", { fileName }))) return;
    setBusy(true);
    try {
      await clearSessionRecording(fileName);
      setRecordings(await listSessionRecordings());
    } catch {
      setError(t("settings.terminal.sessionLogging.clearError"));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!recordings.length || !window.confirm(t("settings.terminal.sessionLogging.confirmClearAll"))) return;
    setBusy(true);
    try {
      await clearAllSessionRecordings();
      setRecordings([]);
    } catch {
      setError(t("settings.terminal.sessionLogging.clearError"));
    } finally {
      setBusy(false);
    }
  };

  const toggleLogging = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setSessionLoggingEnabled(next);
    } catch {
      setError(t("settings.terminal.sessionLogging.toggleError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-(--t-text-primary)">
            {t("settings.terminal.sessionLogging.title")}
          </h4>
          <p className="text-xs mt-1 text-(--t-text-dim)">
            {t("settings.terminal.sessionLogging.desc")}
          </p>
        </div>
        <Toggle checked={enabled} onChange={(next) => void toggleLogging(next)} />
      </div>

      <div className="flex items-start gap-2 rounded-lg border p-3 text-xs" style={{ borderColor: "color-mix(in srgb, var(--t-status-warning) 55%, transparent)", color: "var(--t-status-warning)" }}>
        <Icon icon="lucide:triangle-alert" width={15} className="shrink-0 mt-0.5" />
        <span>{t("settings.terminal.sessionLogging.privacyWarning")}</span>
      </div>

      {config && (
        <>
          <div>
            <div className="text-xs font-medium text-(--t-text-primary)">{t("settings.terminal.sessionLogging.location")}</div>
            <div className="mt-1 break-all rounded-lg bg-(--t-bg-input) border border-(--t-border) px-3 py-2 text-xs text-(--t-text-dim)">
              {config.directory}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <button className="btn btn-secondary px-3 py-1.5 rounded-lg text-xs" onClick={() => void chooseDirectory()} disabled={busy}>
                {t("settings.terminal.sessionLogging.chooseDirectory")}
              </button>
              {!config.isDefault && (
                <button className="btn btn-secondary px-3 py-1.5 rounded-lg text-xs" onClick={() => void resetDirectory()} disabled={busy}>
                  {t("settings.terminal.sessionLogging.useDefault")}
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-(--t-text-primary) mb-2">{t("settings.terminal.sessionLogging.retention")}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="text-xs text-(--t-text-dim)">
                {t("settings.terminal.sessionLogging.maxFileSize")}
                <select className="form-input w-full mt-1 px-2 py-1.5 rounded-lg text-xs" value={config.retention.maxFileBytes} onChange={(event) => void updateRetention("maxFileBytes", Number(event.target.value))} disabled={busy}>
                  {[1, 5, 10, 25, 50].map((size) => <option key={size} value={size * 1024 * 1024}>{size} MB</option>)}
                </select>
              </label>
              <label className="text-xs text-(--t-text-dim)">
                {t("settings.terminal.sessionLogging.maxTotalSize")}
                <select className="form-input w-full mt-1 px-2 py-1.5 rounded-lg text-xs" value={config.retention.maxTotalBytes} onChange={(event) => void updateRetention("maxTotalBytes", Number(event.target.value))} disabled={busy}>
                  {[50, 100, 250, 500].map((size) => <option key={size} value={size * 1024 * 1024}>{size} MB</option>)}
                </select>
              </label>
              <label className="text-xs text-(--t-text-dim)">
                {t("settings.terminal.sessionLogging.maxAge")}
                <select className="form-input w-full mt-1 px-2 py-1.5 rounded-lg text-xs" value={config.retention.maxAgeDays} onChange={(event) => void updateRetention("maxAgeDays", Number(event.target.value))} disabled={busy}>
                  {[7, 30, 90, 365].map((days) => <option key={days} value={days}>{days} {t("settings.terminal.sessionLogging.days")}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-medium text-(--t-text-primary)">{t("settings.terminal.sessionLogging.recordings")}</div>
              <button className="text-xs text-(--t-text-muted) hover:text-(--t-text-primary)" onClick={() => void refresh()} disabled={busy}>
                {t("settings.terminal.sessionLogging.refresh")}
              </button>
            </div>
            {recordings.length === 0 ? (
              <p className="text-xs text-(--t-text-dim)">{t("settings.terminal.sessionLogging.noRecordings")}</p>
            ) : (
              <div className="space-y-1">
                {recordings.map((recording) => (
                  <div key={recording.fileName} className="flex items-center gap-2 rounded-lg bg-(--t-bg-input) border border-(--t-border) px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-(--t-text-dim)" title={recording.fileName}>{recording.fileName}</span>
                    <span className="shrink-0 text-[10px] text-(--t-text-dim)">{formatBytes(recording.size)}</span>
                    <button className="shrink-0 text-(--t-status-error)" title={t("settings.terminal.sessionLogging.clearOne")} aria-label={t("settings.terminal.sessionLogging.clearOne")} onClick={() => void clearOne(recording.fileName)} disabled={busy}>
                      <Icon icon="lucide:trash-2" width={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="mt-2 btn btn-secondary px-3 py-1.5 rounded-lg text-xs text-(--t-status-error)" onClick={() => void clearAll()} disabled={busy || recordings.length === 0}>
              {t("settings.terminal.sessionLogging.clearAll")}
            </button>
          </div>
        </>
      )}

      {error && <p role="alert" className="text-xs text-(--t-status-error)">{error}</p>}
    </div>
  );
}
