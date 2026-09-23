import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/vault-admin/VaultAdminDialogs", () => ({
  VaultAdminDialogs: ({ dialog }: { dialog: string | null }) =>
    dialog ? <div data-testid="dialog">{dialog}</div> : null,
}));
vi.mock("./LogoBadge", () => ({ default: () => null }));
const orphans = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({ useOrphanVaultIds: () => orphans.ids }));

import VaultSidebar from "./VaultSidebar";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  useVaultStore.setState({
    vaults: [{ id: "v1", name: "My Vault" }],
    selectedVaultIds: ["v1"],
  });
  useUIStore.setState({ homeView: true });
  orphans.ids = [];
});
afterEach(cleanup);

test("right-clicking a vault opens the vault menu", () => {
  render(<VaultSidebar />);
  fireEvent.contextMenu(screen.getByTestId("vault-row-v1"));
  expect(screen.getByText("layout.vaultMenu.rename")).toBeTruthy();
});

test("the menu is not nested inside the vault button", () => {
  render(<VaultSidebar />);
  fireEvent.contextMenu(screen.getByTestId("vault-row-v1"));
  const item = screen.getByText("layout.vaultMenu.rename");
  expect(item.closest("button")?.getAttribute("data-testid")).not.toBe("vault-button-v1");
});

test("choosing Delete opens the delete dialog for that vault", () => {
  render(<VaultSidebar />);
  fireEvent.contextMenu(screen.getByTestId("vault-row-v1"));
  fireEvent.click(screen.getByText("layout.vaultMenu.delete"));
  expect(screen.getByTestId("dialog").textContent).toBe("delete");
});

test("an orphan row has no menu: there is no vault record for it to act on", () => {
  useVaultStore.setState({ vaults: [], selectedVaultIds: ["ghost"] });
  orphans.ids = ["ghost"];
  render(<VaultSidebar />);

  fireEvent.contextMenu(screen.getByTestId("vault-row-ghost"));

  expect(screen.queryByText("layout.vaultMenu.rename")).toBeNull();
  expect(screen.queryByText("layout.vaultMenu.delete")).toBeNull();
});
