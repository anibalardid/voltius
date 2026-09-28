export const HOST_LIST_ROW_CLASS =
  "!grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2.5 lg:grid-cols-[2rem_minmax(8rem,1.3fr)_minmax(10rem,2fr)_minmax(4rem,0.6fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_auto]";

export const HOST_LIST_SLOT_NAMES = ["avatar", "name", "endpoint", "type", "source", "tag", "actions"] as const;

export const HOST_LIST_TRUNCATE_CLASS = "min-w-0 truncate";

export interface HostListMetadata {
  source?: string;
  tags: string[];
}

/** Only an actual source tag is shown; an adopted untagged connection has no inferred provenance. */
export function getHostListMetadata(tags: string[]): HostListMetadata {
  const source = tags.find((tag) => tag === "ssh-config");
  return {
    source,
    tags: source ? tags.filter((tag) => tag !== source) : tags,
  };
}
