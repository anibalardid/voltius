import { useEffect, useRef, useState } from "react";
import { getTerminalApi } from "@/hooks/useTerminal";
import { scrollbarThumb, scrollbarTopFromPointer } from "./mobileTerminalGesturesCore";

const MIN_THUMB = 36;

/**
 * Slim side scrollbar. The track is only a hit target; the thumb is the
 * visible bar. Touch listeners are non-passive because iOS does not deliver
 * pointer drags to this rail the way a desktop browser does.
 */
export default function MobileTerminalScrollbar({ sessionId, active }: { sessionId: string; active: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ maxTop: number; size: number } | null>(null);
  const [thumb, setThumb] = useState<{ offset: number; size: number } | null>(null);

  const readThumb = () => {
    const api = getTerminalApi(sessionId);
    const track = trackRef.current?.clientHeight ?? 0;
    if (!api || track <= 0) return null;
    return scrollbarThumb({
      top: api.viewportTop(),
      rows: api.rows(),
      length: api.bufferLength(),
      track,
      minThumb: MIN_THUMB,
    });
  };

  useEffect(() => {
    if (!active) return;
    const read = () => {
      if (drag.current) return;
      const next = readThumb();
      setThumb(next && next.maxTop > 0 ? { offset: next.offset, size: next.size } : null);
    };
    read();
    const id = setInterval(read, 200);
    return () => clearInterval(id);
  }, [active, sessionId]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || !active) return;

    const jump = (clientY: number) => {
      const held = drag.current;
      const api = getTerminalApi(sessionId);
      if (!held || !api) return;
      const top = el.getBoundingClientRect().top;
      const line = scrollbarTopFromPointer(clientY - top, el.clientHeight, held.size, held.maxTop);
      const travel = Math.max(1, el.clientHeight - held.size);
      const offset = Math.round((line / held.maxTop) * travel);
      setThumb({ offset, size: held.size });
      api.scrollToLine(line);
    };

    const onStart = (e: TouchEvent) => {
      const next = readThumb();
      if (!next || next.maxTop === 0 || !e.touches[0]) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = { maxTop: next.maxTop, size: next.size };
      jump(e.touches[0].clientY);
    };
    const onMove = (e: TouchEvent) => {
      if (!drag.current || !e.touches[0]) return;
      e.preventDefault();
      jump(e.touches[0].clientY);
    };
    const onEnd = () => { drag.current = null; };

    const opts: AddEventListenerOptions = { passive: false };
    el.addEventListener("touchstart", onStart, opts);
    el.addEventListener("touchmove", onMove, opts);
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [active, sessionId]);

  return (
    <div
      ref={trackRef}
      data-terminal-scrollbar
      aria-label="Scroll terminal"
      className="absolute top-0 right-0 bottom-0 z-40"
      style={{ width: 22, touchAction: "none" }}
    >
      {thumb && (
        <div
          className="absolute rounded-full"
          style={{
            top: thumb.offset,
            height: thumb.size,
            right: 3,
            width: 8,
            background: "color-mix(in srgb, var(--t-text-muted) 85%, transparent)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
