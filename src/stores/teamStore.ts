import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Team, TeamMember, TeamRole, PendingInvitation, MyPendingInvitation } from "@/services/teamService";
export type { Team, TeamMember, TeamRole, PendingInvitation, MyPendingInvitation };

/**
 * Local-only: there are no server-backed teams. This store is retained as the
 * read surface local UI types against (vault pickers, host cards, permission
 * gates); every list is empty and every network verb is a no-op, so team-aware
 * code paths behave as "no teams" without a cascade through the UI.
 */
interface TeamStore {
  teams: Team[];
  membersByTeam: Record<string, TeamMember[]>;
  rolesByTeam: Record<string, TeamRole[]>;
  pendingInvitationsByTeam: Record<string, PendingInvitation[]>;
  myPendingInvitations: MyPendingInvitation[];
  activeTeamId: string | null;
  loading: boolean;
  self: { userId: string; online: boolean } | null;

  loadTeams: () => Promise<void>;
  createTeam: (name: string) => Promise<Team>;
  loadMembers: (teamId: string) => Promise<void>;
  addMember: (teamId: string, email: string, role?: string) => Promise<void>;
  addMemberById: (teamId: string, userId: string, role?: string) => Promise<{ status: "pending" | "already_member" }>;
  removeMember: (teamId: string, userId: string) => Promise<void>;
  setActiveTeam: (teamId: string | null) => void;
  getActiveMembers: () => TeamMember[];
  setMemberOnline: (userId: string, online: boolean) => void;
  setSelfOnline: (userId: string, online: boolean) => void;
  loadPendingInvitations: (teamId: string) => Promise<void>;
  loadMyPendingInvitations: () => Promise<void>;
  removeTeam: (teamId: string) => void;
  loadRoles: (teamId: string) => Promise<void>;
  createRole: (teamId: string, name: string, permissions: number, color?: string) => Promise<TeamRole>;
  updateRole: (teamId: string, roleId: string, updates: { name?: string; permissions?: number; color?: string; position?: number }) => Promise<void>;
  deleteRole: (teamId: string, roleId: string) => Promise<void>;
  assignMemberRole: (teamId: string, userId: string, roleId: string) => Promise<void>;
  removeMemberRole: (teamId: string, userId: string, roleId: string) => Promise<void>;
  setMemberPermissions: (teamId: string, userId: string, allow: number, deny: number) => Promise<void>;
}

export const useTeamStore = create<TeamStore>()(
  persist(
  (set, get) => ({
  teams: [],
  membersByTeam: {},
  rolesByTeam: {},
  pendingInvitationsByTeam: {},
  myPendingInvitations: [],
  activeTeamId: null,
  loading: false,
  self: null,

  loadTeams: async () => {},
  createTeam: async () => { throw new Error("Teams are not available in a local-only install"); },
  loadMembers: async () => {},
  addMember: async () => {},
  addMemberById: async () => ({ status: "pending" as const }),
  removeMember: async () => {},
  setActiveTeam: (teamId) => set({ activeTeamId: teamId }),
  loadPendingInvitations: async () => {},
  loadMyPendingInvitations: async () => {},
  removeTeam: (teamId) => {
    set((s) => ({
      teams: s.teams.filter((t) => t.id !== teamId),
      activeTeamId: s.activeTeamId === teamId ? null : s.activeTeamId,
    }));
  },
  setSelfOnline: (userId, online) => {
    set({ self: { userId, online } });
    get().setMemberOnline(userId, online);
  },
  setMemberOnline: (userId, online) =>
    set((state) => ({
      membersByTeam: Object.fromEntries(
        Object.entries(state.membersByTeam).map(([teamId, members]) => [
          teamId,
          members.map((m) => m.user_id === userId ? { ...m, is_online: online } : m),
        ])
      ),
    })),
  loadRoles: async () => {},
  createRole: async () => { throw new Error("Teams are not available in a local-only install"); },
  updateRole: async () => {},
  deleteRole: async () => {},
  assignMemberRole: async () => {},
  removeMemberRole: async () => {},
  setMemberPermissions: async () => {},
  getActiveMembers: () => {
    const { activeTeamId, membersByTeam } = get();
    if (!activeTeamId) return [];
    return membersByTeam[activeTeamId] ?? [];
  },
  }),
  {
    name: "voltius-teams",
    partialize: (state) => ({ teams: state.teams }),
  }
));
