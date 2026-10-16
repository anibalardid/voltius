import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/utils/platform";
import { useCloseTabPrompt } from "@/stores/closeTabPrompt";
import { useSessionStore } from "@/stores/sessionStore";
import { closeSession } from "@/services/closeSession";
import { sessionLabel } from "@/utils/sessionLabel";
import { Modal, ModalCard } from "@/components/shared/Modal";
import BottomSheet from "@/components/mobile/sheets/BottomSheet";

function Body({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const session = useSessionStore((s) => s.sessions.find((item) => item.id === sessionId));
  const name = session ? sessionLabel(session) : "";

  const close = () => {
    closeSession(sessionId);
    onDone();
  };
  const end = () => {
    closeSession(sessionId, true);
    onDone();
  };

  return (
    <div className="flex flex-col gap-3 p-1">
      <p className="text-sm text-(--t-text-secondary)">{t("terminal.closeTab.body")}</p>
      {name && <p className="text-xs text-(--t-text-dim) truncate">{name}</p>}
      <div className="flex flex-col gap-2">
        <button type="button" onClick={end} className="btn btn-danger min-h-11 w-full rounded-lg text-sm font-medium">
          {t("terminal.closeTab.end")}
        </button>
        <button type="button" onClick={close} className="btn btn-secondary min-h-11 w-full rounded-lg text-sm font-medium">
          {t("terminal.closeTab.close")}
        </button>
        <button type="button" onClick={onDone} className="btn btn-ghost min-h-11 w-full rounded-lg text-sm">
          {t("common.action.cancel")}
        </button>
      </div>
    </div>
  );
}

export function CloseTabPrompt() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const sessionId = useCloseTabPrompt((s) => s.sessionId);
  const clear = useCloseTabPrompt((s) => s.clear);
  if (!sessionId) return null;

  if (isMobile) {
    return (
      <BottomSheet title={t("terminal.closeTab.title")} onClose={clear}>
        <Body sessionId={sessionId} onDone={clear} />
      </BottomSheet>
    );
  }

  return (
    <Modal onClose={clear}>
      <ModalCard solid className="w-[min(26rem,calc(100vw-3rem))] p-4">
        <h2 className="text-sm font-semibold text-(--t-text-primary) px-1 pb-2">
          {t("terminal.closeTab.title")}
        </h2>
        <Body sessionId={sessionId} onDone={clear} />
      </ModalCard>
    </Modal>
  );
}
