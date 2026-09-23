import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import MobileHeader from "../MobileHeader";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import type { MorePage } from "@/stores/mobileNavCore";

function getPages(t: TFunction): { page: MorePage; label: string; icon: string }[] {
  return [
    { page: "keychain",        label: t("mobile.morePages.keychain"),        icon: "lucide:key-round" },
    { page: "port-forwarding", label: t("mobile.morePages.portForwarding"),  icon: "lucide:arrow-left-right" },
    { page: "known-hosts",     label: t("mobile.morePages.knownHosts"),      icon: "lucide:fingerprint-pattern" },
    { page: "logs",            label: t("mobile.morePages.logs"),            icon: "lucide:scroll-text" },
  ];
}

export default function MobileMoreScreen() {
  const { t } = useTranslation();
  const PAGES = getPages(t);
  const push = useMobileNavStore((s) => s.push);
  const openSettings = useUIStore((s) => s.openSettings);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader />
      <div className="flex-1 overflow-y-auto py-2">
        {PAGES.map((p) => (
          <button key={p.page} data-more-page={p.page}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-(--t-bg-card)"
            onClick={() => push({ kind: "more-page", page: p.page })}>
            <Icon icon={p.icon} width={20} className="text-(--t-text-dim)" />
            <span className="flex-1 text-sm font-medium text-(--t-text-primary)">{p.label}</span>
            <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim)" />
          </button>
        ))}
        <div className="mx-4 my-2 border-t" style={{ borderColor: "var(--t-border)" }} />
        <button data-more-page="settings"
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-(--t-bg-card)"
          onClick={() => openSettings()}>
          <Icon icon="lucide:settings" width={20} className="text-(--t-text-dim)" />
          <span className="flex-1 text-sm font-medium text-(--t-text-primary)">{t("mobile.more.settings")}</span>
        </button>
      </div>
    </div>
  );
}
