// Local-only: teams and their server-backed membership no longer exist. These
// shapes are retained because local UI (vault pickers, permission gates, host
// cards) still types against them while rendering empty team data.

export interface Team {
  id: string;
  name: string;
  owner_id: string;
  owner_tier: string;
  created_at: string;
  role_ids: string[];
  permission_allow?: number;
  permission_deny?: number;
}

export interface TeamMember {
  team_id: string;
  user_id: string;
  /** The field name is the alias, the value is not: this holds the inviter's handle. */
  invited_by_display_name: string | null;
  joined_at: string;
  public_key: string;
  role_ids: string[];
  permission_allow?: number;
  permission_deny?: number;
  is_online?: boolean;
  /** An older server (no migration 035) omits this. Never render a bare "@" when absent. */
  handle?: string;
}

export interface TeamRole {
  id: string;
  team_id: string;
  name: string;
  color?: string;
  permissions: number;
  is_builtin: boolean;
  position: number;
  created_at: string;
}

export interface PendingInvitation {
  id: string;
  display_name: string;
  role: string;
  invited_by_display_name: string | null;
  created_at: string;
  expires_at: string;
  status?: "pending" | "expired";
}

export interface MyPendingInvitation {
  id: string;
  team_id: string;
  team_name: string;
  inviter_display_name: string | null;
  role: string;
  created_at: string;
  expires_at: string;
}

/**
 * There is no signed-in server identity in a local-only install, so the caller
 * has no user id to match teammates against. Returns null, as the old JWT
 * reader did once no token existed.
 */
export async function getMyUserId(): Promise<string | null> {
  return null;
}
