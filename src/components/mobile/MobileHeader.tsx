import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { ContentCounts } from "@/components/shared/ContentCounts";
import { NotificationBell } from "@/components/notifications/NotificationBell";

export default function MobileHeader({ title, onAdd }: { title?: string; onAdd?: () => void }) {
  const { t } = useTranslation();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const openSheet = useMobileNavStore((s) => s.openSheet);

  const id = selectedVaultIds[0];
  const vaultName = vaults.find((v) => v.id === id)?.name ?? t("common.entity.vault");
  const counts = useVaultContents(id);

  return (
    <header
      className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
    >
      <button
        data-mobile-vault-switch
        className="flex flex-col items-start min-w-0"
        onClick={() => openSheet({ kind: "vault-switcher" })}
      >
        <span className="flex items-center gap-1.5 text-base font-semibold text-(--t-text-primary)">
          {title ?? vaultName}
          <Icon icon="lucide:chevron-down" width={16} className="text-(--t-text-dim)" />
        </span>
        {/* Vault object counts — parity with the desktop vault header. */}
        <ContentCounts counts={counts} className="flex items-center gap-2.5 mt-0.5" />
      </button>
      <div className="flex items-center gap-1 shrink-0">
        <NotificationBell />
        {onAdd && (
          <button data-mobile-add onClick={onAdd} className="p-2 -mr-2 text-(--t-text-primary)">
            <Icon icon="lucide:plus" width={22} />
          </button>
        )}
      </div>
    </header>
  );
}
