import { describe, test, expect } from "vitest";
import * as RoMixUI from "./ui";

describe("@voltius/ui public surface", () => {
  test("exports exactly the documented components", () => {
    expect(Object.keys(RoMixUI).sort()).toEqual([
      "BottomSheet", "ConfirmModal", "ConnectionAvatar", "FormSelect", "Icon", "InfoTooltip",
      "MobileScreenHeader", "StatusDot", "useActiveSession", "useAutosave", "useCopiedFlash", "useSessionById", "useT",
    ]);
  });
});
