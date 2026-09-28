import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useToggle } from "@/stores/toggleSettingsStore";
import {
  getTerminalSuggestionController,
  type TerminalSuggestionController,
  type TerminalSuggestionSnapshot,
} from "@/hooks/useTerminal";

const EMPTY: TerminalSuggestionSnapshot = { open: false, suggestions: [], selectedIndex: 0, draft: "" };

/** Insert-only picker for local history and shell-provided remote suggestions. */
export function TerminalSuggestions({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [showSuggestions] = useToggle("terminal-suggestions-overlay");
  const [controller, setController] = useState<TerminalSuggestionController | null>(null);
  const [snapshot, setSnapshot] = useState<TerminalSuggestionSnapshot>(EMPTY);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let frame = 0;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      const next = getTerminalSuggestionController(sessionId);
      if (!next) {
        frame = requestAnimationFrame(attach);
        return;
      }
      setController(next);
      setSnapshot(next.getSnapshot());
      unsubscribe = next.subscribe(() => setSnapshot(next.getSnapshot()));
    };
    attach();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      unsubscribe?.();
    };
  }, [sessionId]);

  useLayoutEffect(() => {
    if (!snapshot.open || !showSuggestions) return;
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    const viewport = list.getBoundingClientRect();
    const option = selected.getBoundingClientRect();
    if (option.top < viewport.top) list.scrollTop -= viewport.top - option.top;
    else if (option.bottom > viewport.bottom) list.scrollTop += option.bottom - viewport.bottom;
  }, [snapshot.open, snapshot.selectedIndex, snapshot.suggestions, showSuggestions]);

  if (!controller || !snapshot.open || !showSuggestions) return null;

  return (
    <div
      className="absolute right-4 top-3 z-20 w-[min(34rem,calc(100%-2rem))] overflow-hidden rounded-md border border-[var(--t-border)] bg-[var(--t-bg-card)] shadow-xl"
      role="dialog"
      aria-label={t("terminal.suggestions.title")}
    >
      <div className="flex items-center gap-2 border-b border-[var(--t-border)] px-3 py-2 text-xs text-[var(--t-text-muted)]">
        <Icon icon="lucide:sparkles" className="text-[var(--t-accent)]" />
        <span>{t("terminal.suggestions.title")}</span>
        <span className="ml-auto">{t("terminal.suggestions.keyboardHint")}</span>
      </div>
      <div ref={listRef} role="listbox" aria-label={t("terminal.suggestions.listLabel")} className="max-h-64 overflow-y-auto p-1">
        {snapshot.suggestions.length > 0 ? (
          snapshot.suggestions.map((suggestion, index) => {
            const sourceLabel = suggestion.label === "Voltius local suggestion"
              ? t("terminal.suggestions.localSource")
              : suggestion.label === "Remote shell suggestion"
                ? t("terminal.suggestions.remoteShellSource")
                : t("terminal.suggestions.remoteSource");
            return (
              <button
                key={suggestion.entryId}
                type="button"
                role="option"
                aria-selected={index === snapshot.selectedIndex}
                aria-label={t("terminal.suggestions.optionLabel", {
                  command: suggestion.command,
                  source: sourceLabel,
                  session: suggestion.sessionName,
                })}
                className={`flex w-full items-center gap-3 rounded px-2 py-2 text-left font-mono text-sm ${index === snapshot.selectedIndex ? "bg-[var(--t-bg-hover)] text-[var(--t-text)]" : "text-[var(--t-text-muted)]"}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  controller.select(index);
                  controller.accept();
                }}
              >
                <span className="min-w-0 flex-1 truncate" title={"description" in suggestion ? suggestion.description : undefined}>{suggestion.command}</span>
                <span className="shrink-0 font-sans text-[10px] text-[var(--t-text-muted)]">
                  {sourceLabel} · {suggestion.sessionName}
                </span>
              </button>
            );
          })
        ) : (
          <div className="px-2 py-4 text-center text-xs text-[var(--t-text-muted)]">{t("terminal.suggestions.empty")}</div>
        )}
      </div>
      <div className="border-t border-[var(--t-border)] px-3 py-1.5 text-[10px] text-[var(--t-text-muted)]">
        {t("terminal.suggestions.scopeNote")}
      </div>
    </div>
  );
}
