import { useEffect, useState } from "react";
import { computeKeyboardLayout, type KeyboardLayout } from "./visualViewportCore";

const INITIAL: KeyboardLayout = { keyboardVisible: false, bottomInset: 0, usableHeight: 0, offsetTop: 0 };

export function useVisualViewport(): KeyboardLayout {
  const [layout, setLayout] = useState<KeyboardLayout>(INITIAL);
  useEffect(() => {
    const vv = window.visualViewport;
    let frame: number | null = null;
    // iOS suspends the web content process on background, so a blur in the
    // `visibilitychange` that fires before suspension is lost with the process.
    // The first `window.focus` after returning is the earliest point JS runs
    // again with the WebView live.
    let wasHidden = false;
    const read = () => {
      frame = null;
      setLayout(computeKeyboardLayout({
        layoutHeight: window.innerHeight,
        visualHeight: vv ? vv.height : window.innerHeight,
        visualOffsetTop: vv ? vv.offsetTop : 0,
      }));
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(read); };
    const dismissKeyboard = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable)) {
        active.blur();
      }
      // On resume iOS can leave the document scrolled by the keyboard height
      // while visualViewport.offsetTop already reports 0, so the shell stays
      // shifted up. Reset the scroll to restore the header and full viewport.
      window.scrollTo(0, 0);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
      } else if (document.visibilityState === "visible") {
        wasHidden = false;
        schedule();
      }
    };
    const onFocus = () => {
      if (wasHidden) dismissKeyboard();
      schedule();
    };
    read();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  return layout;
}
