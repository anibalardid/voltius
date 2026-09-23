import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useRipple } from "@/hooks/useRipple";
import { getAccountMode, lockVaultSession } from "@/services/account";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockVault } from "@/utils/accountMode";
import { sessionTimeoutLabel, sessionTimeoutValue } from "@/utils/sessionTimeout";

export function SidebarAccountButton() {
  const { t } = useTranslation();
  const { createRipple, rippleEls } = useRipple();
  const uiScale = useUIStore((s) => s.uiScale);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });
  const [accountMode, setAccountMode] = useState<string | null>(null);
  const sessionTimeoutMinutes = useSecurityStore((s) => s.sessionTimeoutMinutes);

  useEffect(() => { getAccountMode().then(setAccountMode).catch(() => setAccountMode(null)); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openDropdown = () => {
    if (open) { setOpen(false); return; }
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ bottom: window.innerHeight - rect.bottom, left: rect.right + 8 });
    }
    getAccountMode().then(setAccountMode).catch(() => {});
    setOpen(true);
  };

  const handleLockVault = async () => {
    setOpen(false);
    await lockVaultSession();
    window.location.reload();
  };

  const canLock = canLockVault(accountMode);
  const autoLockSublabel = sessionTimeoutMinutes === null
    ? t("layout.sidebarAccount.autoLockOff")
    : t("layout.sidebarAccount.autoLockAfter", { duration: sessionTimeoutLabel(t, sessionTimeoutValue(sessionTimeoutMinutes)) });

  const modeLabel =
    accountMode === "local" ? t("layout.sidebarAccount.modeLocalPassword") :
    accountMode === "local-nopassword" ? t("layout.sidebarAccount.modeLocal") :
    t("layout.sidebarAccount.localAccountFallback");

  return (
    <>
      <button
        ref={buttonRef}
        onClick={openDropdown}
        onPointerDown={createRipple}
        title={t("layout.sidebarAccount.accountTitle")}
        className="flex items-center justify-center relative overflow-hidden transition-all shrink-0"
        style={{
          width: 44,
          height: 44,
          borderRadius: open ? "0.75rem" : "1.375rem",
          background: open ? "var(--t-bg-elevated)" : "transparent",
          color: open ? "var(--t-text-bright)" : "var(--t-text-dim)",
          transition: "border-radius 200ms, background 200ms, color 200ms",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)";
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
          }
        }}
      >
        {rippleEls}
        <Icon icon="lucide:circle-user" width={18} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="surface-float fixed p-1.5 z-9999 flex flex-col min-w-56"
          style={{
            bottom: pos.bottom,
            left: pos.left,
            transform: `scale(${uiScale})`,
            transformOrigin: "bottom left",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <Icon icon="lucide:hdd" width={16} style={{ color: "var(--t-text-dim)" }} />
              <span className="text-sm font-medium truncate" style={{ color: "var(--t-text-primary)" }}>
                {modeLabel}
              </span>
            </div>
          </div>
          <div className="h-px bg-(--t-bg-input) -mx-1.5 my-0.5" />

          {canLock && (
            <DropdownMenuItem
              icon="lucide:lock"
              label={t("layout.sidebarAccount.lockVault")}
              sublabel={autoLockSublabel}
              onClick={() => void handleLockVault()}
            />
          )}

          {canLock && (
            <DropdownMenuItem
              icon="lucide:timer"
              label={t("layout.sidebarAccount.autoLock")}
              onClick={() => { setOpen(false); useUIStore.getState().openSettings("security"); }}
            />
          )}

          <DropdownMenuItem
            icon="lucide:bug"
            label={t("layout.sidebarAccount.reportBug")}
            onClick={() => { setOpen(false); useUIStore.getState().openSettings("diagnostics"); }}
          />

          <DropdownMenuItem
            icon="lucide:palette"
            label={t("layout.sidebarAccount.appearance")}
            onClick={() => { setOpen(false); useUIStore.getState().openSettings("appearance"); }}
          />
          <DropdownMenuItem
            icon="lucide:sun-moon"
            label={t("layout.sidebarAccount.toggleTheme")}
            onClick={() => { setOpen(false); useThemeStore.getState().toggleLightDark(); }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
