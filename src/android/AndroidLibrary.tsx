import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  MoreVertical,
  Play,
  Pause,
  Trash2,
  X,
  ArrowLeft,
} from "lucide-react";
import { VioletNative } from "./native";
import {
  currentPlaybackChannel,
  queueVod,
  queueOfflineChannel,
  vodToken,
  vodPlaybackEvent,
  resumeChat,
  collectDownloadAssets,
  discoverKick,
} from "./platform";
import {
  durationLabel,
  loadVodProfile,
  type Vod,
  type VodProfile,
  type VodDownload,
  type VodVariant,
} from "./vod-service";
import { profiles } from "./profile-cache";
import { downloadRange, formatDownloadTime } from "./download-range";
import { loadKickVodProfile, resolveArchive } from "./kick-vods";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const percent = (value: number) =>
  value < 0 ? "Measuring…" : `${Math.floor(value)}%`;
const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${(value / 1024 ** 2).toFixed(1)} MB`;

export function AndroidLibrary() {
  const [page, setPage] = useState<"profile" | "downloads" | null>(null);
  const [channel, setChannel] = useState("");
  const [profile, setProfile] = useState<VodProfile | null>(null);
  const [downloads, setDownloads] = useState<VodDownload[]>([]);
  const [freeBytes, setFreeBytes] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [choice, setChoice] = useState<{
    video: Vod;
    variants: VodVariant[];
  } | null>(null);
  const [quality, setQuality] = useState(0);
  const [from, setFrom] = useState("0:00:00");
  const [to, setTo] = useState("0:00:00");
  const [withChat, setWithChat] = useState(true);
  const [withArtwork, setWithArtwork] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [playing, setPlaying] = useState<{
    video: Vod;
    downloadId?: string;
  } | null>(null);
  const [savedChat, setSavedChat] = useState<{
    id: string;
    state: string;
  } | null>(null);
  const [replayDisconnected, setReplayDisconnected] = useState(false);
  useEffect(() => vodPlaybackEvent.subscribe(setPlaying), []);
  useEffect(
    () =>
      window.desktop.chat.onState((state) =>
        setReplayDisconnected(state === "disconnected"),
      ),
    [],
  );
  useEffect(() => {
    const id = playing?.downloadId;
    if (!id) return;
    let cancelled = false;
    void VioletNative.downloadedAssets({ id })
      .then((result) => {
        if (!cancelled)
          setSavedChat({ id, state: result.chatState ?? "disabled" });
      })
      .catch(() => {
        if (!cancelled) setSavedChat({ id, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [playing]);
  useEffect(() => {
    void window.desktop.preferences
      .getOrMigrate()
      .then((p) => setDataSaver(p.dataSaver));
    return window.desktop.preferences.onChanged((p) =>
      setDataSaver(p.dataSaver),
    );
  }, []);
  useEffect(() => {
    const openProfile = (event: Event) => {
      const target =
        (event as CustomEvent<string | { channel: string; seed?: VodProfile }>)
          .detail || currentPlaybackChannel();
      if (!target) return;
      const key = typeof target === "string" ? target : target.channel;
      setError("");
      setBusy(true);
      setChannel(key);
      setProfile(
        profiles.peek(key) ??
          (typeof target === "string" ? null : (target.seed ?? null)),
      );
      setChoice(null);
      setPage("profile");
    };
    const closeLibrary = () => {
      setPage(null);
      setChoice(null);
    };
    const downloadVideo = (event: Event) => {
      setPage("profile");
      void prepareDownload((event as CustomEvent<Vod>).detail);
    };
    window.addEventListener("android-close-library", closeLibrary);
    window.addEventListener("android-download-video", downloadVideo);
    const openDownloads = () => {
      setError("");
      setChoice(null);
      setPage("downloads");
    };
    const back = (event: Event) => {
      if (!page || document.querySelector(".settings-modal-backdrop")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (choice) setChoice(null);
      else {
        setPage(null);
        if (page === "downloads")
          window.dispatchEvent(new Event("android-return-following"));
      }
    };
    window.addEventListener("android-stream-profile", openProfile);
    window.addEventListener("android-open-profile", openProfile);
    window.addEventListener("android-open-downloads", openDownloads);
    window.addEventListener("android-back", back, true);
    return () => {
      window.removeEventListener("android-close-library", closeLibrary);
      window.removeEventListener("android-download-video", downloadVideo);
      window.removeEventListener("android-stream-profile", openProfile);
      window.removeEventListener("android-open-profile", openProfile);
      window.removeEventListener("android-open-downloads", openDownloads);
      window.removeEventListener("android-back", back, true);
    };
  }, [page, choice]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("android-library-route", { detail: page }),
    );
  }, [page]);
  useEffect(() => {
    const clear = () => profiles.clear();
    window.addEventListener("android-auth-changed", clear);
    return () => window.removeEventListener("android-auth-changed", clear);
  }, []);
  useEffect(() => {
    if (page !== "profile" || !channel) return;
    let cancelled = false;
    const load = async (): Promise<VodProfile> => {
      if (channel.startsWith("kick:")) {
        return loadKickVodProfile(discoverKick, channel.slice(5));
      }
      return loadVodProfile(channel, undefined, vodToken());
    };
    void profiles
      .load(channel, load)
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorText(reason));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, channel]);
  useEffect(() => {
    if (page !== "downloads") return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await VioletNative.vodDownloads();
        if (!cancelled) {
          setDownloads(result.items);
          setFreeBytes(result.freeBytes);
        }
      } catch (reason) {
        if (!cancelled) setError(errorText(reason));
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [page]);
  const watch = (video: Vod, downloadId?: string) => {
    queueVod(video, downloadId);
    setPage(null);
    setChoice(null);
    window.dispatchEvent(
      new CustomEvent("android-watch-vod", { detail: video }),
    );
  };
  async function prepareDownload(video: Vod) {
    setBusy(true);
    setError("");
    setMenu(null);
    try {
      const result = await resolveArchive(video, vodToken());
      const preferences = await window.desktop.preferences.getOrMigrate();
      const index = result.variants.findIndex(
        (v) => v.value === preferences.defaultStreamQuality,
      );
      setQuality(Math.max(0, index));
      setFrom("0:00:00");
      setTo(durationLabel(video.duration));
      setChoice({ video, variants: result.variants });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  const download = async () => {
    if (!choice || busy) return;
    setBusy(true);
    setError("");
    try {
      const range = downloadRange(from, to, choice.video.duration);
      const assets = withChat
        ? await collectDownloadAssets(choice.video, withArtwork)
        : undefined;
      const selected = choice.variants[quality];
      await VioletNative.downloadVod({
        video: choice.video,
        url: selected.url,
        quality: selected.label,
        chat: withChat,
        assets,
        range,
      });
      setChoice(null);
      setPage("downloads");
      window.dispatchEvent(new Event("android-stream-back"));
      window.dispatchEvent(new Event("android-show-saved"));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const control = async (id: string, action: "pause" | "resume" | "delete") => {
    try {
      const item = downloads.find((item) => item.id === id);
      await VioletNative.vodDownloadControl({ id, action });
      if (action === "resume" && item?.error?.includes("website connection")) {
        await VioletNative.prepareReplay({ refresh: true });
        await VioletNative.vodDownloadControl({ id, action });
      }
      const result = await VioletNative.vodDownloads();
      setDownloads(result.items);
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const more = async () => {
    if (!profile?.cursor || busy) return;
    setBusy(true);
    try {
      const next = await loadVodProfile(
        profile.login,
        profile.cursor,
        vodToken(),
      );
      setProfile({
        ...profile,
        cursor: next.cursor,
        videos: [
          ...profile.videos,
          ...next.videos.filter(
            (v) => !profile.videos.some((old) => old.id === v.id),
          ),
        ],
      });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {playing &&
        createPortal(
          <div className="android-replay-label">
            {playing.downloadId ? "Offline VOD" : "VOD"} ·{" "}
            {playing.downloadId && savedChat?.id === playing.downloadId
              ? savedChat.state === "completed"
                ? "Chat replay"
                : savedChat.state === "disabled"
                  ? "Chat not saved"
                  : "Partial chat replay"
              : "Chat replay"}
            {!playing.downloadId && replayDisconnected && (
              <button onClick={() => resumeChat()}>Retry chat</button>
            )}
            <small>{playing.video.title}</small>
          </div>,
          document.querySelector(".android-replay-context") ?? document.body,
        )}
      {page &&
        createPortal(
          <div
            className="android-library-backdrop"
            data-page={choice ? "choice" : page}
          >
            <section
              className="android-library"
              role={choice ? "dialog" : "region"}
              aria-modal={choice ? true : undefined}
              aria-label={
                page === "downloads" ? "Downloads" : "Channel profile"
              }
            >
              <header>
                {!choice && page === "profile" && (
                  <button
                    aria-label="Back from profile"
                    onClick={() => setPage(null)}
                  >
                    <ArrowLeft />
                  </button>
                )}
                <h2>
                  {choice
                    ? "Download VOD"
                    : page === "downloads"
                      ? "Downloads"
                      : (profile?.displayName ?? channel)}
                </h2>
                {(choice || page === "downloads") && (
                  <button
                    aria-label="Close library"
                    onClick={() => {
                      setPage(null);
                      setChoice(null);
                    }}
                  >
                    <X />
                  </button>
                )}
              </header>
              <div className="android-library-content">
                {error && (
                  <p role="alert" className="android-library-error">
                    {error}
                  </p>
                )}
                {choice ? (
                  <>
                    <button
                      className="android-library-back"
                      onClick={() => setChoice(null)}
                    >
                      <ArrowLeft size={16} /> Back to videos
                    </button>
                    <h3>{choice.video.title}</h3>
                    <p>
                      Video duration · {durationLabel(choice.video.duration)} ·
                      Saved in app storage
                    </p>
                    <div className="android-download-range">
                      <label>
                        From
                        <input
                          aria-label="Download start time"
                          value={from}
                          onChange={(e) =>
                            setFrom(formatDownloadTime(e.target.value))
                          }
                          onFocus={(e) => e.target.select()}
                          placeholder="0:00:00"
                          inputMode="numeric"
                        />
                      </label>
                      <label>
                        To
                        <input
                          aria-label="Download end time"
                          value={to}
                          onChange={(e) =>
                            setTo(formatDownloadTime(e.target.value))
                          }
                          onFocus={(e) => e.target.select()}
                          placeholder="0:00:30"
                          inputMode="numeric"
                        />
                      </label>
                    </div>
                    <label className="android-download-option">
                      Quality
                      <select
                        aria-label="Download quality"
                        value={quality}
                        onChange={(e) => setQuality(Number(e.target.value))}
                      >
                        {choice.variants.map((variant, i) => (
                          <option value={i} key={variant.url}>
                            {variant.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="android-download-option">
                      <input
                        type="checkbox"
                        checked={withChat}
                        onChange={(e) => setWithChat(e.target.checked)}
                      />{" "}
                      Download chat replay
                    </label>
                    <label className="android-download-option">
                      <input
                        type="checkbox"
                        disabled={!withChat}
                        checked={withArtwork}
                        onChange={(e) => setWithArtwork(e.target.checked)}
                      />{" "}
                      Download emotes and badges
                    </label>
                    <p>
                      You can pause, resume or delete this download from
                      Downloads. Video and chat have separate progress.
                      Available chat artwork is saved separately, up to 32 MB
                      per video.
                    </p>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void download()}
                    >
                      <Download size={18} /> {busy ? "Starting…" : "Download"}
                    </button>
                  </>
                ) : page === "profile" ? (
                  <>
                    {profile && (
                      <div
                        className={`android-channel-profile ${profile.login.startsWith("kick:") ? "kick" : "twitch"}`}
                      >
                        {profile.image && <img src={profile.image} alt="" />}
                        <div>
                          <h3>{profile.displayName}</h3>
                          {profile.followers !== undefined && (
                            <p>
                              {profile.followers.toLocaleString()} followers
                            </p>
                          )}
                          <p>{profile.description}</p>
                          <button
                            onClick={() => {
                              if (profile.live === false)
                                queueOfflineChannel(profile.login);
                              setPage(null);
                              window.dispatchEvent(
                                new CustomEvent("android-watch-live", {
                                  detail: profile.login,
                                }),
                              );
                            }}
                          >
                            <Play size={16} />{" "}
                            {profile.live ? "WATCH LIVE" : "OPEN PLAYER"}
                          </button>
                        </div>
                      </div>
                    )}
                    <h3>
                      {channel.startsWith("kick:")
                        ? "Past broadcasts"
                        : "Past broadcasts and highlights"}
                    </h3>
                    {busy && !profile?.videos.length && (
                      <p role="status">Loading videos…</p>
                    )}
                    {!busy && !error && profile && !profile.videos.length && (
                      <p>This channel has no available past videos.</p>
                    )}
                    <div className="android-vod-grid">
                      {profile?.videos.map((video) => (
                        <article
                          className={`android-vod-card ${video.channel.startsWith("kick:") ? "kick" : "twitch"}`}
                          key={video.id}
                        >
                          <button
                            className="android-vod-preview"
                            onClick={() => watch(video)}
                            aria-label={`Watch ${video.title}`}
                          >
                            {!dataSaver && video.thumbnail && (
                              <img
                                src={video.thumbnail}
                                alt=""
                                loading="lazy"
                                onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
                              />
                            )}
                            <span>{durationLabel(video.duration)}</span>
                            <Play className="android-vod-play" />
                          </button>
                          <div className="android-vod-heading">
                            <button onClick={() => watch(video)}>
                              {video.title}
                            </button>
                            <button
                              aria-label={`Options for ${video.title}`}
                              aria-expanded={menu === video.id}
                              onClick={() =>
                                setMenu(menu === video.id ? null : video.id)
                              }
                            >
                              <MoreVertical />
                            </button>
                          </div>
                          <small>
                            {video.type.toLowerCase()} ·{" "}
                            {video.views.toLocaleString()} views ·{" "}
                            {new Date(video.createdAt).toLocaleDateString()}
                          </small>
                          {menu === video.id && (
                            <div className="android-vod-menu" role="menu">
                              <button
                                role="menuitem"
                                disabled={busy}
                                onClick={() => void prepareDownload(video)}
                              >
                                <Download size={18} /> Download
                              </button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                    {busy && !!profile?.videos.length && (
                      <p role="status">Loading…</p>
                    )}
                    {profile?.cursor && (
                      <button disabled={busy} onClick={() => void more()}>
                        Load more videos
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      {bytes(freeBytes)} free in phone storage. Saved videos
                      remain until you delete them.
                    </p>
                    {!downloads.length && (
                      <p>
                        No downloaded VODs yet. Open a channel profile and
                        choose Download from a video’s three-dot menu.
                      </p>
                    )}
                    {downloads.map((item) => {
                      const done =
                        item.state === "completed" &&
                        ["completed", "disabled"].includes(item.chatState);
                      const resumable =
                        item.state === "paused" ||
                        item.state === "error" ||
                        (item.state === "completed" &&
                          item.chatState === "error");
                      return (
                        <article className="android-saved-vod" key={item.id}>
                          <h3>{item.video.title}</h3>
                          <p>
                            {item.video.displayName} · {item.quality} ·{" "}
                            {durationLabel(item.video.duration)} ·{" "}
                            {bytes(item.bytes)}
                          </p>
                          {item.video.downloadStart !== undefined && (
                            <p>
                              Section ·{" "}
                              {durationLabel(item.video.downloadStart)}–
                              {durationLabel(
                                item.video.downloadEnd ??
                                  item.video.downloadStart +
                                    item.video.duration,
                              )}
                            </p>
                          )}
                          <div
                            className="android-download-progress"
                            data-complete={done}
                            aria-hidden={done}
                          >
                            <div>
                              <label>
                                Video · {percent(item.videoPercent)}
                                <progress
                                  max={100}
                                  value={
                                    item.videoPercent < 0
                                      ? undefined
                                      : item.videoPercent
                                  }
                                />
                              </label>
                              <label>
                                Chat ·{" "}
                                {item.chatState === "disabled"
                                  ? "Not requested"
                                  : `${percent(item.chatPercent)} · ${item.state === "paused" && item.chatState === "downloading" ? "paused" : item.chatState}`}
                                <progress max={100} value={item.chatPercent} />
                              </label>
                            </div>
                          </div>
                          <small>
                            {done ? "Ready to watch offline" : item.state}
                          </small>
                          {item.error && (
                            <p role="alert" className="android-library-error">
                              {item.error}
                            </p>
                          )}
                          <div className="android-download-actions">
                            <button
                              disabled={
                                item.videoPercent < 100 ||
                                item.state === "deleting"
                              }
                              onClick={() => watch(item.video, item.id)}
                            >
                              <Play size={16} /> Play VOD
                            </button>
                            {!done && item.state !== "deleting" && (
                              <button
                                onClick={() =>
                                  void control(
                                    item.id,
                                    resumable ? "resume" : "pause",
                                  )
                                }
                              >
                                {resumable ? (
                                  <>
                                    <Play size={16} /> Resume
                                  </>
                                ) : (
                                  <>
                                    <Pause size={16} /> Pause
                                  </>
                                )}
                              </button>
                            )}
                            {item.chatState === "error" &&
                              !resumable &&
                              item.state !== "deleting" && (
                                <button
                                  onClick={() =>
                                    void control(item.id, "resume")
                                  }
                                >
                                  Retry chat
                                </button>
                              )}
                            <button
                              aria-label={`Delete ${item.video.title}`}
                              disabled={item.state === "deleting"}
                              onClick={() => void control(item.id, "delete")}
                            >
                              <Trash2 size={16} /> Delete
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
