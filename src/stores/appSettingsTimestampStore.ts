import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppSettingsTimestampStore {
  updatedAt: string;
  touch(): void;
}

export const useAppSettingsTimestampStore = create<AppSettingsTimestampStore>()(
  persist(
    (set) => ({
      updatedAt: new Date(0).toISOString(),
      touch: () => {
        set({ updatedAt: new Date().toISOString() });
      },
    }),
    { name: "voltius-app-settings-ts" },
  ),
);
