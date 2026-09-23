import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { ContentCounts } from "@/components/shared/ContentCounts";
import { StatusDot } from "@/components/shared/StatusDot";
import { useVaultAdmin } from "@/components/vault-admin/useVaultAdmin";
import { VaultAdminSurface } from "@/components/vault-admin/VaultAdminSurface";
import type { VaultAdminTarget } from "@/components/vault-admin/vaultAdminTarget";
import { chevronRotateStyle } from "@/utils/icons";

export default function VaultHeader() {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);

  // Use the first selected vault as the "active" vault.
  const activeVaultId = selectedVaultIds[0] ?? null;
  const vault = vaults.find((v) => v.id === activeVaultId) ?? null;

  const counts = useVaultContents(activeVaultId ?? "personal");

  const target: VaultAdminTarget | null = vault
    ? { vaultId: vault.id, name: vault.name }
    : null;
  const admin = useVaultAdmin(target);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!vault) return null;

  const displayName = vault.name;
  const initial = displayName.trim().charAt(0).toUpperCase();

  return (
    <div
      className="grid grid-cols-[1fr_auto_1fr] items-center shrink-0 px-5 gap-5"
      style={{
        height: "4.25rem",
        background: "transparent",
      }}
    >
      {/* Left zone: icon + vault info */}
      <div className="flex items-center gap-4 min-w-0">
        <div
          className="flex items-center justify-center shrink-0 rounded-xl text-base font-bold text-white"
          style={{
            width: 40,
            height: 40,
            background: "linear-gradient(145deg, color-mix(in srgb, var(--t-accent) 78%, #ffffff 22%) 0%, var(--t-accent) 55%, color-mix(in srgb, var(--t-accent) 82%, #000000 18%) 100%)",
            boxShadow: "var(--t-ring), 0 6px 14px -6px color-mix(in srgb, var(--t-accent) 55%, transparent), var(--t-highlight)",
          }}
        >
          {initial}
        </div>

        <div className="flex flex-col justify-center min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={admin.pos !== null}
              aria-label={t("layout.vaultMenu.openMenu")}
              onClick={() => triggerRef.current && admin.openAtElement(triggerRef.current)}
              className="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 -ml-1.5 transition-colors min-w-0"
              style={{ background: admin.pos !== null ? "var(--t-bg-elevated)" : "transparent", border: "none", cursor: "pointer" }}
            >
              <span className="text-base font-semibold truncate" style={{ color: "var(--t-text-primary)" }}>
                {displayName}
              </span>
              <Icon
                icon="lucide:chevron-down"
                width={12}
                className="shrink-0"
                style={{ color: "var(--t-text-dim)", ...chevronRotateStyle(admin.pos !== null) }}
              />
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs mt-0.5 flex-nowrap overflow-hidden" style={{ color: "var(--t-text-dim)" }}>
            <span className="flex items-center gap-1 shrink-0">
              <StatusDot tone="connected" size="sm" />
              {t("layout.vaultHeader.e2ee")}
            </span>
            <ContentCounts counts={counts} />
          </div>
        </div>
      </div>

      {/* Center zone: command palette */}
      <button
        onClick={() => setOmniOpen(true)}
        className="flex items-center gap-2 px-3.5 h-9 rounded-lg transition-colors justify-self-center w-[clamp(11rem,30vw,27.5rem)]"
        style={{
          background: "var(--t-bg-chrome-field)",
          color: "var(--t-text-secondary)",
          border: "1px solid var(--t-chrome-field-border)",
          boxShadow: "inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-chrome-field-hover)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-chrome-field)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-chrome-field-border)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent), 0 0 0 3px color-mix(in srgb, var(--t-accent) 25%, transparent)";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-chrome-field-border)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent)";
        }}
      >
        <Icon icon="lucide:search" width={14} className="shrink-0" />
        <span className="text-sm flex-1 text-left">{t("layout.vaultHeader.jumpTo")}</span>
        <kbd
          className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md"
          style={{
            background: "color-mix(in srgb, #000000 22%, transparent)",
            color: "var(--t-text-secondary)",
            border: "1px solid color-mix(in srgb, #ffffff 7%, transparent)",
          }}
        >
          <span>⌘</span>
          <span>K</span>
        </kbd>
      </button>

      {/* Right zone: reserved for plugin-contributed titlebar items */}
      <div className="flex items-center justify-end min-w-0" />

      <VaultAdminSurface admin={admin} target={target} />
    </div>
  );
}
