import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { FormSection } from "@/components/shared/Panel";
import { scanSshKeys, loadSshKeyPair, type DetectedSshKey } from "./sshKeyScan";

/**
 * Lists the private keys already in the user's ~/.ssh so they can be imported
 * with one click. Hides itself when the directory is missing/unreadable or
 * nothing in it looks like a private key.
 */
export function DetectedSshKeys({
  onPrivateKey,
  onPublicKey,
}: {
  onPrivateKey: (value: string) => void;
  onPublicKey: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<DetectedSshKey[]>([]);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void scanSshKeys().then((found) => {
      if (!cancelled) setKeys(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (keys.length === 0) return null;

  const pick = async (key: DetectedSshKey) => {
    setLoadingPath(key.path);
    try {
      const { privateKey, publicKey } = await loadSshKeyPair(key.path);
      onPrivateKey(privateKey.trim());
      if (publicKey) onPublicKey(publicKey.trim());
    } catch {
      // A key that vanished between scan and click is ignored.
    } finally {
      setLoadingPath(null);
    }
  };

  return (
    <FormSection label={t("keychain.detectedKeys.sectionLabel")}>
      <div className="space-y-0.5">
        {keys.map((key) => (
          <button
            key={key.path}
            type="button"
            disabled={loadingPath !== null}
            onClick={() => void pick(key)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors hover:bg-(--t-bg-card-hover) disabled:opacity-50"
          >
            <Icon icon="lucide:key-round" width={13} className="text-(--t-accent) shrink-0" />
            <span className="flex-1 truncate font-mono">{key.name}</span>
            <span className="text-(--t-text-dim) shrink-0">
              {key.type ?? t("keychain.keyForm.unknownType")}
            </span>
          </button>
        ))}
      </div>
    </FormSection>
  );
}
