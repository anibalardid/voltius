import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("@/components/vault-admin/VaultAdminDialogs", () => ({
  VaultAdminDialogs: ({ dialog }: { dialog: string | null }) =>
    dialog ? <div data-testid="dialog">{dialog}</div> : null,
}));

import VaultHeader from "./VaultHeader";
import { useVaultStore } from "@/stores/vaultStore";

beforeEach(() => {
  useVaultStore.setState({
    vaults: [{ id: "v1", name: "Ops Vault" }],
    selectedVaultIds: ["v1"],
  });
});
afterEach(cleanup);

test("the vault name is a menu trigger", () => {
  render(<VaultHeader />);
  const trigger = screen.getByRole("button", { name: "layout.vaultMenu.openMenu" });
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("clicking the name opens the menu and flips aria-expanded", () => {
  render(<VaultHeader />);
  const trigger = screen.getByRole("button", { name: "layout.vaultMenu.openMenu" });
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("layout.vaultMenu.rename")).toBeTruthy();
});

test("choosing Rename opens the rename dialog", () => {
  render(<VaultHeader />);
  fireEvent.click(screen.getByRole("button", { name: "layout.vaultMenu.openMenu" }));
  fireEvent.click(screen.getByText("layout.vaultMenu.rename"));
  expect(screen.getByTestId("dialog").textContent).toBe("rename");
});

test("choosing Delete opens the delete dialog", () => {
  render(<VaultHeader />);
  fireEvent.click(screen.getByRole("button", { name: "layout.vaultMenu.openMenu" }));
  fireEvent.click(screen.getByText("layout.vaultMenu.delete"));
  expect(screen.getByTestId("dialog").textContent).toBe("delete");
});

test("the built-in personal vault has no delete entry", () => {
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }], selectedVaultIds: ["personal"] });
  render(<VaultHeader />);
  fireEvent.click(screen.getByRole("button", { name: "layout.vaultMenu.openMenu" }));
  expect(screen.queryByText("layout.vaultMenu.delete")).toBeNull();
});
