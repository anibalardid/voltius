import { test, expect } from "vitest";
import {
  buildDeepLink,
  parseDeepLink,
  intentKey,
  isNavigateIntent,
  isConfirmIntent,
  isUnpromptedIntent,
  DEFAULT_PLUGIN_SOURCE_ID,
  type DeepLinkIntent,
} from "./deepLinkUrl";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const cases: DeepLinkIntent[] = [
  { route: "notification", entryId: "invite:42" },
  { route: "notification", entryId: null },
  { route: "settings", section: "integrations" },
  { route: "billing" },
  { route: "snippet-install", entryId: "snippet-1" },
  { route: "plugin-install", pluginId: "plugin-docker", sourceId: "voltius" },
];

test("every route round-trips through the https form", () => {
  for (const intent of cases) {
    const url = buildDeepLink(intent, "https");
    expect(url.startsWith("https://voltius.app/open#"), url).toBe(true);
    expect(parseDeepLink(url), JSON.stringify(intent)).toEqual(intent);
  }
});

test("every route round-trips through the scheme form", () => {
  for (const intent of cases) {
    const url = buildDeepLink(intent, "scheme");
    expect(url.startsWith("voltius://"), url).toBe(true);
    expect(parseDeepLink(url), JSON.stringify(intent)).toEqual(intent);
  }
});

test("a plugin-install link defaults its source when none is named", () => {
  const parsed = parseDeepLink("voltius://plugin-install?id=plugin-docker");
  expect(parsed).toEqual({ route: "plugin-install", pluginId: "plugin-docker", sourceId: DEFAULT_PLUGIN_SOURCE_ID });
});

test("http is rejected: a cleartext App Link would be hijackable", () => {
  expect(parseDeepLink("http://voltius.app/open#settings?section=terminal")).toBeNull();
});

test("an unknown host is rejected", () => {
  expect(parseDeepLink("https://evil.example/open#settings?section=terminal")).toBeNull();
});

test("an unknown route is rejected", () => {
  expect(parseDeepLink("voltius://join?s=1&t=2")).toBeNull();
});

test("a settings link naming an unknown section is rejected", () => {
  expect(parseDeepLink("voltius://settings?section=nope")).toBeNull();
});

test("a plugin-install link with an invalid plugin id is rejected", () => {
  expect(parseDeepLink(`voltius://plugin-install?id=../evil&src=voltius`)).toBeNull();
});

test("the intent key is stable across property order", () => {
  expect(intentKey({ route: "notification", entryId: "a" })).toBe(intentKey({ entryId: "a", route: "notification" } as DeepLinkIntent));
});

test("trust classes classify the remaining routes", () => {
  expect(isNavigateIntent({ route: "settings", section: "appearance" })).toBe(true);
  expect(isNavigateIntent({ route: "billing" })).toBe(true);
  expect(isUnpromptedIntent({ route: "settings", section: "appearance" })).toBe(true);
  expect(isConfirmIntent({ route: "snippet-install", entryId: "s1" })).toBe(true);
  expect(isConfirmIntent({ route: "plugin-install", pluginId: "plugin-docker", sourceId: "voltius" })).toBe(true);
});

test("the uuid constant is not needed by any remaining route", () => {
  // Guards against a silent re-introduction of the removed vault-join route.
  expect(parseDeepLink(`voltius://vault-join?g=${UUID}&k=x`)).toBeNull();
});
