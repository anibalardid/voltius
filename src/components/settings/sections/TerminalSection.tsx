import { useTranslation } from "react-i18next";
import { CURSOR_STYLES, DEFAULT_CURSOR_STYLE, DEFAULT_REMOTE_PATH_COMPLETION_ENABLED, useTerminalSettingsStore, type TerminalCursorStyle } from "@/stores/terminalSettingsStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { DEFAULT_SCROLLBACK_LINES, MAX_SCROLLBACK_LINES, MIN_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import { SettingRow } from "./shared";
import SessionLoggingSettings from "./SessionLoggingSettings";
import TerminalNotificationSettings from "./TerminalNotificationSettings";

export default function TerminalSection() {
  const { t } = useTranslation();
  const [cursorBlink, setCursorBlink] = useToggle("cursor-blink");
  const [scrollMinimapEnabled, setScrollMinimapEnabled] = useToggle("scroll-minimap");
  const [selectToCopy, setSelectToCopy] = useToggle("select-to-copy");
  const [dragSelectsText, setDragSelectsText] = useToggle("drag-selects-text");
  const [suggestionsOverlay, setSuggestionsOverlay] = useToggle("terminal-suggestions-overlay");
  const [ignoreBracketedPaste, setIgnoreBracketedPaste] = useToggle("ignore-bracketed-paste");
  const scrollbackLines = useTerminalSettingsStore((s) => s.scrollbackLines);
  const setScrollbackLines = useTerminalSettingsStore((s) => s.setScrollbackLines);
  const cursorStyle = useTerminalSettingsStore((s) => s.cursorStyle);
  const setCursorStyle = useTerminalSettingsStore((s) => s.setCursorStyle);
  const zmodemEnabled = useTerminalSettingsStore((s) => s.zmodemEnabled);
  const setZmodemEnabled = useTerminalSettingsStore((s) => s.setZmodemEnabled);
  const remotePathCompletionEnabled = useTerminalSettingsStore((s) => s.remotePathCompletionEnabled);
  const setRemotePathCompletionEnabled = useTerminalSettingsStore((s) => s.setRemotePathCompletionEnabled);

  const scrollbackOptions = [1_000, 10_000, 50_000, 100_000, 250_000]
    .filter((value) => value >= MIN_SCROLLBACK_LINES && value <= MAX_SCROLLBACK_LINES)
    .map((value) => ({ value: String(value), label: t("settings.terminal.scrollback.option", { count: value }) }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
          {t("settings.terminal.heading")}
        </h3>
        <SettingRow
          variant="card"
          title={t("settings.terminal.scrollback.title")}
          desc={t("settings.terminal.scrollback.desc")}
          dirty={scrollbackLines !== DEFAULT_SCROLLBACK_LINES}
          onReset={() => setScrollbackLines(DEFAULT_SCROLLBACK_LINES)}
        >
          <FormSelect
            className="w-44 shrink-0"
            value={String(scrollbackLines)}
            options={scrollbackOptions}
            onChange={(value) => setScrollbackLines(Number(value))}
          />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.cursorStyle.title")}
          desc={t("settings.terminal.cursorStyle.desc")}
          dirty={cursorStyle !== DEFAULT_CURSOR_STYLE}
          onReset={() => setCursorStyle(DEFAULT_CURSOR_STYLE)}
        >
          <FormSelect
            className="w-44 shrink-0"
            value={cursorStyle}
            options={CURSOR_STYLES.map((value) => ({ value, label: t(`settings.terminal.cursorStyle.${value}`) }))}
            onChange={(value) => setCursorStyle(value as TerminalCursorStyle)}
          />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.cursorBlink.title")}
          desc={t("settings.terminal.cursorBlink.desc")}
          dirty={cursorBlink !== TOGGLE_DEFS["cursor-blink"].default}
          onReset={() => setCursorBlink(TOGGLE_DEFS["cursor-blink"].default)}
        >
          <Toggle checked={cursorBlink} onChange={setCursorBlink} />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.minimap.title")}
          desc={t("settings.terminal.minimap.desc")}
          dirty={scrollMinimapEnabled !== TOGGLE_DEFS["scroll-minimap"].default}
          onReset={() => setScrollMinimapEnabled(TOGGLE_DEFS["scroll-minimap"].default)}
        >
          <Toggle checked={scrollMinimapEnabled} onChange={setScrollMinimapEnabled} />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.selectToCopy.title")}
          desc={t("settings.terminal.selectToCopy.desc")}
          dirty={selectToCopy !== TOGGLE_DEFS["select-to-copy"].default}
          onReset={() => setSelectToCopy(TOGGLE_DEFS["select-to-copy"].default)}
        >
          <Toggle checked={selectToCopy} onChange={setSelectToCopy} />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.dragSelectsText.title")}
          desc={t("settings.terminal.dragSelectsText.desc")}
          dirty={dragSelectsText !== TOGGLE_DEFS["drag-selects-text"].default}
          onReset={() => setDragSelectsText(TOGGLE_DEFS["drag-selects-text"].default)}
        >
          <Toggle checked={dragSelectsText} onChange={setDragSelectsText} />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.ignoreBracketedPaste.title")}
          desc={t("settings.terminal.ignoreBracketedPaste.desc")}
          dirty={ignoreBracketedPaste !== TOGGLE_DEFS["ignore-bracketed-paste"].default}
          onReset={() => setIgnoreBracketedPaste(TOGGLE_DEFS["ignore-bracketed-paste"].default)}
        >
          <Toggle checked={ignoreBracketedPaste} onChange={setIgnoreBracketedPaste} />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.zmodem.title")}
          desc={t("settings.terminal.zmodem.desc")}
          dirty={zmodemEnabled}
          onReset={() => setZmodemEnabled(false)}
        >
          <Toggle checked={zmodemEnabled} onChange={setZmodemEnabled} />
        </SettingRow>
        {zmodemEnabled && (
          <p className="mt-2 px-1 text-xs text-(--t-status-warning)">
            {t("settings.terminal.zmodem.privacyWarning")}
          </p>
        )}
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.remotePathCompletion.title")}
          desc={t("settings.terminal.remotePathCompletion.desc")}
          dirty={remotePathCompletionEnabled !== DEFAULT_REMOTE_PATH_COMPLETION_ENABLED}
          onReset={() => setRemotePathCompletionEnabled(DEFAULT_REMOTE_PATH_COMPLETION_ENABLED)}
        >
          <Toggle checked={remotePathCompletionEnabled} onChange={setRemotePathCompletionEnabled} />
        </SettingRow>
        <SettingRow
          variant="card"
          className="mt-4"
          title={t("settings.terminal.suggestionsOverlay.title")}
          desc={t("settings.terminal.suggestionsOverlay.desc")}
          dirty={suggestionsOverlay !== TOGGLE_DEFS["terminal-suggestions-overlay"].default}
          onReset={() => setSuggestionsOverlay(TOGGLE_DEFS["terminal-suggestions-overlay"].default)}
        >
          <Toggle checked={suggestionsOverlay} onChange={setSuggestionsOverlay} />
        </SettingRow>
        <SessionLoggingSettings />
        <TerminalNotificationSettings />
      </div>
    </div>
  );
}
