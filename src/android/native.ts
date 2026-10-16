import {
  CapacitorHttp,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import type {
  NativePlayerCommand,
  NativePlayerState,
  NativeQuality,
} from "../shared/player";
import type { Vod, VodDownload, VodChatAssets } from "./vod-service";

interface VioletNativePlugin {
  prepareReplay(options?: { refresh?: boolean }): Promise<void>;
  vodComments(options: { id: string; cursor?: string; offset: number }): Promise<{ comments: unknown }>;
  kickVodComments(options: { video: Vod; offset: number }): Promise<{ comments: unknown }>;
  vodManifest(options: { url: string }): Promise<{ text: string }>;
  downloadVod(options: { video: Vod; url: string; quality: string; chat: boolean; assets?: VodChatAssets; range?: {start:number;end:number} }): Promise<void>;
  vodDownloads(): Promise<{ items: VodDownload[]; freeBytes: number }>;
  vodDownloadControl(options: { id: string; action: "pause" | "resume" | "delete" }): Promise<void>;
  downloadedChat(options: { id: string; offset: number }): Promise<{ nodes: unknown[] }>;
  downloadedAssets(options: { id: string }): Promise<{ assets?: VodChatAssets; chatState?: string }>;
  configure(options: { oledMode: boolean; audioCompression: boolean; controlsHideDelay: number; targetOffsetMs: number; dataSaver: boolean; adProxyFallback: boolean }): Promise<void>;
  emoteCacheUsage(): Promise<{ bytes: number; emotes: number }>;
  clearEmoteCache(): Promise<void>;
  keyboard(options: { visible: boolean }): Promise<void>;
  pictureInPicture(): Promise<void>;
  metadata(options: { channel: string; viewers: number; startedAt: number; followed: boolean; subscribed: boolean; pending: boolean; chatVisible: boolean }): Promise<void>;
  openExternal(options: { url: string; browser?: boolean }): Promise<void>;
  copyText(options: { text: string }): Promise<void>;
  secureGet(options?: { record: string }): Promise<{ value: string | null }>;
  secureSet(options: { value: string; record?: string }): Promise<void>;
  secureRemove(options?: { record: string }): Promise<void>;
  authentication(options: { provider: "twitch" | "kick"; url: string; capture: boolean }): Promise<{ token?: string | null }>;
  closeAuthentication(): Promise<void>;
  clearWebsiteSession(options: { provider: "twitch" | "kick" }): Promise<void>;
  kickRequest(options: { path: string; method: string; token: string; body?: string }): Promise<{ status: number; data: string }>;
  addListener(event: "keyboardVisibility", listener: (event: { visible: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: "authenticationClosed", listener: () => void): Promise<PluginListenerHandle>;
  startupReady(): Promise<void>;
  rewardPresentation(options: { active: boolean }): Promise<void>;
  rewardWebsite(options: { channel: string }): Promise<void>;
  deviceInfo(): Promise<{ television: boolean }>;
  play(options: {
    url: string;
    volume: number;
    quality: string;
    targetOffsetMs: number;
    controlsHideDelay: number;
    channel: string;
    vod?: boolean;
    downloadId?: string;
  }): Promise<void>;
  stop(): Promise<void>;
  seek(options: { positionMs: number }): Promise<void>;
  stats(): Promise<Record<string, string>>;
  control(options: NativePlayerCommand): Promise<void>;
  qualities(): Promise<{ items: NativeQuality[] }>;
  quality(options: { value: string }): Promise<void>;
  bounds(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    visible: boolean;
    mini?: boolean;
    occlusions?: { x: number; y: number; width: number; height: number }[];
  }): Promise<void>;
  focusPlayer(): Promise<void>;
  fullscreen(options: { value: boolean }): Promise<void>;
  addListener(event: "surfaceGesture", listener: (event: { phase: string; x: number; y: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: "playerInteraction", listener: () => void): Promise<PluginListenerHandle>;
  addListener(event: "streamAction", listener: (event: { action: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "vodSeek", listener: () => void): Promise<PluginListenerHandle>;
  addListener(event: "viewMode", listener: (event: { chatOnly: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(
    event: "pipClosed",
    listener: () => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "playerState",
    listener: (state: NativePlayerState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "fullscreenRequest",
    listener: (event: { value: boolean }) => void,
  ): Promise<PluginListenerHandle>;
}

export const VioletNative = registerPlugin<VioletNativePlugin>("VioletNative");

export async function openExternal(url: string, browser = false): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Only secure web links can be opened.");
  }
  await VioletNative.openExternal({ url: parsed.toString(), browser });
}

/** Native HTTP avoids WebView CORS while retaining HTTPS and explicit provider origins. */
export const nativeFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const allowed = [
    "twitch.tv",
    "twitchcdn.net",
    "kick.com",
    "7tv.io",
    "frankerfacez.com",
    "betterttv.net",
    "ivr.fi",
    "recent-messages.robotty.de",
    "api.github.com",
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !(allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ||
      (init.method === "HEAD" && url.hostname === "static-cdn.jtvnw.net" && /^\/previews-ttv\/live_user_[a-z0-9_]+-(?:320x180|640x360|1920x1080)\.jpg$/.test(url.pathname)))
  ) {
    throw new Error("The requested address is not a secure provider endpoint.");
  }
  init.signal?.throwIfAborted();
  const body =
    init.body instanceof URLSearchParams ? init.body.toString() : init.body;
  if (body != null && typeof body !== "string")
    throw new Error("Unsupported native request body.");
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const response = CapacitorHttp.request({
    url: url.toString(),
    method: init.method ?? "GET",
    headers,
    data: body,
    responseType: "text",
    connectTimeout: 10000,
    readTimeout: 15000,
    disableRedirects: true,
  }).then(
    (result) =>
      new Response(
        [204, 205, 304].includes(result.status)
          ? null
          : typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data),
        { status: result.status, headers: result.headers },
      ),
  );
  if (!init.signal) return response;
  const signal = init.signal;
  return new Promise<Response>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    response
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
};
