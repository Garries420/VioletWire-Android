import { Search, X } from "lucide-react";
import { searchEmotes } from "./emote-search";
import { holdEmoteWarming } from "../renderer/src/emote-preload";
import { emotePreviewPosition } from "../renderer/src/emote-preview-position";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EmotePickerProps } from "../renderer/src/EmotePicker";
import { emoteImageUrl } from "../renderer/src/emote-image-url";
import { pickerEmoteVariant } from "../renderer/src/emote-scale";
import {
  EmotePreview,
  type EmotePreviewPosition,
  type PreviewProvider,
} from "../renderer/src/EmotePreview";
import { recentEmoteStore } from "./recent-emote-store";
import { emoteGridLayout } from "./emote-grid-layout";

type Tab = "recent" | "platform" | "third-party";
interface Emote {
  key: string;
  name: string;
  image: string;
  provider: PreviewProvider;
  width: number;
  height: number;
  scale?: number;
}
function EmoteCell({
  emote,
  columns,
  gridWidth,
  onSelect,
  onPreview,
  root,
}: {
  emote: Emote;
  root: HTMLDivElement | null;
  columns: number;
  gridWidth: number;
  onSelect(name: string): void;
  onPreview(emote: Emote, position: EmotePreviewPosition): void;
}) {
  const cell = useRef<HTMLButtonElement>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!root || !cell.current) return;
    // WebView's lazy threshold extends far beyond the tray. Only request visible rows plus one ahead.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: "44px 0px" },
    );
    observer.observe(cell.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => () => clearTimeout(retryTimer.current), []);
  const [decoded, setDecoded] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const size = emoteGridLayout(
    decoded?.width ?? emote.width,
    decoded?.height ?? emote.height,
    emote.provider,
    columns,
    gridWidth,
  );
  return (
    <button
      ref={cell}
      className="android-emote-cell"
      type="button"
      aria-label={`${emote.name}, ${emote.provider.toUpperCase()}`}
      style={{
        gridColumn: `span ${size.columnSpan}`,
        gridRow: `span ${size.rowSpan}`,
      }}
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        cancel();
        held.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        const host = event.currentTarget;
        timer.current = setTimeout(() => {
          held.current = true;
          onPreview(emote, emotePreviewPosition(host));
        }, 500);
      }}
      onPointerMove={(event) => {
        if (
          Math.hypot(
            event.clientX - origin.current.x,
            event.clientY - origin.current.y,
          ) > 8
        )
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
        held.current = true;
        onPreview(emote, emotePreviewPosition(event.currentTarget));
      }}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onSelect(emote.name);
        void recentEmoteStore.remember(emote.key).catch(() => undefined);
      }}
    >
      {failed ? (
        <span className="android-emote-image-failed">{emote.name}</span>
      ) : (
        <img
          key={attempt}
          src={visible ? emoteImageUrl(emote.image) : undefined}
          alt={emote.name}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          onError={() => {
            if (attempt >= 2) {
              setFailed(true);
              return;
            }
            retryTimer.current = setTimeout(
              () => setAttempt((current) => current + 1),
              500 * 2 ** attempt,
            );
          }}
          draggable={false}
          style={{ width: size.width, height: size.height }}
          onLoad={(event) => {
            holdEmoteWarming();
            const image = event.currentTarget;
            if (!image.naturalWidth || !image.naturalHeight) return;
            // BTTV may omit dimensions. Decode its selected asset and divide by its known scale.
            // Platform images expose an aspect ratio rather than third-party size metadata.
            const scale = emote.scale;
            setDecoded(
              scale
                ? {
                    width: image.naturalWidth / scale,
                    height: image.naturalHeight / scale,
                  }
                : {
                    width: (32 * image.naturalWidth) / image.naturalHeight,
                    height: 32,
                  },
            );
          }}
        />
      )}
    </button>
  );
}
export function AndroidEmotePicker({
  onSelect,
  providerEmotes,
  twitchEmotes,
  platformLabel = "Twitch",
  searchEnabled = false,
  open = true,
}: EmotePickerProps) {
  const [tab, setTab] = useState<Tab>("recent"),
    [recent, setRecent] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const searching = searchEnabled && query.trim().length > 0;
  const [columns, setColumns] = useState(1);
  const [gridWidth, setGridWidth] = useState(44);
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const previewVisible = useRef(false);
  const trayScroll = useRef(0);
  const [preview, setPreview] = useState<{
    emote: Emote;
    position: EmotePreviewPosition;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    const unsubscribe = recentEmoteStore.subscribe(setRecent);
    void recentEmoteStore.load().then((keys) => {
      if (!disposed) setRecent([...keys]);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!grid) return;
    const node = grid;
    const chat = node.closest<HTMLElement>(".native-chat");
    const composer = node.closest<HTMLElement>(".native-chat-input");
    const update = () => {
      if (!node.clientWidth) return;
      setColumns(Math.max(1, Math.floor((node.clientWidth - 6) / 46)));
      setGridWidth(Math.max(44, node.clientWidth - 8));
      if (chat && composer) {
        const room = Math.max(
          44,
          chat.clientHeight - (composer.clientHeight - node.clientHeight) - 8,
        );
        node.style.setProperty("--emote-grid-space", `${room}px`);
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (chat) observer.observe(chat);
    if (composer) observer.observe(composer);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [grid]);
  useEffect(() => {
    const dismiss = () => {
      if (!previewVisible.current) return;
      previewVisible.current = false;
      setPreview(null);
    };
    const back = (event: Event) => {
      if (!previewVisible.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && previewVisible.current) {
        event.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("android-back", back, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("android-back", back, true);
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (open && grid) grid.scrollTo({ top: trayScroll.current });
  }, [open, grid]);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setPreview(null);
  }
  useEffect(() => {
    previewVisible.current = false;
  }, [open]);
  const platform = useMemo<Emote[]>(
    () =>
      twitchEmotes.map((emote) => ({
        key: `${platformLabel.toLowerCase()}:${emote.id}`,
        name: emote.name,
        image: emote.imageUrl,
        provider: platformLabel === "Kick" ? "kick" : "twitch",
        width: 32,
        height: 32,
      })),
    [twitchEmotes, platformLabel],
  );
  const thirdParty = useMemo<Emote[]>(
    () =>
      (["7tv", "bttv", "ffz"] as const).flatMap((provider) =>
        [...(providerEmotes.get(provider)?.values() ?? [])].flatMap((emote) => {
          const variant = pickerEmoteVariant(emote.variants);
          return variant
            ? [
                {
                  key: `${provider}:${emote.id}`,
                  name: emote.name,
                  image: variant.url,
                  provider,
                  width: variant.width / variant.scale,
                  height: variant.height / variant.scale,
                  scale: variant.scale,
                },
              ]
            : [];
        }),
      ),
    [providerEmotes],
  );
  const available = useMemo(
    () =>
      new Map([...platform, ...thirdParty].map((emote) => [emote.key, emote])),
    [platform, thirdParty],
  );
  const emotes = searching
    ? searchEmotes([...platform, ...thirdParty], query)
    : tab === "platform"
      ? platform
      : tab === "third-party"
        ? thirdParty
        : recent.flatMap((key) => {
            const emote = available.get(key);
            return emote ? [emote] : [];
          });
  return (
    <section
      className="android-emote-picker"
      aria-label="Emote picker"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
    >
      {searchEnabled && (
        <div className="android-emote-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search emotes"
            type="search"
            placeholder="Search emotes"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              previewVisible.current = false;
              setPreview(null);
              setQuery(event.target.value);
            }}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear emote search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
      {!searching && (
        <>
          <div
            className="android-emote-tabs"
            role="tablist"
            aria-label="Emote providers"
          >
            {(
              [
                ["recent", "Recent"],
                ["platform", platformLabel],
                ["third-party", "7TV/BTTV/FFZ"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                id={`emote-tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls="android-emote-grid"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  previewVisible.current = false;
                  setPreview(null);
                  trayScroll.current = 0;
                  if (grid) grid.scrollTo({ top: 0 });
                  setTab(id);
                }}
              >
                <span>
                  {label.split("/").map((part, index) => (
                    <span key={part}>
                      {index > 0 && (
                        <>
                          /<wbr />
                        </>
                      )}
                      {part}
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <div
        className="android-emote-grid"
        id="android-emote-grid"
        role={searching ? "region" : "tabpanel"}
        aria-label={searching ? "Emote search results" : undefined}
        aria-labelledby={searching ? undefined : `emote-tab-${tab}`}
        ref={setGrid}
        onScroll={() => {
          if (open && grid) trayScroll.current = grid.scrollTop;
          previewVisible.current = false;
          setPreview(null);
        }}
      >
        {open &&
          emotes.map((emote) => (
            <EmoteCell
              key={emote.key}
              emote={emote}
              root={grid}
              columns={columns}
              gridWidth={gridWidth}
              onSelect={onSelect}
              onPreview={(item, position) => {
                previewVisible.current = true;
                setPreview({ emote: item, position });
              }}
            />
          ))}
        {!emotes.length && (
          <p>
            {searching
              ? "No matching emotes."
              : tab === "recent"
                ? "Emotes you use will appear here, most recent first."
                : "No emotes available yet."}
          </p>
        )}
      </div>
      {open && preview && (
        <EmotePreview
          position={preview.position}
          imageUrl={emoteImageUrl(preview.emote.image)}
          name={preview.emote.name}
          provider={preview.emote.provider}
        />
      )}
    </section>
  );
}
