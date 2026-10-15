import { create } from "zustand";
import type { ListedPersistentSession } from "@/services/ssh";

interface PickerState {
  generation: number;
  connectionId: string | null;
  loading: boolean;
  sessions: ListedPersistentSession[];
  begin: (connectionId: string) => number;
  ready: (generation: number, sessions: ListedPersistentSession[]) => void;
  close: () => void;
  isCurrent: (generation: number) => boolean;
  remove: (sessionId: string) => void;
}

export const usePersistentSessionPicker = create<PickerState>((set, get) => ({
  generation: 0,
  connectionId: null,
  loading: false,
  sessions: [],
  begin: (connectionId) => {
    const generation = get().generation + 1;
    set({ generation, connectionId, loading: true, sessions: [] });
    return generation;
  },
  ready: (generation, sessions) => {
    if (get().generation !== generation) return;
    set({ loading: false, sessions });
  },
  close: () => set((s) => ({
    generation: s.generation + 1,
    connectionId: null,
    loading: false,
    sessions: [],
  })),
  isCurrent: (generation) => get().generation === generation && get().connectionId !== null,
  remove: (sessionId) => set((s) => ({
    sessions: s.sessions.filter((row) => row.sessionId !== sessionId),
  })),
}));
