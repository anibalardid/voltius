import { test, expect, beforeEach } from "vitest";
import { handleUnpromptedIntent } from "./deepLinkHandlers";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  useUIStore.setState({
    settingsOpen: false,
    settingsSection: "appearance",
    notificationCenterOpen: false,
    notificationFocusId: null,
  });
});

test("a settings link opens the modal on the requested section", () => {
  handleUnpromptedIntent({ route: "settings", section: "integrations" });
  const ui = useUIStore.getState();
  expect(ui.settingsOpen).toBe(true);
  expect(ui.settingsSection).toBe("integrations");
});

test("a billing link opens the account section and starts no checkout", () => {
  handleUnpromptedIntent({ route: "billing" });
  const ui = useUIStore.getState();
  expect(ui.settingsOpen).toBe(true);
  expect(ui.settingsSection).toBe("security");
});

test("a notification link opens the centre and carries the entry id", () => {
  handleUnpromptedIntent({ route: "notification", entryId: "invite:42" });
  expect(useUIStore.getState().notificationCenterOpen).toBe(true);
  expect(useUIStore.getState().notificationFocusId).toBe("invite:42");
});

test("a notification link without an id still opens the centre", () => {
  useUIStore.setState({ notificationFocusId: "stale" });
  handleUnpromptedIntent({ route: "notification", entryId: null });
  expect(useUIStore.getState().notificationCenterOpen).toBe(true);
  expect(useUIStore.getState().notificationFocusId).toBeNull();
});
