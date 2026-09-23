import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getAccountMode, setMasterPassword, lockVaultSession } from "@/services/account";
import { resetVault } from "@/services/vault";
import { useSecurityStore } from "@/stores/securityStore";
import { ActionItem, FormButtons, SettingsInput } from "./shared";
import { VaultBackups } from "@/components/shared/VaultBackups";
import { canLockVault } from "@/utils/accountMode";
import { sessionTimeoutOptions, sessionTimeoutValue } from "@/utils/sessionTimeout";
import { FormSelect } from "@/components/shared/FormSelect";

type SecurityStep = "idle" | "password" | "loading" | "confirm-wipe";

export default function SecuritySection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<string | null>(null);
  const [step, setStep] = useState<SecurityStep>("idle");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const sessionTimeoutMinutes = useSecurityStore((s) => s.sessionTimeoutMinutes);
  const setSessionTimeoutMinutes = useSecurityStore((s) => s.setSessionTimeoutMinutes);

  useEffect(() => {
    getAccountMode().then(setMode).catch(() => setMode(null));
  }, []);

  const reset = () => {
    setStep("idle");
    setError("");
    setSuccess("");
    setPassword("");
    setConfirm("");
  };

  const handleSetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 4) {
      setError(t("settings.account.error.minLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("settings.account.error.mismatch"));
      return;
    }
    setStep("loading");
    setError("");
    try {
      await setMasterPassword(password);
      setPassword("");
      setConfirm("");
      setMode(await getAccountMode());
      setSuccess(t("settings.account.success.passwordSet"));
      setStep("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("idle");
    }
  };

  const modeLabel =
    mode === "local-nopassword" ? t("settings.account.mode.localNoPassword") :
    mode === "local" ? t("settings.account.mode.local") : t("settings.account.mode.unknown");

  const lockable = canLockVault(mode);
  const timeoutSelectValue = sessionTimeoutValue(sessionTimeoutMinutes);

  return (
    <div className="p-6 max-w-lg space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.account.modeTitle")}
        </h3>
        <div className="rounded-lg px-4 py-3 bg-(--t-bg-elevated) border border-(--t-border)">
          <p className="text-xs mb-1 text-(--t-text-dim)">{t("settings.account.currentMode")}</p>
          <div className="flex items-center gap-2">
            <Icon icon={mode === "local" ? "lucide:lock" : "lucide:key-round"} width={14} className="text-(--t-accent)" />
            <span className="text-sm font-medium text-(--t-text-primary)">{modeLabel}</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.account.sessionSecurity.title")}
        </h3>
        {lockable ? (
          <div className="rounded-lg px-4 py-3 space-y-2 bg-(--t-bg-elevated) border border-(--t-border)">
            <p className="text-xs text-(--t-text-dim)">
              {t("settings.account.sessionSecurity.autoLockLabel")}
            </p>
            <FormSelect
              value={timeoutSelectValue}
              options={sessionTimeoutOptions(t)}
              ariaLabel={t("settings.account.sessionSecurity.autoLockLabel")}
              onChange={(value) => {
                const next = value === "never" ? null : Number(value);
                setSessionTimeoutMinutes(Number.isFinite(next) ? next : null);
              }}
            />
            <p className="text-xs text-(--t-text-dim)">
              {t("settings.account.sessionSecurity.autoLockDesc")}
            </p>
          </div>
        ) : (
          <p className="text-xs text-(--t-text-muted)">
            {t("settings.account.sessionSecurity.noPasswordHint")}
          </p>
        )}
      </div>

      {success && <p className="text-xs px-1 text-(--t-status-connected)">{success}</p>}
      {error && <p className="text-xs px-1 text-(--t-status-error)">{error}</p>}

      {step === "idle" && (
        <div className="space-y-2">
          <ActionItem
            icon="lucide:key-round"
            label={t(mode === "local-nopassword"
              ? "settings.account.setMasterPassword.label"
              : "settings.account.changeMasterPassword.label")}
            sub={t(mode === "local-nopassword"
              ? "settings.account.setMasterPassword.sub"
              : "settings.account.changeMasterPassword.sub")}
            onClick={() => { reset(); setStep("password"); }}
          />
          {lockable && (
            <ActionItem
              icon="lucide:lock"
              label={t("settings.account.lockVault.label")}
              sub={t("settings.account.lockVault.sub")}
              onClick={() => {
                setError("");
                lockVaultSession()
                  .then(() => window.location.reload())
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)));
              }}
            />
          )}
          <ActionItem
            icon="lucide:trash-2"
            label={t("settings.account.wipeData.label")}
            sub={t("settings.account.wipeData.sub")}
            danger
            onClick={() => { reset(); setStep("confirm-wipe"); }}
          />
        </div>
      )}

      {step === "idle" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-(--t-text-secondary)">
            {t("shared.vaultBackups.title")}
          </p>
          <VaultBackups currentReadable />
        </div>
      )}

      {step === "confirm-wipe" && (
        <div className="space-y-3">
          <p className="text-xs text-(--t-text-muted)">
            {t("settings.account.confirmWipe.descPre")}
            <strong>{t("settings.account.confirmWipe.descBold")}</strong>
            {t("settings.account.confirmWipe.descPost")}
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 text-xs px-3 py-1.5 rounded-sm bg-(--t-bg-elevated) text-(--t-text-muted) hover:text-(--t-text-base) transition-colors"
              onClick={reset}
            >
              {t("settings.shared.cancel")}
            </button>
            <button
              className="flex-1 text-xs px-3 py-1.5 rounded-sm bg-(--t-status-error) text-white hover:opacity-80 transition-opacity font-medium"
              onClick={() => {
                setStep("loading");
                resetVault()
                  .then(() => window.location.reload())
                  .catch((e) => {
                    setError(e instanceof Error ? e.message : String(e));
                    setStep("idle");
                  });
              }}
            >
              {t("settings.account.confirmWipe.confirm")}
            </button>
          </div>
        </div>
      )}

      {step === "password" && (
        <form onSubmit={handleSetPassword} className="space-y-2">
          <p className="text-xs text-(--t-text-muted)">
            {t("settings.account.setPassword.desc")}
          </p>
          <SettingsInput
            type="password"
            placeholder={t("settings.account.setPassword.newPlaceholder")}
            value={password}
            onChange={setPassword}
            autoFocus
          />
          <SettingsInput
            type="password"
            placeholder={t("settings.account.setPassword.confirmPlaceholder")}
            value={confirm}
            onChange={setConfirm}
          />
          <FormButtons onCancel={reset} submitLabel={t("settings.account.setPassword.submit")} />
        </form>
      )}

      {step === "loading" && (
        <div className="flex items-center gap-2 px-1">
          <Icon icon="lucide:loader-circle" width={14} className="animate-spin text-(--t-accent)" />
          <span className="text-sm text-(--t-text-muted)">{t("settings.account.loading")}</span>
        </div>
      )}
    </div>
  );
}
