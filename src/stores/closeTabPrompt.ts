import { create } from "zustand";

interface CloseTabPromptState {
  sessionId: string | null;
  ask: (sessionId: string) => void;
  clear: () => void;
}

export const useCloseTabPrompt = create<CloseTabPromptState>((set) => ({
  sessionId: null,
  ask: (sessionId) => set({ sessionId }),
  clear: () => set({ sessionId: null }),
}));
