import { test } from "vitest";
import {
  armSwipeArrowGate,
  shouldSwallowSwipeArrow,
  isArrowKeySequence,
} from "./swipeArrowGate.ts";

test("swipeArrowGate", () => {
  function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
  }

  const plain = { ctrl: false, alt: false, shift: false };
  armSwipeArrowGate(1_000, 600);
  assert(shouldSwallowSwipeArrow("ArrowUp", plain, 1_100), "up during the drag is swallowed");
  assert(shouldSwallowSwipeArrow("ArrowDown", plain, 1_599), "down during the drag is swallowed");
  assert(!shouldSwallowSwipeArrow("ArrowUp", plain, 1_600), "gate expires");
  assert(!shouldSwallowSwipeArrow("ArrowUp", { ...plain, ctrl: true }, 1_100), "ctrl-up is a chord");
  assert(!shouldSwallowSwipeArrow("ArrowLeft", plain, 1_100), "horizontal arrows pass");
  assert(isArrowKeySequence("\x1b[A\x1b[B"), "csi arrows");
  assert(isArrowKeySequence("\x1bOA"), "application cursor up");
  assert(!isArrowKeySequence("ls\n"), "typed text is not an arrow sequence");
});
