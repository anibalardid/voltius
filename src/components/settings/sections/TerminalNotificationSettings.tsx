import { useTranslation } from "react-i18next";
import { Toggle } from "@/components/shared/Toggle";
import { SettingRow } from "./shared";
import {
  DEFAULT_TERMINAL_NOTIFICATION_DESTINATIONS,
  useTerminalNotificationSettingsStore,
  type TerminalNotificationDestination,
} from "@/stores/terminalNotificationSettingsStore";

const DESTINATIONS: Array<{ id: TerminalNotificationDestination; label: string; description: string }> = [
  { id: "terminal", label: "settings.terminal.notifications.terminal.title", description: "settings.terminal.notifications.terminal.desc" },
  { id: "inApp", label: "settings.terminal.notifications.inApp.title", description: "settings.terminal.notifications.inApp.desc" },
  { id: "system", label: "settings.terminal.notifications.system.title", description: "settings.terminal.notifications.system.desc" },
];

export default function TerminalNotificationSettings() {
  const { t } = useTranslation();
  const destinations = useTerminalNotificationSettingsStore((state) => state.destinations);
  const setDestination = useTerminalNotificationSettingsStore((state) => state.setDestination);

  return (
    <div className="mt-6 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 space-y-2">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-(--t-text-primary)">{t("settings.terminal.notifications.title")}</h4>
        <p className="text-xs mt-1 text-(--t-text-dim)">{t("settings.terminal.notifications.desc")}</p>
      </div>
      {DESTINATIONS.map(({ id, label, description }) => (
        <SettingRow
          key={id}
          title={t(label)}
          desc={t(description)}
          dirty={destinations[id] !== DEFAULT_TERMINAL_NOTIFICATION_DESTINATIONS[id]}
          onReset={() => setDestination(id, DEFAULT_TERMINAL_NOTIFICATION_DESTINATIONS[id])}
        >
          <Toggle checked={destinations[id]} onChange={(enabled) => setDestination(id, enabled)} />
        </SettingRow>
      ))}
      <p className="pt-2 text-xs text-(--t-text-dim)">{t("settings.terminal.notifications.commandFinishNote")}</p>
    </div>
  );
}
