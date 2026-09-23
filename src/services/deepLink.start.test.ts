import { test, expect, beforeEach, vi } from "vitest";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import { startDeepLinks } from "./deepLink";

const URL_A = `voltius://snippet-install?id=s1`;

const getCurrent = vi.fn();
const onOpenUrl = vi.fn();
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: () => getCurrent(),
  onOpenUrl: (cb: (urls: string[]) => void) => onOpenUrl(cb),
}));

beforeEach(() => {
  getCurrent.mockReset().mockResolvedValue(null);
  onOpenUrl.mockReset().mockResolvedValue(() => {});
  useDeepLinkStore.setState({ ready: true, queue: [], prompt: null });
});

test("a cold-start url is handled", async () => {
  getCurrent.mockResolvedValue([URL_A]);
  startDeepLinks();
  await vi.waitFor(() =>
    expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "snippet-install", entryId: "s1" }),
  );
});

test("a warm url delivered through onOpenUrl is handled", async () => {
  startDeepLinks();
  await vi.waitFor(() => expect(onOpenUrl).toHaveBeenCalled());
  onOpenUrl.mock.calls[0][0]([URL_A]);
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "snippet-install", entryId: "s1" });
});

test("the same url from both paths prompts once", async () => {
  getCurrent.mockResolvedValue([URL_A]);
  startDeepLinks();
  await vi.waitFor(() =>
    expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "snippet-install", entryId: "s1" }),
  );
  const first = useDeepLinkStore.getState().prompt;
  await vi.waitFor(() => expect(onOpenUrl).toHaveBeenCalled());
  onOpenUrl.mock.calls[0][0]([URL_A]);
  expect(useDeepLinkStore.getState().prompt).toBe(first);
});

test("a plugin failure does not throw", async () => {
  getCurrent.mockRejectedValue(new Error("unsupported platform"));
  expect(() => startDeepLinks()).not.toThrow();
});
