import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import LogoBadge from "./LogoBadge";
import { createLocalAccountNoPassword, login } from "@/services/account";
import { useNotificationStore } from "@/stores/notificationStore";
import { VaultUnreadableError } from "@/services/vaultErrors";
import { VaultBackups } from "@/components/shared/VaultBackups";

interface Props {
  isLocked: boolean;
  /** The vault was already found unreadable at startup, before any password was
   *  asked for — an account whose only key lives in the OS keychain. */
  vaultUnreadable?: boolean;
  onReady: () => void;
}

/** Which way the vault turned out to be unreadable — they offer different exits. */
type Unreadable = "no-password" | "wrong-key";

export default function AuthPage({ isLocked, vaultUnreadable, onReady }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unreadable, setUnreadable] = useState<Unreadable | null>(
    vaultUnreadable ? "no-password" : null,
  );

  const [password, setPassword] = useState("");
  const addToast = useNotificationStore((s) => s.addToast);

  const wrap = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError("");
    try {
      await fn();
      onReady();
    } catch (e) {
      // Not a bad password, so not the password form.
      if (e instanceof VaultUnreadableError) setUnreadable("wrong-key");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // ── Vault present but unreadable ─────────────────────────────────────────

  if (unreadable) {
    const setAside = () =>
      wrap(async () => {
        const { quarantineVault } = await import("@/services/vault");
        const backup = await quarantineVault();
        addToast({
          source: { kind: "plugin", id: "system", name: "Voltius" },
          type: "toast",
          message: t("layout.auth.vaultSetAsideToast", { file: backup }),
          severity: "info",
          duration: 8000,
        });
        window.location.reload();
      });

    // No password was ever asked for, so there is no other one to try: the
    // backups below are the only way back.
    const noPassword = unreadable === "no-password";

    return (
      <Layout>
        <p className="text-sm mb-2 text-center text-(--t-text-bright)">
          {t("layout.auth.vaultUnreadableTitle")}
        </p>
        <p className="text-xs mb-4 text-center leading-relaxed text-(--t-text-muted)">
          {t(noPassword ? "layout.auth.vaultUnreadableBodyNoPassword" : "layout.auth.vaultUnreadableBody")}
        </p>
        <ErrorMsg msg={error} />
        <ActionButton
          icon={noPassword ? "lucide:archive" : "lucide:cloud-download"}
          label={t(noPassword ? "layout.auth.vaultSetAsideLocal" : "layout.auth.vaultSetAside")}
          sub={t(noPassword ? "layout.auth.vaultSetAsideLocalSub" : "layout.auth.vaultSetAsideSub")}
          primary
          loading={loading}
          onClick={setAside}
        />
        {!noPassword && (
          <button
            type="button"
            onClick={() => { setUnreadable(null); setError(""); setPassword(""); }}
            className="mt-1 text-xs w-full text-center transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
          >
            {t("layout.auth.vaultUnreadableRetry")}
          </button>
        )}
        <VaultBackups currentReadable={false} hideWhenEmpty className="mt-4 w-full text-left" />
      </Layout>
    );
  }

  // ── Locked (vault exists, need password) ─────────────────────────────────

  if (isLocked) {
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      await wrap(() => login(password));
    };
    return (
      <Layout>
        <p className="text-xs mb-4 text-center text-(--t-text-muted)">
          {t("layout.auth.unlockPrompt")}
        </p>
        <form onSubmit={submit} className="w-full space-y-2">
          <Input type="password" placeholder={t("layout.auth.masterPasswordPlaceholder")} value={password}
            onChange={setPassword} autoFocus />
          <ErrorMsg msg={error} />
          <SubmitBtn loading={loading} label={t("layout.auth.unlock")} />
        </form>
        <button
          type="button"
          onClick={async () => {
            const { resetVault } = await import("@/services/vault");
            await resetVault();
            window.location.reload();
          }}
          className="mt-1 text-xs w-full text-center transition-colors text-(--t-text-dim) hover:text-(--t-status-error)"
        >
          {t("layout.auth.resetVault")}
        </button>
      </Layout>
    );
  }

  // ── Home (first launch) ──────────────────────────────────────────────────

  return (
    <Layout>
      <p className="text-xs mb-6 text-center text-(--t-text-muted)">
        {t("layout.auth.chooseHowToUse")}
      </p>

      <ActionButton
        icon="lucide:zap"
        label={t("layout.auth.getStarted")}
        sub={t("layout.auth.getStartedSub")}
        primary
        loading={loading}
        onClick={() => wrap(createLocalAccountNoPassword)}
      />
    </Layout>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function Layout({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-(--t-bg-terminal)">
      {onBack && (
        <button onClick={onBack}
          className="absolute top-6 left-6 flex items-center gap-1.5 text-xs transition-colors text-(--t-text-muted) hover:text-(--t-text-primary)"
        >
          <Icon icon="lucide:arrow-left" width={13} /> {t("layout.auth.back")}
        </button>
      )}

      <div className="mb-8 text-center">
        <LogoBadge size={12} className="mb-3" />
        <h1 className="text-lg font-bold text-(--t-text-bright)">Voltius</h1>
      </div>

      <div className="w-72">{children}</div>
    </div>
  );
}

function ActionButton({ icon, label, sub, primary, loading, onClick }: {
  icon: string; label: string; sub: string;
  primary?: boolean; loading?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl mb-2 text-left transition-all"
      style={{
        background: primary ? "var(--t-accent)" : "var(--t-bg-elevated)",
        border: `1px solid ${primary ? "var(--t-accent)" : "var(--t-border)"}`,
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (!primary) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border-hover)";
      }}
      onMouseLeave={(e) => {
        if (!primary) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
      }}
    >
      <Icon icon={loading ? "lucide:loader-circle" : icon} width={18}
        className={`shrink-0 ${loading ? "animate-spin" : ""}`}
        style={{ color: primary ? "white" : "var(--t-accent)" }} />
      <div>
        <p className="text-sm font-medium" style={{ color: primary ? "white" : "var(--t-text-primary)" }}>
          {label}
        </p>
        <p className="text-xs" style={{ color: primary ? "rgba(255,255,255,0.7)" : "var(--t-text-muted)" }}>
          {sub}
        </p>
      </div>
    </button>
  );
}

const INPUT_CLASS =
  "form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)";

function Input({ type, placeholder, value, onChange, autoFocus }: {
  type: string; placeholder: string; value: string;
  onChange: (v: string) => void; autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      className={INPUT_CLASS}
    />
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p className="text-xs text-center py-1 text-(--t-status-error)">{msg}</p>;
}

function SubmitBtn({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button type="submit" disabled={loading}
      className="btn btn-primary w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
      style={{ opacity: loading ? 0.7 : 1 }}
    >
      {loading && <Icon icon="lucide:loader-circle" width={14} className="animate-spin" />}
      {label}
    </button>
  );
}
