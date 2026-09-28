import { describe, expect, it } from "vitest";
import {
  getHostListMetadata,
  HOST_LIST_ROW_CLASS,
  HOST_LIST_SLOT_NAMES,
  HOST_LIST_TRUNCATE_CLASS,
} from "./hostListLayout";

describe("host list row layout", () => {
  it("uses the same fixed slots for normal and draft rows", () => {
    expect(HOST_LIST_SLOT_NAMES).toEqual(["avatar", "name", "endpoint", "type", "source", "tag", "actions"]);
    expect(HOST_LIST_ROW_CLASS).toContain("lg:grid-cols-[2rem_minmax(8rem,1.3fr)_minmax(10rem,2fr)_minmax(4rem,0.6fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_auto]");
    expect(HOST_LIST_ROW_CLASS).toContain("grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.4fr)_auto]");
  });

  it("shows source only when the connection has the source tag", () => {
    expect(getHostListMetadata(["production"])).toEqual({ source: undefined, tags: ["production"] });
    expect(getHostListMetadata(["ssh-config"])).toEqual({ source: "ssh-config", tags: [] });
    expect(getHostListMetadata(["ssh-config", "production"])).toEqual({ source: "ssh-config", tags: ["production"] });
  });

  it("keeps text truncation and action alignment as row contracts", () => {
    expect(HOST_LIST_TRUNCATE_CLASS).toBe("min-w-0 truncate");
  });
});
