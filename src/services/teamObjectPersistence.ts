/**
 * Local-only: there is no team-vault backend to persist to. The team maps the
 * object stores keep beside their local lists are therefore always empty, and
 * these verbs are no-ops that preserve the call shape those stores use.
 */

export type TeamObjectType =
  | "connection"
  | "identity"
  | "key"
  | "folder"
  | "snippet"
  | "snippet_folder"
  | "port_forwarding_rule";

export async function saveTeamVaultObject(
  _teamId: string,
  _objectType: TeamObjectType,
  _item: unknown,
): Promise<void> {}

export async function removeTeamVaultObject(_teamId: string, _objectId: string): Promise<void> {}
