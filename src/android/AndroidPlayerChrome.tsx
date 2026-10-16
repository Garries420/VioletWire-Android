import { useEffect, useState } from "react";
import { VioletNative } from "./native";
import { nativeStateEvent } from "./platform";
import { AndroidFloatingPlayer } from "./AndroidFloatingPlayer";
import type { NativePlayerState } from "../shared/player";

const notice = (error: unknown) =>
  window.dispatchEvent(
    new CustomEvent("android-notice", { detail: String(error) }),
  );
export function AndroidPlayerChrome() {
  const [state, setState] = useState<NativePlayerState | null>(null);
  const [miniChannel, setMiniChannel] = useState<string | null>(null);
  useEffect(() => nativeStateEvent.subscribe(setState), []);
  useEffect(() => {
    let frame = 0;
    let previous = "";
    let lastMini: string | null = null;
    const update = () => {
      const mini =
        document.querySelector<HTMLElement>(".android-mini-player-host")
          ?.dataset.channel ?? null;
      if (mini !== lastMini) {
        lastMini = mini;
        setMiniChannel(mini);
      }
      const host = document.querySelector<HTMLElement>(
        mini ? ".android-floating-video" : ".player-host.hls-surface-host",
      );
      const modal = document.querySelector(
        '[role="dialog"]:not(.vw-emote-picker):not(.android-points-sheet):not(.chat-user-card), .settings-modal-backdrop, .android-library-backdrop, .top-search-results',
      );
      const box = host?.getBoundingClientRect();
      // Native video sits above the WebView. Punch only the popup rectangles
      // out of its texture, keeping the rest of the live picture visible.
      const occlusions = [...document.querySelectorAll(".vw-emote-picker, .chat-emote-tooltip, .chat-user-card")].map(overlay => {
        const popup = overlay.getBoundingClientRect();
        return { x: popup.x, y: popup.y, width: popup.width, height: popup.height };
      }).filter(p => box && p.width > 0 && p.height > 0 && p.x < box.right && p.x + p.width > box.left && p.y < box.bottom && p.y + p.height > box.top);
      const visible = Boolean(box && box.width > 1 && box.height > 1 && !modal);
      const next = JSON.stringify([box?.x, box?.y, box?.width, box?.height, visible, window.innerWidth, mini, occlusions]);
      if (next !== previous) {
        previous = next;
        void VioletNative.bounds({
          x: box?.x ?? 0,
          y: box?.y ?? 0,
          width: box?.width ?? 0,
          height: box?.height ?? 0,
          mini: Boolean(mini),
          viewportWidth: window.innerWidth,
          visible,
          occlusions,
        }).catch(notice);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);
  if (!state || !["playing", "starting"].includes(state.status) || !miniChannel) return null;
  return <AndroidFloatingPlayer channel={miniChannel} paused={state.paused} />;
}
