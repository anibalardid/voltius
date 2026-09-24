import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { getTerminalBlockController, getTerminalSearchController, getTerminalSuggestionController, useTerminal, type TerminalSuggestionSnapshot } from "@/hooks/useTerminal";
import { FakeSearchAddon, lastKeyHandler, resetFakeXterm, terminals } from "@/hooks/__fixtures__/fakeXterm";
import { useCommandHistoryStore } from "@/stores/commandHistoryStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useTerminalCwdStore } from "@/stores/terminalCwdStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { localSendInput } from "@/services/local";
import { onSshClosed, sshListRemoteDir, sshSendInput, type RemoteDirectoryEntry } from "@/services/ssh";

// vi.mock is hoisted above every top-level binding, so each factory has to
// import the fixture itself rather than share a helper.
vi.mock("@xterm/xterm", async () => ({ Terminal: (await import("@/hooks/__fixtures__/fakeXterm")).FakeTerminal }));
vi.mock("@xterm/addon-fit", async () => ({ FitAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeFitAddon }));
vi.mock("@xterm/addon-webgl", async () => ({ WebglAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebglAddon }));
vi.mock("@xterm/addon-web-links", async () => ({ WebLinksAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebLinksAddon }));
vi.mock("@xterm/addon-search", async () => ({ SearchAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeSearchAddon }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/services/ssh", () => ({
  sshSendInput: vi.fn(), sshResize: vi.fn(),
  onSshOutput: vi.fn(async () => () => {}), onSshRestoreOutput: vi.fn(async () => () => {}), onSshClosed: vi.fn(async () => () => {}), onSshCwd: vi.fn(async () => () => {}),
  sshListRemoteDir: vi.fn(),
}));
vi.mock("@/services/local", () => ({
  localSendInput: vi.fn(), localResize: vi.fn(), localReady: vi.fn(async () => {}),
  onLocalOutput: vi.fn(async () => () => {}), onLocalClosed: vi.fn(async () => () => {}),
}));
vi.mock("@/services/serial", () => ({
  serialWrite: vi.fn(), onSerialOutput: vi.fn(async () => () => {}), onSerialClosed: vi.fn(async () => () => {}),
}));
// Returning null keeps the clipboard out of the way: useTerminal forwards every
// key to it first and honours any non-null verdict.
vi.mock("@/components/terminal/terminalClipboard", () => ({
  attachTerminalClipboard: () => ({ handleKeyEvent: () => null, dispose() {} }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let sshClosedHandler: ((remoteExit: boolean) => void) | undefined;

function Harness({
  sessionId,
  sessionType = "local",
  onClosed,
}: {
  sessionId: string;
  sessionType?: "ssh" | "local" | "serial";
  onClosed?: (remoteExit: boolean, closeIntent?: string) => void;
}) {
  const { attach } = useTerminal({ sessionId, sessionType, onClosed });
  return <div data-testid="host" ref={attach} />;
}

const ctrlG = (type: "keydown" | "keyup", shiftKey = false) =>
  new KeyboardEvent(type, { key: shiftKey ? "G" : "g", ctrlKey: true, shiftKey });

const ctrlF = () => new KeyboardEvent("keydown", { key: "f", ctrlKey: true });

/** Both spies on one event, so a claim can be asserted as a pair. */
function watchClaim(e: KeyboardEvent) {
  return {
    prevented: vi.spyOn(e, "preventDefault"),
    stopped: vi.spyOn(e, "stopPropagation"),
  };
}

function setConnectedSession(sessionId: string, type: "ssh" | "local", overrides: Record<string, unknown> = {}) {
  useSessionStore.setState({
    sessions: [{
      id: sessionId,
      type,
      status: "connected",
      connectionId: "c1",
      connectionName: "Work",
      title: "Work",
      ...overrides,
    } as never],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function waitForSuggestionSnapshot(
  picker: NonNullable<ReturnType<typeof getTerminalSuggestionController>>,
  predicate: (snapshot: TerminalSuggestionSnapshot) => boolean,
): Promise<TerminalSuggestionSnapshot> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const check = () => {
      const snapshot = picker.getSnapshot();
      if (!predicate(snapshot)) return;
      unsubscribe();
      resolve(snapshot);
    };
    unsubscribe = picker.subscribe(check);
    check();
  });
}

describe("terminal controllers", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [] });
    useCommandHistoryStore.setState({ entries: [], buffers: {} });
    useTerminalCwdStore.setState({ cwds: {} });
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: false });
    vi.mocked(sshListRemoteDir).mockReset();
    vi.mocked(sshListRemoteDir).mockResolvedValue([]);
    vi.mocked(onSshClosed).mockReset();
    vi.mocked(onSshClosed).mockImplementation(async (_sessionId, callback) => {
      sshClosedHandler = callback;
      return () => {};
    });
    sshClosedHandler = undefined;
    vi.mocked(localSendInput).mockClear();
    vi.mocked(sshSendInput).mockClear();
    useLayoutStore.setState({ broadcastActive: false, splitTabActive: false, root: null });
    resetFakeXterm();
  });

  // Returning false from the custom key handler makes xterm skip the key: it
  // encodes nothing and writes nothing to the PTY. With the search widget shut
  // that starved the shell of ^G — readline's abort, and the only way out of a
  // Ctrl+R reverse-i-search (#208).
  it("hands Ctrl+G to xterm while the search widget is closed", () => {
    render(<Harness sessionId="ctrl-g-closed" />);
    const handler = lastKeyHandler();

    expect(handler(ctrlG("keydown"))).toBe(true);
    expect(handler(ctrlG("keyup"))).toBe(true);
    expect(handler(ctrlG("keydown", true))).toBe(true);
  });

  it("drives an open search widget instead, and keeps the key from the shell", () => {
    render(<Harness sessionId="ctrl-g-open" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-open")!;
    search.open();
    // runSearch bails on an empty query, so a find is only observable with one.
    search.setQuery("needle");
    const addon = FakeSearchAddon.instances[FakeSearchAddon.instances.length - 1];
    addon.searches.length = 0;

    expect(handler(ctrlG("keydown"))).toBe(false);
    expect(handler(ctrlG("keydown", true))).toBe(false);
    expect(addon.searches).toEqual([
      { direction: "next", query: "needle" },
      { direction: "prev", query: "needle" },
    ]);

    // The chord stays consumed on the way back up, without moving the hit again.
    expect(handler(ctrlG("keyup"))).toBe(false);
    expect(addon.searches).toHaveLength(2);
  });

  // xterm returns early on a false verdict without cancelling the event, so a
  // chord the handler claims still bubbles to useKeyboard's window listener.
  // Ctrl+F and Ctrl+G are the two branches that sit above that listener's
  // isInput guard, so they are the two it would otherwise run a second time —
  // reopening the widget, or moving two hits per press.
  it("claims Ctrl+G so the window listener cannot move the hit twice", () => {
    render(<Harness sessionId="ctrl-g-claims" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-claims")!;

    const open = ctrlG("keydown");
    const claim = watchClaim(open);
    search.open();
    expect(handler(open)).toBe(false);
    expect(claim.stopped).toHaveBeenCalled();
    expect(claim.prevented).toHaveBeenCalled();

    // Closed, the shell owns the chord: xterm cancels it on the way out, so the
    // handler must leave the event alone rather than swallow it here.
    const closed = ctrlG("keydown");
    const passThrough = watchClaim(closed);
    search.close();
    expect(handler(closed)).toBe(true);
    expect(passThrough.stopped).not.toHaveBeenCalled();
    expect(passThrough.prevented).not.toHaveBeenCalled();
  });

  it("claims Ctrl+F, so only the terminal widget opens", () => {
    render(<Harness sessionId="ctrl-f-claims" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-f-claims")!;

    const e = ctrlF();
    const claim = watchClaim(e);
    expect(handler(e)).toBe(false);
    expect(search.getSnapshot().open).toBe(true);
    expect(claim.stopped).toHaveBeenCalled();
    expect(claim.prevented).toHaveBeenCalled();
  });

  it("goes back to the shell once the widget closes", () => {
    render(<Harness sessionId="ctrl-g-reclosed" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-reclosed")!;
    search.open();
    expect(handler(ctrlG("keydown"))).toBe(false);

    search.close();
    expect(handler(ctrlG("keydown"))).toBe(true);
  });

  it("registers OSC 133 blocks and navigates known markers without sending input", () => {
    render(<Harness sessionId="osc133-terminal" />);
    const term = terminals[terminals.length - 1];
    term.emitOsc(133, "A;prompt");
    term.emitOsc(133, "B;git status");
    term.emitOsc(133, "C");
    term.emitOsc(133, "D;0");

    const blocks = getTerminalBlockController("osc133-terminal")!;
    expect(blocks.getBlocks()[0]).toMatchObject({ commandMetadata: "git status", status: "finished", exitCode: 0 });
    const event = new KeyboardEvent("keydown", { key: "PageUp", altKey: true });
    expect(lastKeyHandler()(event)).toBe(false);
    expect(term.scrollToLineCalls).toEqual([0]);
  });

  it("leaves OSC 133 unhandled for serial sessions", () => {
    const sessionId = "serial-osc133-terminal";
    render(<Harness sessionId={sessionId} sessionType="serial" />);
    const term = terminals[terminals.length - 1];

    expect(term.emitOsc(133, "A;prompt")).toBe(false);
    expect(getTerminalBlockController(sessionId)!.getBlocks()).toEqual([]);
  });

  it("accepts and dismisses local suggestions without an execution newline", () => {
    const sessionId = "suggestions-terminal";
    setConnectedSession(sessionId, "local");
    render(<Harness sessionId={sessionId} />);
    const term = terminals[terminals.length - 1];
    useCommandHistoryStore.setState({
      entries: [{ id: "history-1", command: "git status", timestamp: 1, sessionId, sessionName: "Work", connectionId: "c1" }],
      buffers: {},
    });
    term.emitData("git st");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();
    expect(picker.getSnapshot().open).toBe(true);
    picker.dismiss();
    expect(picker.getSnapshot().open).toBe(false);
    picker.open();
    picker.accept();
    expect(picker.getSnapshot().open).toBe(false);
    const calls = vi.mocked(localSendInput).mock.calls;
    const sent = calls[calls.length - 1]?.[1] as Uint8Array;
    expect(new TextDecoder().decode(sent)).not.toMatch(/[\r\n]/);
  });

  it("shows local suggestions immediately and wraps arrow selection", () => {
    const sessionId = "suggestions-local-immediate";
    setConnectedSession(sessionId, "local");
    useCommandHistoryStore.setState({
      entries: [
        { id: "history-1", command: "git status", timestamp: 1, sessionId, sessionName: "Work", connectionId: "c1" },
        { id: "history-2", command: "git stash", timestamp: 2, sessionId, sessionName: "Work", connectionId: "c1" },
      ],
      buffers: {},
    });
    render(<Harness sessionId={sessionId} />);
    const term = terminals[terminals.length - 1];
    term.emitData("git st");

    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();
    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual(["git stash", "git status"]);
    expect(picker.getSnapshot().selectedIndex).toBe(0);

    picker.previous();
    expect(picker.getSnapshot().selectedIndex).toBe(1);
    picker.next();
    expect(picker.getSnapshot().selectedIndex).toBe(0);
  });

  it("appends remote suggestions asynchronously using the normalized session path", async () => {
    const sessionId = "suggestions-remote-append";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();

    expect(picker.getSnapshot().open).toBe(true);
    expect(picker.getSnapshot().suggestions).toEqual([]);
    expect(sshListRemoteDir).toHaveBeenCalledWith(sessionId, "/home/alice/project/src");

    const remoteSuggestions = waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.length === 2,
    );
    listing.resolve([{ name: "utils", isDir: true }, { name: "util.txt", isDir: false }]);
    await remoteSuggestions;

    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual(["cd src/utils/", "cd src/util.txt"]);
  });

  it("keeps local history first and removes a duplicate remote command", async () => {
    const sessionId = "suggestions-local-and-remote";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    useCommandHistoryStore.setState({
      entries: [{ id: "history-local", command: "cd src/utils/", timestamp: 1, sessionId, sessionName: "Work", connectionId: "c1" }],
      buffers: {},
    });
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();

    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual(["cd src/utils/"]);
    const mergedSuggestions = waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.length === 2,
    );
    listing.resolve([
      { name: "utils", isDir: true },
      { name: "util.txt", isDir: false },
    ]);

    await mergedSuggestions;
    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual([
      "cd src/utils/",
      "cd src/util.txt",
    ]);
  });

  it.each([
    ["draft", (_sessionId: string) => terminals[terminals.length - 1].emitData("r")],
    ["cwd", (_sessionId: string) => useTerminalCwdStore.getState().setCwd(_sessionId, "/home/alice/other")],
    ["setting", (_sessionId: string) => {
      useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(false);
      useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(true);
      getTerminalSuggestionController(_sessionId)?.open();
    }],
    ["session context", (sessionId: string) => useSessionStore.setState({ sessions: [{ id: sessionId, type: "ssh", status: "connected", connectionId: "c2", connectionName: "Other", title: "Other" } as never] })],
  ])("discards a delayed remote result after the %s changes", async (_label, change) => {
    const sessionId = `suggestions-stale-${_label.replace(" ", "-")}`;
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const first = deferred<RemoteDirectoryEntry[]>();
    const second = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd s");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();
    expect(sshListRemoteDir).toHaveBeenCalledTimes(1);

    change(sessionId);
    expect(sshListRemoteDir).toHaveBeenCalledTimes(2);
    first.resolve([{ name: "src-stale", isDir: false }]);
    const freshSuggestions = waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.some((item) => item.command === "cd src-fresh"),
    );
    second.resolve([{ name: "src-fresh", isDir: false }]);
    await freshSuggestions;
    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual(["cd src-fresh"]);
  });

  it("accepts a remote suggestion with exact insert-only PTY bytes", async () => {
    const sessionId = "suggestions-remote-exact-input";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();
    const remoteSuggestion = waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.some((item) => item.command === "cd src/utils/"),
    );
    listing.resolve([{ name: "utils", isDir: true }]);
    await remoteSuggestion;
    picker.select(0);
    picker.accept();

    const calls = vi.mocked(sshSendInput).mock.calls;
    const sent = calls[calls.length - 1]?.[1] as Uint8Array;
    expect(Array.from(sent)).toEqual([
      ...Array.from({ length: "cd src/ut".length }, () => 127),
      ...Array.from(new TextEncoder().encode("cd src/utils/")),
    ]);
    expect(Array.from(sent)).not.toContain(10);
    expect(Array.from(sent)).not.toContain(13);
  });

  it("opens remote suggestions from safe unmodified Tab without forwarding a tab", async () => {
    const sessionId = "suggestions-tab-opens-remote";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("cd src/ut");
    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);

    expect(lastKeyHandler()(tab)).toBe(false);
    expect(claim.prevented).toHaveBeenCalled();
    expect(claim.stopped).toHaveBeenCalled();
    expect(picker.getSnapshot().open).toBe(true);
    expect(sshListRemoteDir).toHaveBeenCalledWith(sessionId, "/home/alice/project/src");
    expect(vi.mocked(sshSendInput)).toHaveBeenCalledTimes(1);
    expect(Array.from(vi.mocked(sshSendInput).mock.calls[0]?.[1] ?? [])).not.toContain(9);
    listing.resolve([{ name: "utils", isDir: true }]);
    await waitForSuggestionSnapshot(picker, (snapshot) => snapshot.suggestions.length === 1);
  });

  it("intercepts Tab for case-insensitive remote path completion without forwarding it", async () => {
    const sessionId = "suggestions-tab-case-insensitive-path";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("/Va");
    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);

    expect(lastKeyHandler()(tab)).toBe(false);
    expect(claim.prevented).toHaveBeenCalled();
    expect(claim.stopped).toHaveBeenCalled();
    expect(sshListRemoteDir).toHaveBeenCalledWith(sessionId, "/");

    listing.resolve([{ name: "var", isDir: true }]);
    await waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.some((suggestion) => suggestion.command === "/var/"),
    );
    expect(picker.getSnapshot().suggestions.map((suggestion) => suggestion.command)).toEqual(["/var/"]);
    expect(vi.mocked(sshSendInput).mock.calls.flatMap(([, bytes]) => Array.from(bytes))).not.toContain(9);
  });

  it("intercepts absolute-path Tab completion before cwd is known", async () => {
    const sessionId = "suggestions-tab-absolute-path-without-cwd";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("cd /Va");
    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);

    expect(lastKeyHandler()(tab)).toBe(false);
    expect(claim.prevented).toHaveBeenCalled();
    expect(claim.stopped).toHaveBeenCalled();
    expect(sshListRemoteDir).toHaveBeenCalledWith(sessionId, "/");

    listing.resolve([{ name: "var", isDir: true }]);
    await waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.some((suggestion) => suggestion.command === "cd /var/"),
    );
    expect(picker.getSnapshot().suggestions.map((suggestion) => suggestion.command)).toEqual(["cd /var/"]);
    expect(vi.mocked(sshSendInput).mock.calls.flatMap(([, bytes]) => Array.from(bytes))).not.toContain(9);
  });

  it("leaves relative-path Tab with the shell before cwd is known", () => {
    const sessionId = "suggestions-tab-relative-path-without-cwd";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd sr");

    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
    expect(sshListRemoteDir).not.toHaveBeenCalled();
  });

  it("accepts the selected remote suggestion on Tab with insert-only bytes", async () => {
    const sessionId = "suggestions-tab-accepts-remote";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("cd src/ut");
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(false);
    listing.resolve([{ name: "utils", isDir: true }]);
    await waitForSuggestionSnapshot(picker, (snapshot) => snapshot.suggestions.length === 1);

    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(false);
    const calls = vi.mocked(sshSendInput).mock.calls;
    const sent = calls[calls.length - 1]?.[1] as Uint8Array;
    expect(Array.from(sent)).toEqual([
      ...Array.from({ length: "cd src/ut".length }, () => 127),
      ...Array.from(new TextEncoder().encode("cd src/utils/")),
    ]);
    expect(Array.from(sent)).not.toContain(9);
    expect(Array.from(sent)).not.toContain(10);
    expect(Array.from(sent)).not.toContain(13);
  });

  it("passes unsafe, local, and unknown-cursor Tab through to the shell", () => {
    const localSessionId = "suggestions-tab-local-pass-through";
    setConnectedSession(localSessionId, "local");
    render(<Harness sessionId={localSessionId} />);
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);

    const sshSessionId = "suggestions-tab-unsafe-pass-through";
    setConnectedSession(sshSessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sshSessionId, "/home/alice/project");
    render(<Harness sessionId={sshSessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))).toBe(true);
    term.emitData("\x1b[D");
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
    expect(sshListRemoteDir).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", (term: typeof terminals[number]) => term.emitData("x")],
    ["alternate screen", (term: typeof terminals[number]) => { term.buffer.active.type = "alternate"; }],
    ["mouse tracking", (term: typeof terminals[number]) => { term.modes.mouseTrackingMode = "x10"; }],
  ])("does not arm intentional Ctrl+D in a %s context", (_label, prepare) => {
    const sessionId = `ctrl-d-${String(_label).replace(" ", "-")}`;
    setConnectedSession(sessionId, "ssh");
    const closed = vi.fn();
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    const term = terminals[terminals.length - 1];
    prepare(term);
    term.emitData("\x04");
    sshClosedHandler?.(false);
    expect(sshClosedHandler).toBeDefined();
    expect(closed).toHaveBeenCalledWith(false, undefined);
  });

  it("carries one-shot intentional Ctrl+D through SSH close only for an empty normal shell", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-intentional-shell";
    setConnectedSession(sessionId, "ssh", { persist: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    terminals[terminals.length - 1].emitData("\x04");
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, "intentional-shell-exit");
  });

  it("preserves intentional Ctrl+D when the store leaves connected before SSH close arrives", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-intentional-before-close-event";
    setConnectedSession(sessionId, "ssh", { persist: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    terminals[terminals.length - 1].emitData("\x04");

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        type: "ssh",
        status: "connecting",
        connectionId: "c1",
        connectionName: "Work",
        title: "Work",
        persist: true,
      } as never],
    });
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, "intentional-shell-exit");
  });

  it("does not arm intentional Ctrl+D while broadcast is active", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-broadcast";
    setConnectedSession(sessionId, "ssh");
    useLayoutStore.setState({
      broadcastActive: true,
      splitTabActive: true,
      root: { type: "leaf", id: "pane-1", sessionId },
    });
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    terminals[terminals.length - 1].emitData("\x04");
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, undefined);
  });

  it("clears an armed Ctrl+D intent when new input arrives before close", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-cleared-by-input";
    setConnectedSession(sessionId, "ssh");
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    const term = terminals[terminals.length - 1];
    term.emitData("\x04");
    term.emitData("x");
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, undefined);
  });
});
