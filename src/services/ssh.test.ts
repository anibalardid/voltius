import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { sshListRemoteDir } from "./ssh";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("sshListRemoteDir", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
  });

  it("invokes the remote directory command with the exact session and path", async () => {
    await sshListRemoteDir("session-7", "/home/alice/project/src");

    expect(invoke).toHaveBeenCalledWith("ssh_list_remote_dir", {
      sessionId: "session-7",
      path: "/home/alice/project/src",
    });
  });
});
