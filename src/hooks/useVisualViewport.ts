import { useEffect, useState } from "react";
import { computeKeyboardLayout, type KeyboardLayout } from "./visualViewportCore";

const INITIAL: KeyboardLayout = { keyboardVisible: false, bottomInset: 0, usableHeight: 0, offsetTop: 0 };

export function useVisualViewport(): KeyboardLayout {
  const [layout, setLayout] = useState<KeyboardLayout>(INITIAL);
  useEffect(() => {
    const vv = window.visualViewport;
    let frame: number | null = null;
    const read = () => {
      frame = null;
      setLayout(computeKeyboardLayout({
        layoutHeight: window.innerHeight,
        visualHeight: vv ? vv.height : window.innerHeight,
        visualOffsetTop: vv ? vv.offsetTop : 0,
      }));
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(read); };
    const onVisible = () => { if (document.visibilityState === "visible") schedule(); };
    read();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return layout;
}
