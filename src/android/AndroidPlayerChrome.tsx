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
        '[role="dialog"]:not(.vw-emote-picker), .settings-modal-backdrop, .android-library-backdrop, .top-search-results',
      );
      const box = host?.getBoundingClientRect();
      const covered = [...document.querySelectorAll(".vw-emote-picker, .chat-emote-tooltip")].some((overlay) => {
        const popup = overlay.getBoundingClientRect();
        return Boolean(box && popup.left < box.right && popup.right > box.left && popup.top < box.bottom && popup.bottom > box.top);
      });
      const visible = Boolean(
        box && box.width > 1 && box.height > 1 && !modal && !covered,
      );
      const next = `${box?.x},${box?.y},${box?.width},${box?.height},${visible},${window.innerWidth},${mini}`;
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
