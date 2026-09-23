import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useOrphanVaultIds } from "@/hooks/useAccessibleVaultIds";
import { unknownVaultLabel } from "@/hooks/accessibleVaults";
import LogoBadge from "./LogoBadge";
import { useUIStore } from "@/stores/uiStore";
import { useRipple } from "@/hooks/useRipple";
import { SidebarAccountButton } from "./SidebarAccountButton";
import { CreateVaultModal } from "@/components/shared/CreateVaultModal";
import { getUpdaterState, onUpdaterStateChange, type UpdaterStatus } from "@/services/updater";
import { useVaultAdmin } from "@/components/vault-admin/useVaultAdmin";
import { VaultAdminSurface } from "@/components/vault-admin/VaultAdminSurface";
import type { VaultAdminTarget } from "@/components/vault-admin/vaultAdminTarget";

function getInitials(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

export default function VaultSidebar() {
  const vaults = useVaultStore((s) => s.vaults);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const selectVaultOnly = useVaultStore((s) => s.selectVaultOnly);
  const addVault = useVaultStore((s) => s.addVault);
  const homeView = useUIStore((s) => s.homeView);
  const setHomeView = useUIStore((s) => s.setHomeView);
  const openSettings = useUIStore((s) => s.openSettings);
  const openWhatsNew = useUIStore((s) => s.openWhatsNew);

  const orphanVaultIds = useOrphanVaultIds();

  const [showCreateModal, setShowCreateModal] = useState(false);

  const switchToVault = (vault: { id: string }) => {
    selectVaultOnly(vault.id);
    setHomeView(false);
  };

  // One menu for the whole rail: only one row can be right-clicked at a time, so
  // a menu per row would just multiply state for no benefit.
  const [menuTarget, setMenuTarget] = useState<VaultAdminTarget | null>(null);
  const admin = useVaultAdmin(menuTarget);

  /** Opens the vault menu for `target`. Rows with nothing to administer pass no handler. */
  const menuFor = (target: VaultAdminTarget) => (e: React.MouseEvent) => {
    setMenuTarget(target);
    admin.openAtPointer(e);
  };

  const handleCreateVault = (name: string) => {
    const vault = addVault(name);
    selectVaultOnly(vault.id);
    setHomeView(false);
    setShowCreateModal(false);
  };

  return (
    <aside
      className="flex flex-col shrink-0 items-center gap-2.5 overflow-hidden bg-transparent"
      style={{ width: "4.75rem" }}
    >
      {/* App icon */}
      <AppIconButton isActive={homeView} onClick={() => setHomeView(true)} />

      <div className="w-7 h-px my-1 shrink-0" style={{ background: "var(--t-border)" }} />

      <div
        data-testid="vault-sidebar-scroll-area"
        className="flex flex-col items-center gap-2.5 min-h-0 overflow-y-auto overflow-x-hidden w-full scrollbar-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {/* Local vault buttons */}
        {vaults.map((vault) => {
          const isActive = selectedVaultIds.includes(vault.id) && !homeView;
          return (
            <VaultRailRow
              key={vault.id}
              testId={`vault-row-${vault.id}`}
              onContextMenu={menuFor({ vaultId: vault.id, name: vault.name })}
            >
              <VaultButton
                testId={`vault-button-${vault.id}`}
                initial={getInitials(vault.name)}
                label={vault.name}
                isActive={isActive}
                onClick={() => switchToVault(vault)}
              />
            </VaultRailRow>
          );
        })}

        {/* Unnamed vaults, kept visible so their hosts stay reachable. No menu:
            an orphan id has no vault record behind it, so every item the menu
            offers — rename, delete — would act on nothing. */}
        {orphanVaultIds.map((id) => {
          const isActive = selectedVaultIds.includes(id) && !homeView;
          return (
            <VaultRailRow key={id} testId={`vault-row-${id}`}>
              <VaultButton
                initial="?"
                label={unknownVaultLabel(id)}
                isActive={isActive}
                onClick={() => switchToVault({ id })}
              />
            </VaultRailRow>
          );
        })}

        {/* Add vault */}
        <AddVaultButton onClick={() => setShowCreateModal(true)} />
      </div>

      <VaultAdminSurface admin={admin} target={menuTarget} onClose={() => setMenuTarget(null)} />

      {showCreateModal && (
        <CreateVaultModal
          onConfirm={handleCreateVault}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

      <div className="flex-1" />

      {/* Account */}
      <SidebarAccountButton />

      {/* What's new */}
      <WhatsNewButton onClick={() => openWhatsNew()} />

      {/* Settings */}
      <SettingsButton onClick={() => openSettings()} />
    </aside>
  );
}

function ActivePip({ active }: { active: boolean }) {
  return (
    <span
      className="absolute left-0 rounded-r-full"
      style={{
        width: 4,
        height: active ? 40 : 20,
        background: "var(--t-text-primary)",
        transition: "height 150ms ease",
      }}
    />
  );
}

/**
 * One rail slot. Every row in the scroll area is this wrapper plus its button,
 * and binding `onContextMenu` here rather than per-row is what keeps the menu
 * from reaching only the row kind that happened to be written first.
 *
 * `AppIconButton` keeps a wrapper of its own: it looks the same but is not a
 * row — it sits outside the scroll area and drives a hover pip, so sharing this
 * one would mean widening it with props no actual row uses.
 */
function VaultRailRow({
  testId, onContextMenu, children,
}: {
  testId?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="relative flex items-center justify-center w-full shrink-0"
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}

function AppIconButton({ isActive, onClick }: { isActive: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const { createRipple, rippleEls } = useRipple();
  const [hovered, setHovered] = useState(false);
  const borderRadius = isActive || hovered ? "0.75rem" : "1.375rem";
  return (
    <div
      className="relative flex items-center justify-center w-full shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {(isActive || hovered) && <ActivePip active={isActive} />}
      <button
        onClick={onClick}
        onPointerDown={createRipple}
        title={t("layout.vaultSidebar.home")}
        className="relative overflow-hidden"
        style={{ background: "none", border: "none", padding: 0 }}
      >
        {rippleEls}
        <LogoBadge size={11} active={isActive} borderRadius={borderRadius} />
      </button>
    </div>
  );
}

function VaultButton({
  initial,
  label,
  isActive,
  onClick,
  testId,
}: {
  initial: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const { createRipple, rippleEls } = useRipple();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative flex items-center justify-center w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {(isActive || hovered) && <ActivePip active={isActive} />}
      <button
        data-testid={testId}
        onClick={onClick}
        onPointerDown={createRipple}
        title={label}
        className="flex items-center justify-center text-base font-bold relative overflow-hidden transition-all"
        style={{
          width: 44,
          height: 44,
          background: isActive
            ? "linear-gradient(145deg, color-mix(in srgb, var(--t-accent) 80%, #ffffff 20%) 0%, var(--t-accent) 60%, color-mix(in srgb, var(--t-accent) 85%, #000000 15%) 100%)"
            : "var(--t-bg-elevated)",
          color: isActive ? "#fff" : "var(--t-text-secondary)",
          borderRadius: isActive ? "0.75rem" : "1.375rem",
          boxShadow: isActive
            ? "var(--t-ring), 0 6px 14px -6px color-mix(in srgb, var(--t-accent) 55%, transparent), var(--t-highlight)"
            : "var(--t-ring), inset 0 1px 0 rgba(255,255,255,0.05)",
          transition: "border-radius 200ms, background 200ms",
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
            (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent)";
            (e.currentTarget as HTMLButtonElement).style.color = "#fff";
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
            (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
          }
        }}
      >
        {rippleEls}
        {initial}
      </button>
    </div>
  );
}

function WhatsNewButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  const { createRipple, rippleEls } = useRipple();
  const [updater, setUpdater] = useState<UpdaterStatus>(getUpdaterState);
  useEffect(() => onUpdaterStateChange(() => setUpdater(getUpdaterState())), []);

  let icon = "lucide:megaphone";
  let title = t("layout.vaultSidebar.whatsNew");
  let iconClass = "";
  let iconStyle: React.CSSProperties | undefined;
  const ready = updater.status === "ready";
  if (updater.status === "checking") {
    icon = "lucide:loader-circle";
    title = t("layout.vaultSidebar.checkingForUpdates");
    iconClass = "animate-spin";
  } else if (updater.status === "downloading") {
    icon = "lucide:download";
    title = t("layout.vaultSidebar.downloadingUpdate", { version: updater.version });
    iconClass = "animate-bounce";
  } else if (ready) {
    icon = "lucide:download";
    title = t("layout.vaultSidebar.updateReady", { version: updater.version });
    iconStyle = { color: "var(--t-accent)" };
  }

  return (
    <button
      onClick={onClick}
      onPointerDown={createRipple}
      title={title}
      className="flex items-center justify-center mb-3 relative overflow-hidden transition-all shrink-0"
      style={{
        width: 44,
        height: 44,
        borderRadius: "1.375rem",
        background: "transparent",
        color: "var(--t-text-dim)",
        transition: "border-radius 200ms, background 200ms, color 200ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
        (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
      }}
    >
      {rippleEls}
      <Icon icon={icon} width={20} className={iconClass} style={iconStyle} />
      {ready && (
        <span
          className="absolute rounded-full"
          style={{ top: 8, right: 8, width: 8, height: 8, background: "var(--t-accent)" }}
        />
      )}
    </button>
  );
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      onClick={onClick}
      onPointerDown={createRipple}
      title={t("layout.vaultSidebar.settings")}
      className="flex items-center justify-center mb-3 relative overflow-hidden transition-all shrink-0"
      style={{
        width: 44,
        height: 44,
        borderRadius: "1.375rem",
        background: "transparent",
        color: "var(--t-text-dim)",
        transition: "border-radius 200ms, background 200ms, color 200ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
        (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
      }}
    >
      {rippleEls}
      <Icon icon="lucide:settings" width={20} />
    </button>
  );
}

function AddVaultButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      onClick={onClick}
      onPointerDown={createRipple}
      title={t("layout.vaultSidebar.addVault")}
      className="flex items-center justify-center relative overflow-hidden transition-all shrink-0"
      style={{
        width: 44,
        height: 44,
        borderRadius: "1.375rem",
        border: "2px dashed var(--t-border)",
        background: "transparent",
        color: "var(--t-text-dim)",
        transition: "border-radius 200ms, background 200ms, color 200ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
      }}
    >
      {rippleEls}
      <Icon icon="lucide:plus" width={20} />
    </button>
  );
}
