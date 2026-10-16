import { AndroidGameCard } from "./AndroidGameCard";
import { AndroidStreamMenu } from "./AndroidStreamMenu";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { finishStartup } from "./startup";
import { BrowseReturnCache } from "./browse-return-cache";
import {
  TrendingUp,
  Heart,
  Download,
  Search,
  Settings,
  ArrowLeft,
  Trash2,
  History,
  RefreshCw,
} from "lucide-react";
import { Preferences } from "@capacitor/preferences";
import {
  popular,
  games,
  searchChannels,
  searchStreams,
  searchVideos,
  rankChannels,
  type MobileChannel,
  type MobileGame,
  type MobilePage,
} from "./mobile-discovery";
import type { Vod } from "./vod-service";
import { durationLabel } from "./vod-service";
import { queueVod, currentPlaybackChannel } from "./platform";
type Page = "games" | "popular" | "following" | "saved";
const profile = (key: string, channel?: MobileChannel) =>
  window.dispatchEvent(
    new CustomEvent("android-open-profile", {
      detail: channel
        ? {
            channel: key,
            seed: {
              login: key,
              displayName: channel.name,
              image: channel.image,
              description: channel.title ?? "",
              live: channel.live,
              viewers: channel.viewers,
              followers: channel.followers,
              videos: [],
            },
          }
        : key,
    }),
  );
const watch = (key: string) =>
  window.dispatchEvent(new CustomEvent("android-watch-live", { detail: key }));
const number = (v: number) => v.toLocaleString();
function GamesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 2h6v5l-3 3-3-3V2Zm8 7h5v6h-5l-3-3 3-3Zm-2 8v5H9v-5l3-3 3 3ZM2 9h5l3 3-3 3H2V9Z" />
    </svg>
  );
}
export function AndroidHome() {
  const generation = useRef(0);
  const listRequestPending = useRef(false);
  const viewIdentity = useRef("");
  const followedSnapshot = useRef<MobileChannel[]>([]);
  const feed = useRef<HTMLDivElement>(null);
  const feedScroll = useRef(0);
  const restoreScroll = useRef<number | null>(null);
  const returnCache = useRef(new BrowseReturnCache<{
    channels: MobileChannel[]; categories: MobileGame[]; videos: Vod[]; cursor?: string;
  }>());

  const [chatVisible, setChatVisible] = useState(true);
  const [accounts, setAccounts] = useState<{ twitch: boolean; kick: boolean } | null>(null);
  const [libraryPage, setLibraryPage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState<Page>("following"),
    [provider, setProvider] = useState<"twitch" | "kick">("twitch"),
    [offline, setOffline] = useState(false),
    [search, setSearch] = useState(false),
    [input, setInput] = useState(""),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("Channels"),
    [history, setHistory] = useState<string[]>([]),
    [category, setCategory] = useState<MobileGame | null>(null),
    [channels, setChannels] = useState<MobileChannel[]>([]),
    [categories, setCategories] = useState<MobileGame[]>([]),
    [videos, setVideos] = useState<Vod[]>([]),
    [cursor, setCursor] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [hidden, setHidden] = useState(false),
    [dataSaver, setDataSaver] = useState(false);
  const identity = JSON.stringify([page, provider, offline, search, query, tab, category?.id, accounts]);
  const canRemember = !search && (page === "games" || page === "popular");
  useLayoutEffect(() => {
    if (hidden || !canRemember || busy || error || viewIdentity.current !== identity) return;
    returnCache.current.remember(identity, { channels, categories, videos, cursor }, feedScroll.current);
  }, [identity, hidden, canRemember, busy, error, channels, categories, videos, cursor]);
  useLayoutEffect(() => {
    if (!hidden && feed.current && restoreScroll.current !== null) {
      feed.current.scrollTop = restoreScroll.current;
      feedScroll.current = feed.current.scrollTop;
      restoreScroll.current = null;
    }
  });
  useEffect(() => {
    // Capture before the player removes the feed DOM. Retain every loaded page,
    // including the parent games directory, for five minutes from this entry.
    const leaving = () => {
      if (hidden || !canRemember) return;
      returnCache.current.setScroll(identity, feed.current?.scrollTop ?? feedScroll.current);
      returnCache.current.enterStream();
    };
    window.addEventListener("android-watch-live", leaving, true);
    return () => window.removeEventListener("android-watch-live", leaving, true);
  }, [hidden, canRemember, identity]);
  const loginRequired =
    !search && page === "following" && accounts !== null && !accounts.twitch && !accounts.kick;
  useEffect(() => {
    const auth = (event: Event) => {
      const next = (event as CustomEvent<NonNullable<typeof accounts>>).detail;
      setAccounts(old => old?.twitch === next.twitch && old.kick === next.kick ? old : next);
    };
    const route = (event: Event) =>
      setLibraryPage((event as CustomEvent<string | null>).detail);
    const metadata = (event: Event) => setChatVisible((event as CustomEvent<{chatVisible:boolean}>).detail.chatVisible);
    window.addEventListener("android-player-metadata", metadata);
    window.addEventListener("android-auth-changed", auth);
    window.addEventListener("android-library-route", route);
    return () => {
      window.removeEventListener("android-player-metadata", metadata);
      window.removeEventListener("android-auth-changed", auth);
      window.removeEventListener("android-library-route", route);
    };
  }, []);
  useEffect(() => {
    void Preferences.get({ key: "search.history.v1" }).then((r) => {
      try {
        const value: unknown = JSON.parse(r.value ?? "[]");
        if (Array.isArray(value))
          setHistory(
            value
              .filter((v): v is string => typeof v === "string")
              .slice(0, 30),
          );
      } catch {
        /* Start with empty history. */
      }
    });
    void window.desktop.preferences
      .getOrMigrate()
      .then((p) => setDataSaver(p.dataSaver));
    return window.desktop.preferences.onChanged((p) =>
      setDataSaver(p.dataSaver),
    );
  }, []);
  useEffect(() => {
    let settings = false;
    const sync = () => {
      setHidden(!!document.querySelector(".app-shell.android-stream-view"));
      const open = !!document.querySelector(".settings-modal-backdrop");
      if (settings && !open && !listRequestPending.current) setRefresh((r) => r + 1);
      settings = open;
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.getElementById("root")!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    sync();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && !listRequestPending.current) setRefresh((r) => r + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const saved = () => {
      setPage("saved");
      setSearch(false);
      setCategory(null);
    };
    const following = () => {
      setPage("following");
      setSearch(false);
      setCategory(null);
    };
    window.addEventListener("android-show-saved", saved);
    window.addEventListener("android-return-following", following);
    return () => {
      window.removeEventListener("android-show-saved", saved);
      window.removeEventListener("android-return-following", following);
    };
  }, []);
  useEffect(() => {
    if (page === "saved" && !hidden && !search)
      window.dispatchEvent(new Event("android-open-downloads"));
  }, [page, hidden, search]);
  useEffect(() => {
    const back = (e: Event) => {
      if (
        hidden ||
        libraryPage === "profile" ||
        document.querySelector('[role="dialog"], .settings-modal-backdrop')
      )
        return;
      if (search || category || page !== "following") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (search) {
          setSearch(false);
          setQuery("");
          setInput("");
        } else if (category) setCategory(null);
        else {
          setPage("following");
          window.dispatchEvent(new Event("android-close-library"));
        }
      }
    };
    window.addEventListener("android-back", back, true);
    return () => window.removeEventListener("android-back", back, true);
  }, [hidden, search, category, page, libraryPage]);
  const remember = (text: string) => {
    const q = text.trim();
    setQuery(q);
    if (q) {
      setHistory((old) => {
        const next = [
          q,
          ...old.filter((v) => v.toLowerCase() !== q.toLowerCase()),
        ].slice(0, 30);
        void Preferences.set({
          key: "search.history.v1",
          value: JSON.stringify(next),
        });
        return next;
      });
    }
  };
  useEffect(() => {
    if (!search) return;
    const timer = setTimeout(() => remember(input), 600);
    return () => clearTimeout(timer);
  }, [input, search]);
  const load = async (after?: string, request = generation.current) => {
    if (search) {
      if (!query) return { items: [] } as MobilePage<MobileChannel>;
      if (tab === "Videos") return searchVideos(query, after);
      return tab === "Channels"
        ? searchChannels(query, after)
        : searchStreams(query, after);
    }
    if (page === "following") {
      const results = await Promise.allSettled([
        accounts?.twitch
          ? window.desktop.twitch.getFollowedChannels()
          : Promise.resolve([]),
        accounts?.kick
          ? window.desktop.kick.getFollowedChannels()
          : Promise.resolve([]),
      ]);
      const items: MobileChannel[] = [];
      const failures: string[] = [];
      const t = results[0];
      if (t.status === "fulfilled")
        items.push(
          ...t.value.map((c) => ({
            key: c.login,
            name: c.displayName,
            image: c.profileImageUrl,
            thumbnail: c.thumbnailUrl,
            title: c.title,
            category: c.category,
            live: c.isLive,
            viewers: c.viewerCount,
            startedAt: c.startedAt,
            tags: c.tags,
          })),
        );
      else {
        failures.push(`Twitch: ${String(t.reason)}`);
        items.push(
          ...followedSnapshot.current.filter((c) => !c.key.startsWith("kick:")),
        );
      }
      const k = results[1];
      if (k.status === "fulfilled")
        items.push(
          ...k.value.map((c) => ({
            key: `kick:${c.slug}`,
            name: c.displayName,
            image: c.profileImageUrl,
            thumbnail: c.thumbnailUrl,
            title: c.title,
            category: c.category,
            live: c.isLive,
            viewers: c.viewerCount,
            startedAt: c.startedAt,
          })),
        );
      else {
        failures.push(`Kick: ${String(k.reason)}`);
        items.push(
          ...followedSnapshot.current.filter((c) => c.key.startsWith("kick:")),
        );
      }
      if (request === generation.current) followedSnapshot.current = items;
      if (failures.length && request === generation.current)
        setError(failures.join(" · "));
      return {
        items: items
          .filter((c) => c.live !== offline)
          .sort((a, b) =>
            offline ? a.name.localeCompare(b.name) : b.viewers - a.viewers,
          ),
      };
    }
    return page === "games" && !category
      ? games(provider, after)
      : popular(provider, after, category?.id);
  };
  useEffect(() => {
    const request = ++generation.current;
    if (!accounts || hidden || (page === "saved" && !search)) return;
    const cached = canRemember ? returnCache.current.restore(identity) : undefined;
    if (cached) {
      viewIdentity.current = identity;
      restoreScroll.current = cached.scrollTop;
      setChannels(cached.data.channels); setCategories(cached.data.categories);
      setVideos(cached.data.videos); setCursor(cached.data.cursor);
      setBusy(false); setError("");
      const frame = requestAnimationFrame(() => {
        if (feed.current && restoreScroll.current !== null) {
          feed.current.scrollTop = restoreScroll.current;
          feedScroll.current = feed.current.scrollTop; restoreScroll.current = null;
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    // Expired snapshots refetch from page one and begin at the top.
    restoreScroll.current = 0;
    feedScroll.current = 0;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      listRequestPending.current = true;
      setBusy(true);
      setError("");
      if (viewIdentity.current !== identity || canRemember) {
        viewIdentity.current = identity;
        setChannels([]);
        setCategories([]);
        setVideos([]);
        setCursor(undefined);
      }
      void load(undefined, request)
        .then((p) => {
          if (cancelled) return;
          if (search && tab === "Videos") setVideos(p.items as Vod[]);
          else if (!search && page === "games" && !category)
            setCategories(p.items as MobileGame[]);
          else setChannels(p.items as MobileChannel[]);
          setCursor(p.cursor);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e.message ?? e));
        })
        .finally(() => {
          if (!cancelled) { listRequestPending.current = false; setBusy(false); }
        });
    });
    return () => {
      cancelled = true;
      listRequestPending.current = false;
      generation.current = request + 1;
    };
    // The request generation is determined by these visible navigation parameters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, refresh, hidden]);
  useEffect(() => {
    if (accounts && page === "following" && !busy && viewIdentity.current === identity)
      void finishStartup();
  }, [accounts, page, busy, identity, channels]);
  const more = async () => {
    if (!cursor || listRequestPending.current) return;
    const request = generation.current;
    const after = cursor;
    listRequestPending.current = true;
    setBusy(true); setError("");
    try {
      const p = await load(after, request);
      if (request !== generation.current) return;
      if (search && tab === "Videos")
        setVideos((old) => [...old, ...(p.items as Vod[])]);
      else if (!search && page === "games" && !category)
        setCategories(old => [...old, ...(p.items as MobileGame[]).filter(item => !old.some(existing => existing.id === item.id))]);
      else
        setChannels((old) => {
          const combined = [...old, ...(p.items as MobileChannel[])].filter(
            (v, i, a) => a.findIndex((x) => x.key === v.key) === i,
          );
          return search && tab === "Channels"
            ? rankChannels(combined, query)
            : combined;
        });
      setCursor(p.cursor === after ? undefined : p.cursor);
    } catch (e) {
      if (request === generation.current) setError(String(e));
    } finally {
      if (request === generation.current) { listRequestPending.current = false; setBusy(false); }
    }
  };
  const navigate = (next: Page) => {
    window.dispatchEvent(new Event("android-close-library"));
    if (hidden) window.dispatchEvent(new Event("android-stream-back"));
    setPage(next);
    setSearch(false);
    setCategory(null);
    if (next === "saved")
      window.dispatchEvent(new Event("android-open-downloads"));
  };
  if (hidden && libraryPage !== "profile")
    return document.documentElement.classList.contains(
      "android-offline-chat",
    ) ? (
      <div className="android-offline-topbar">
        <button
          aria-label="Back to following"
          onClick={() =>
            window.dispatchEvent(new Event("android-close-player"))
          }
        >
          <ArrowLeft />
        </button>
        <button onClick={() => profile(currentPlaybackChannel() ?? "")}>
          {currentPlaybackChannel()} · Offline chat
        </button>
        <AndroidStreamMenu chatVisible={chatVisible} />
        <button
          aria-label="Settings"
          onClick={() =>
            window.dispatchEvent(new Event("android-open-settings"))
          }
        >
          <Settings />
        </button>
      </div>
    ) : null;
  return (
    <div className="android-mobile-home" data-library-page={libraryPage ?? ""} data-page={page}>
      <header className="mobile-topbar" aria-hidden={libraryPage === "profile"}>
        {search || category ? (
          <button
            aria-label="Back"
            onClick={() => {
              if (search) {
                setSearch(false);
                setInput("");
                setQuery("");
              } else setCategory(null);
            }}
          >
            <ArrowLeft />
          </button>
        ) : (
          <div className="mobile-brand">
            <strong>VioletWire Android</strong>
            <span>{page[0].toUpperCase() + page.slice(1)}</span>
          </div>
        )}
        {search ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              remember(input);
            }}
          >
            <input
              aria-label="Search channels, streams and videos"
              placeholder="Search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
          </form>
        ) : category ? (
          <span>{category.name}</span>
        ) : null}
        {!search && (
          <button aria-label="Search" onClick={() => setSearch(true)}>
            <Search />
          </button>
        )}
        <button
          aria-label="Settings"
          onClick={() =>
            window.dispatchEvent(new Event("android-open-settings"))
          }
        >
          <Settings />
        </button>
      </header>
      {(search || (page !== "saved" && !loginRequired)) && (
        <div className="mobile-tabs" role="tablist">
          {(search
            ? ["Channels", "Streams", "Videos"]
            : page === "following"
              ? ["Live", "Offline"]
              : ["Twitch", "Kick"]
          ).map((label) => (
            <button
              role="tab"
              aria-selected={
                search
                  ? tab === label
                  : page === "following"
                    ? offline === (label === "Offline")
                    : provider === label.toLowerCase()
              }
              key={label}
              onClick={() => {
                if (search) setTab(label);
                else if (page === "following") setOffline(label === "Offline");
                else {
                  setProvider(label.toLowerCase() as "twitch" | "kick");
                  setCategory(null);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="mobile-feed" ref={feed} onScroll={event => {
        feedScroll.current = event.currentTarget.scrollTop;
        if (canRemember) returnCache.current.setScroll(identity, feedScroll.current);
      }} aria-hidden={libraryPage === "profile"}>
        {error && !loginRequired && (
          <p role="alert" className="android-library-error">
            {error} <button type="button" onClick={() => {
              if (cursor) void more();
              else { returnCache.current.invalidate(identity); setRefresh(r => r + 1); }
            }}>Retry</button>
          </p>
        )}
        {loginRequired ? (
          <div className="mobile-login">
            <svg
              className="mobile-twitch-logo"
              viewBox="0 0 24 28"
              role="img"
              aria-label="Twitch"
            >
              <path
                fill="currentColor"
                d="M2 0 0 5v19h6v4l4-4h5l9-9V0H2Zm20 14-5 5h-5l-4 4v-4H4V2h18v12Z"
              />
              <path fill="currentColor" d="M10 6h2v7h-2zm6 0h2v7h-2z" />
            </svg>
            <button
              className="primary-button"
              onClick={() =>
                window.dispatchEvent(new Event("android-twitch-login"))
              }
            >
              Login
            </button>
          </div>
        ) : search && !query ? (
          <div className="mobile-history">
            {history.map((q) => (
              <div key={q}>
                <button
                  onClick={() => {
                    setInput(q);
                    remember(q);
                  }}
                >
                  <History />
                  {q}
                </button>
                <button
                  aria-label={`Remove ${q} from search history`}
                  onClick={() =>
                    setHistory((old) => {
                      const next = old.filter((v) => v !== q);
                      void Preferences.set({
                        key: "search.history.v1",
                        value: JSON.stringify(next),
                      });
                      return next;
                    })
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
            {!history.length && <p>Your recent searches will appear here.</p>}
          </div>
        ) : (
          <>
            {!search && page === "following" && (
              <div className="mobile-feed-info">
                <span>
                  {channels.length} {offline ? "offline" : "live"} followed
                  channels
                </span>
                <button
                  aria-label="Refresh following"
                  disabled={busy}
                  onClick={() => setRefresh(r => r + 1)}
                >
                  <RefreshCw size={18} className={busy ? "spin" : undefined} />
                </button>
              </div>
            )}
            {busy &&
              !channels.length &&
              !categories.length &&
              !videos.length && <p role="status">Loading…</p>}
            <div className="mobile-cards">
              {channels.map((c) => (
                <article
                  key={c.key}
                  className={`mobile-stream ${c.key.startsWith("kick:") ? "kick" : "twitch"}`}
                >
                  {c.live && !(search && tab === "Channels") && (
                    <button
                      className="mobile-preview"
                      onClick={() => watch(c.key)}
                      aria-label={`Watch ${c.name}`}
                    >
                      {!dataSaver && c.thumbnail && (
                        <img src={c.thumbnail} alt="" />
                      )}
                      <span>{number(c.viewers)} viewers</span>
                      {c.startedAt && (
                        <time>
                          {durationLabel(
                            (now - Date.parse(c.startedAt)) / 1000,
                          )}{" "}
                          uptime
                        </time>
                      )}
                    </button>
                  )}
                  <div className="mobile-stream-info">
                    <button
                      className="mobile-avatar"
                      aria-label={`Open ${c.name} profile`}
                      onClick={() => profile(c.key, c)}
                    >
                      {c.image && !dataSaver ? (
                        <img src={c.image} alt="" />
                      ) : (
                        <Heart />
                      )}
                    </button>
                    <div>
                      <button
                        className="mobile-channel-name"
                        onClick={() => profile(c.key, c)}
                      >
                        {c.name}
                        <small>
                          {c.key.startsWith("kick:") ? "Kick" : "Twitch"}
                        </small>
                        {search && tab === "Channels" && c.live && (
                          <small>Live</small>
                        )}
                      </button>
                      {c.title && (
                        <button
                          className="mobile-stream-title"
                          onClick={() =>
                            c.live ? watch(c.key) : profile(c.key, c)
                          }
                        >
                          {c.title}
                        </button>
                      )}
                      <p>
                        {search && tab === "Channels"
                          ? c.followers !== undefined
                            ? `${number(c.followers)} followers`
                            : c.live
                              ? `${number(c.viewers)} viewers · Live`
                              : "Offline"
                          : (c.category ?? (c.live ? "Live" : "Offline"))}
                      </p>
                    </div>
                  </div>
                  {!!c.tags?.length && (
                    <div className="mobile-tags">
                      {c.tags.slice(0, 6).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
            <div className="mobile-games">
              {categories.map((g) => (
                <AndroidGameCard
                  provider={provider}
                  image={dataSaver ? undefined : g.image}
                  key={g.id}
                  onClick={() => setCategory(g)}
                >
                    <strong>{g.name}</strong>
                    {g.viewers !== undefined && (
                      <p>{number(g.viewers)} viewers</p>
                    )}
                    {g.broadcasters !== undefined && (
                      <p>{number(g.broadcasters)} broadcasters</p>
                    )}
                    <div className="mobile-tags">
                      {g.tags?.slice(0, 4).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                </AndroidGameCard>
              ))}
            </div>
            <div className="mobile-cards">
              {videos.map((v) => (
                <article className="mobile-stream twitch" key={v.id}>
                  <button
                    className="mobile-preview"
                    onClick={() => {
                      queueVod(v);
                      window.dispatchEvent(
                        new CustomEvent("android-watch-vod", { detail: v }),
                      );
                    }}
                  >
                    {!dataSaver && v.thumbnail && (
                      <img src={v.thumbnail} alt="" />
                    )}
                    <span>{durationLabel(v.duration)}</span>
                    <time>{number(v.views)} views</time>
                  </button>
                  <div className="mobile-stream-info">
                    <div>
                      <button
                        className="mobile-stream-title"
                        onClick={() => {
                          queueVod(v);
                          window.dispatchEvent(
                            new CustomEvent("android-watch-vod", { detail: v }),
                          );
                        }}
                      >
                        {v.title}
                      </button>
                      <button
                        className="mobile-channel-name"
                        onClick={() => profile(v.channel)}
                      >
                        {v.displayName}
                      </button>
                    </div>
                    <button
                      aria-label={`Download ${v.title}`}
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("android-download-video", {
                            detail: v,
                          }),
                        )
                      }
                    >
                      <Download />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!busy &&
              !error &&
              !channels.length &&
              !categories.length &&
              !videos.length &&
              page !== "saved" && (
                <p>
                  {page === "following" && !search
                    ? "No followed channels here. Connect your Twitch and Kick accounts in Settings."
                    : "No results found."}
                </p>
              )}
            {cursor && (
              <button
                className="mobile-load-more"
                disabled={busy}
                onClick={() => void more()}
              >
                {busy ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
      <nav className="mobile-bottom" aria-label="Main navigation">
        {(
          [
            { id: "games", label: "Games", Icon: GamesIcon },
            { id: "popular", label: "Popular", Icon: TrendingUp },
            { id: "following", label: "Following", Icon: Heart },
            { id: "saved", label: "Saved", Icon: Download },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-current={page === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <span>
              <Icon />
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
