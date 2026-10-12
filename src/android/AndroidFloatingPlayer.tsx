import { useEffect, useRef, useState } from "react";
import { Maximize2, MoveDiagonal2, Pause, Play, X } from "lucide-react";
import { androidPlatform } from "./platform";
import { fitFloating, type FloatingBounds } from "./floating-geometry";

const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});
const close = () => window.dispatchEvent(new Event("android-close-player"));
const restore = () => window.dispatchEvent(new Event("android-restore-player"));

export function AndroidFloatingPlayer({
  channel,
  paused,
}: {
  channel: string;
  paused: boolean;
}) {
  const [bounds, setBounds] = useState(() =>
    fitFloating(
      {
        left: window.innerWidth - 236,
        top: window.innerHeight - 240,
        width: 220,
      },
      viewport(),
    ),
  );
  const currentBounds = useRef(bounds);
  useEffect(() => {
    currentBounds.current = bounds;
  }, [bounds]);
  const gesture = useRef<{
    x: number;
    y: number;
    start: FloatingBounds;
    resize: boolean;
  } | null>(null);
  useEffect(() => {
    // The video is a native surface above the WebView. Receive its gestures
    // explicitly so dragging works from the picture as well as the title bar.
    const nativeDrag = (event: Event) => {
      const { phase, x, y } = (
        event as CustomEvent<{ phase: string; x: number; y: number }>
      ).detail;
      if (phase === "start") {
        gesture.current = { x, y, start: currentBounds.current, resize: false };
      } else if (phase === "move" && gesture.current) {
        const start = gesture.current;
        setBounds(
          fitFloating(
            {
              ...start.start,
              left: start.start.left + x - start.x,
              top: start.start.top + y - start.y,
            },
            viewport(),
          ),
        );
      } else if (phase === "end" || phase === "cancel") {
        gesture.current = null;
      }
    };
    window.addEventListener("android-player-gesture", nativeDrag);
    return () =>
      window.removeEventListener("android-player-gesture", nativeDrag);
  }, []);
  useEffect(() => {
    const resize = () =>
      setBounds((current) => fitFloating(current, viewport()));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return (
    <section
      className="android-floating-player"
      aria-label={`Mini player: ${channel}`}
      style={bounds}
    >
      <header
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest("button"))
            return;
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            start: bounds,
            resize: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = gesture.current;
          if (!current || current.resize) return;
          setBounds(
            fitFloating(
              {
                ...current.start,
                left: current.start.left + event.clientX - current.x,
                top: current.start.top + event.clientY - current.y,
              },
              viewport(),
            ),
          );
        }}
        onPointerUp={() => {
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
      >
        <span>{channel.replace(/^twitch:/, "")}</span>
        <button aria-label="Return to stream" onClick={restore}>
          <Maximize2 size={17} />
        </button>
        <button aria-label="Close mini player" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="android-floating-video" />
      <footer>
        <button
          aria-label={paused ? "Play stream" : "Pause stream"}
          onClick={() =>
            androidPlatform.player.controlNative({ command: "toggle-pause" })
          }
        >
          {paused ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <span>Drag to move</span>
        <button
          aria-label="Resize mini player"
          onPointerDown={(event) => {
            gesture.current = {
              x: event.clientX,
              y: event.clientY,
              start: bounds,
              resize: true,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (current?.resize)
              setBounds(
                fitFloating(
                  {
                    ...current.start,
                    width: current.start.width + event.clientX - current.x,
                  },
                  viewport(),
                ),
              );
          }}
          onPointerUp={() => {
            gesture.current = null;
          }}
          onPointerCancel={() => {
            gesture.current = null;
          }}
        >
          <MoveDiagonal2 size={18} />
        </button>
      </footer>
    </section>
  );
}
