import { test, expect } from "vitest";
import tauriConfSource from "../../src-tauri/tauri.conf.json?raw";
import androidManifest from "../../src-tauri/gen/android/app/src/main/AndroidManifest.xml?raw";

// The Android manifest is generated; a `tauri android init` regen drops any
// scheme this config does not declare, and the verification return matters more
// on mobile than on desktop.
test("the romix scheme is declared for desktop and mobile", () => {
  const conf = JSON.parse(tauriConfSource);
  const deepLink = conf.plugins["deep-link"];
  expect(deepLink.desktop.schemes).toContain("romix");
  expect(deepLink.mobile).toContainEqual({ scheme: ["romix"] });
});

test("the generated Android manifest carries the scheme", () => {
  expect(androidManifest).toContain('android:scheme="romix"');
});

// The App Link entry must name exact paths, not a prefix: a prefix would let a
// hostile subpath (e.g. /open/../something) ride the same verified association.
// `scheme` must be spelled out as `https` only — the plugin's `AssociatedDomain`
// defaults to `["https", "http"]`, and an `http` entry registers an insecure,
// hijackable App Link.
test("the romix.app App Link is registered for https only, with exact paths", () => {
  const conf = JSON.parse(tauriConfSource);
  const deepLink = conf.plugins["deep-link"];
  expect(deepLink.mobile).toContainEqual({
    scheme: ["https"],
    host: "romix.app",
    path: ["/open", "/open/"],
  });
  const webLinkEntries = deepLink.mobile.filter((entry: { host?: string }) => entry.host === "romix.app");
  expect(webLinkEntries).toHaveLength(1);
  expect(webLinkEntries[0].scheme).not.toContain("http");
});

test("the generated Android manifest carries an autoVerify App Link filter for romix.app", () => {
  expect(androidManifest).toContain('android:autoVerify="true"');
  expect(androidManifest).toContain('android:host="romix.app"');
  expect(androidManifest).toContain('android:path="/open"');
  expect(androidManifest).not.toContain('android:scheme="http"');
});
