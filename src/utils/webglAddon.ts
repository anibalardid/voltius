import { WebglAddon } from "@xterm/addon-webgl";

// WebKit presents a WebGL canvas one draw behind unless the buffer is preserved,
// so a scroll or echo only appears on the next redraw (cursor blink). #224
const PRESERVE_DRAWING_BUFFER =
  typeof navigator !== "undefined" &&
  ((/Linux/.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)) ||
    /iPhone|iPad|iPod/.test(navigator.userAgent));

export function createWebglAddon(): WebglAddon {
  return new WebglAddon(PRESERVE_DRAWING_BUFFER);
}
