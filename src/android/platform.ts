import { Preferences } from "@capacitor/preferences";
import { TwitchService } from "../services/twitch-service";
import { KickPublicService } from "../services/kick-public-service";
import { TwitchChatService } from "../services/twitch-chat-service";
import { KickChatService } from "../services/kick-chat-service";
import { SevenTvService } from "../services/seven-tv-service";
import { ThirdPartyEmoteService } from "../services/third-party-emote-service";
import type { EmoteProvider, EmoteSetResult } from "../shared/emotes";
import type { VodChatAssets } from "./vod-service";
import { chatEmoteVariant } from "../renderer/src/emote-scale";
import type { TextStore } from "../services/runtime";
import type {
  DesktopApi,
  NativePlayerState,
  NativeControlAction,
} from "../shared/player";
import type {
  ChatMessage,
  ChatConnectionState,
  ChatRestrictions,
} from "../shared/chat";
import type { AppPreferences } from "../shared/preferences";
import {
  appPreferencesPatchSchema,
  appPreferencesSchema,
  defaultAppPreferences,
  storedAppPreferencesPatchSchema,
} from "../shared/preferences";
import {
  channelKeySchema,
  channelUrl,
  parseChannelKey,
} from "../shared/platform";
import {
  chatReplyParentIdSchema,
  outgoingChatMessageSchema,
} from "../shared/chat";
import { AndroidUpdateService } from "./update-service";
import { VioletNative, nativeFetch, openExternal } from "./native";
import { resolveStream } from "./stream-resolver";
import { ForegroundGate } from "./foreground";
import { AndroidAccountSessions } from "./account-sessions";
import { parseReplayNodes, type Vod, type ReplayMessage } from "./vod-service";
import { loadArchiveReplay, resolveArchive } from "./kick-vods";

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value: T) {
      for (const listener of listeners) listener(value);
    },
  };
}
function store(key: string): TextStore {
  return {
    async read() {
      return (await Preferences.get({ key })).value;
    },
    async write(value) {
      await Preferences.set({ key, value });
    },
    async remove() {
      await Preferences.remove({ key });
    },
  };
}
const unsupported = async (feature: string): Promise<never> => {
  throw new Error(
    `${feature} is not available in this Android development build.`,
  );
};
const ignoreListener = () => () => {};
export const nativeStateEvent = event<NativePlayerState>();
export const fullscreenEvent = event<boolean>();
const actions = event<NativeControlAction>();
const messages = event<ChatMessage>();
const chatState = event<ChatConnectionState>();
const restrictions = event<ChatRestrictions>();
const changed = event<AppPreferences>();
const tokenStore: TextStore = {
  async read() {
    return (await VioletNative.secureGet()).value;
  },
  write: (value) => VioletNative.secureSet({ value }),
  remove: () => VioletNative.secureRemove(),
};
export const foregroundGate = new ForegroundGate();
const twitch = new TwitchService({
  fetch: nativeFetch,
  openExternal,
  openAuthentication: (url) => VioletNative.authentication({ provider: "twitch", url, capture: false }).then(() => undefined),
  tokenStore,
  waitForForeground: (signal) => foregroundGate.wait(signal),
  onSignInStatus: (message) =>
    window.dispatchEvent(
      new CustomEvent("android-signin-status", { detail: message }),
    ),
});
const accounts = new AndroidAccountSessions();
const kick = new KickPublicService((input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  // Authenticated channel details include this viewer's follow state; public
  // details must not tell an existing follower that followers-only chat is locked.
  if (["kick.com", "www.kick.com"].includes(url.hostname) && /^\/api\/(v1\/(livestreams|subcategories)|search|v2\/channels\/[a-z0-9_-]+(?:\/(livestream|videos))?)$/i.test(url.pathname) && (!init?.method || init.method === "GET")) {
    if(accounts.hasKickAccount()) return accounts.request(url.pathname + url.search);
    // Public discovery shares the provider browser's challenge cookies. It has
    // no account credential and cannot call private or write routes.
    return nativeFetch(input,init).then(async response=>{
      if(response.ok)return response;
      const result=await VioletNative.kickRequest({path:url.pathname+url.search,method:"GET",token:""});
      if(!result.status)throw new Error("Kick could not load. Try again.");
      return new Response(result.data,{status:result.status,headers:{"Content-Type":"application/json"}});
    });
  }
  return nativeFetch(input, init);
});
const sevenTv = new SevenTvService(store("7tv-cache"), nativeFetch);
const thirdParty = new ThirdPartyEmoteService(
  store("third-party-cache"),
  nativeFetch,
);
const twitchChat = new TwitchChatService(
  messages.emit,
  chatState.emit,
  restrictions.emit,
  nativeFetch,
);
const kickChat = new KickChatService(
  () => kick,
  messages.emit,
  chatState.emit,
  restrictions.emit,
);
let preferences: AppPreferences = {
  ...defaultAppPreferences,
  sidebarCollapsed: true,
};
let preferencesQueue: Promise<unknown> = Promise.resolve();
const preferenceStore = store("preferences.v1");
let state: NativePlayerState = {
  status: "idle",
  paused: false,
  muted: false,
  volume: 100,
  compressorEnabled: false,
  behindLive: false,
  quality: "best",
};
let activeChannel: string | null = null;
type VodPlayback = { video: Vod; downloadId?: string };
let activeVod: VodPlayback | null = null;
let queuedVod: VodPlayback | null = null;
let offlineChannel: string | null = null;
export function queueOfflineChannel(channel: string) { offlineChannel = channel; }
export const vodPlaybackEvent = event<VodPlayback | null>();
export const vodToken = () => accounts.playbackToken();
export const currentPlaybackChannel = () => activeChannel;
export const discoverKick = kick;
export function queueVod(video: Vod, downloadId?: string) { queuedVod = { video, downloadId }; }
export async function collectDownloadAssets(video: Vod, artwork: boolean): Promise<VodChatAssets> {
  const isKick=video.channel.startsWith("kick:");
  const assets: VodChatAssets = await (isKick ? kick.getEmoteSets(video.channel.slice(5)).then(sets=>({broadcasterId:video.broadcasterId??"",badges:[],emotes:sets.flatMap(set=>set.emotes.map(e=>({id:e.id,name:e.name,imageUrl:e.imageUrl,scope:"channel" as const,subscriptionOnly:e.subscribersOnly})))})) : twitch.getChatAssets(video.channel)).catch(() => ({ broadcasterId: video.broadcasterId ?? "", badges: [], emotes: [] }));
  assets.saveArtwork = artwork;
  if (artwork) {
    const id = assets.broadcasterId;
    const results = await Promise.allSettled(isKick ? [sevenTv.getGlobal(), ...(id ? [sevenTv.getChannel(id,"kick")] : [])] : [sevenTv.getGlobal(), thirdParty.getFfzGlobal(), thirdParty.getBttvGlobal(), ...(id ? [sevenTv.getChannel(id), thirdParty.getFfzChannel(id), thirdParty.getBttvChannel(id)] : [])]);
    assets.providerSets = results.flatMap(result => result.status === "fulfilled" ? [{ ...result.value, emotes: result.value.emotes.map(emote => { const image = chatEmoteVariant(emote.variants); return { ...emote, variants: image ? [image] : [] }; }) }] : []);
  }
  return assets;
}
const savedAssets = new Map<string, ReturnType<typeof VioletNative.downloadedAssets>>();
function archiveAssets(id: string) {
  let value = savedAssets.get(id);
  if (!value) { value = VioletNative.downloadedAssets({ id }); savedAssets.set(id, value); if (savedAssets.size > 3) savedAssets.delete(savedAssets.keys().next().value!); }
  return value;
}
async function archiveEmotes(provider: EmoteProvider, scope: "global" | "channel", live: () => Promise<EmoteSetResult>): Promise<EmoteSetResult> {
  const archive = queuedVod ?? activeVod;
  if (!archive?.downloadId) return live();
  const saved = await archiveAssets(archive.downloadId);
  return saved.assets?.providerSets?.find(set => set.provider === provider && set.scope === scope) ?? { provider, scope, emotes: [], cachedAt: Date.now(), stale: false };
}
let replayTimer: ReturnType<typeof setTimeout> | undefined;
let replayGeneration = 0;
function stopReplay() { replayGeneration++; clearTimeout(replayTimer); }
function startReplay() {
  if (!activeVod) return;
  stopReplay(); const generation = replayGeneration, archive = activeVod;
  let previous = -1, fetchedTo = -1, cursor: string | undefined, ended = false, warned = false;
  let pending: ReplayMessage[] = []; const emitted = new Set<string>();
  const tick = async () => {
    if (generation !== replayGeneration) return;
    try {
      const stats = await VioletNative.stats(); const position = Number(stats.positionMs) / 1000 + (archive.downloadId ? archive.video.downloadStart ?? 0 : 0);
      const seeked = previous < 0 || position < previous - 1 || position > previous + 4;
      if (seeked) { pending = []; cursor = undefined; ended = false; fetchedTo = -1; emitted.clear(); window.dispatchEvent(new Event("android-replay-reset")); }
      previous = position;
      if (archive.downloadId) {
        if (seeked || position > fetchedTo - 10) {
          const data = await VioletNative.downloadedChat({ id: archive.downloadId, offset: position });
          pending = parseReplayNodes(data.nodes, archive.video.channel);
          // Dense chat may fill the bounded native result before the end of the window.
          fetchedTo = pending.length ? Math.min(position + 60, pending.at(-1)!.offset) : position + 60;
        }
      } else if (!ended && (seeked || (archive.video.channel.startsWith("kick:") ? fetchedTo < position + 15 : !pending.length || pending.at(-1)!.offset < position + 15))) {
        const page = await loadArchiveReplay(archive.video, Math.max(0, cursor ? fetchedTo : position - (seeked ? 10 : 0)), cursor);
        fetchedTo = page.nextOffset ?? page.messages.at(-1)?.offset ?? position;
        pending.push(...page.messages); pending.sort((a, b) => a.offset - b.offset); const next = page.cursor; ended = !next || next === cursor; cursor = next;
      }
      if (generation !== replayGeneration) return;
      while (pending.length && pending[0].offset <= position) { const item = pending.shift()!; if (!emitted.has(item.message.id) && item.offset >= position - 30) { emitted.add(item.message.id); messages.emit(item.message); } }
      // Keep only a bounded window of ids, even through a long VOD.
      if (emitted.size > 2000) { const last = [...emitted].slice(-1000); emitted.clear(); last.forEach(id => emitted.add(id)); }
      chatState.emit("connected");
    } catch (error) { if (!warned && generation === replayGeneration) { warned = true; chatState.emit("disconnected"); window.dispatchEvent(new CustomEvent("android-notice", { detail: `Chat replay: ${error instanceof Error ? error.message : String(error)}` })); } return; }
    if (generation === replayGeneration) replayTimer = setTimeout(() => void tick(), 500);
  };
  void tick();
}
let playGeneration = 0;
let fullscreen = false;

function configureNativePreferences(): Promise<void> {
  return VioletNative.configure({
    controlsHideDelay: preferences.controlsHideDelay,
    targetOffsetMs: preferences.playbackLatencyMode === "ultra-low" ? 2500 : 6000,
    dataSaver: preferences.dataSaver,
    adProxyFallback: preferences.adProxyFallback,
  });
}

export async function setFullscreen(value: boolean): Promise<boolean> {
  await VioletNative.fullscreen({ value });
  document.documentElement.classList.toggle("android-fullscreen", value);
  fullscreen = value;
  fullscreenEvent.emit(value);
  return value;
}
export function getFullscreen(): boolean {
  return fullscreen;
}
export function resumeChat(): void {
  if (activeVod) { startReplay(); return; }
  if (!activeChannel) return;
  const target = parseChannelKey(activeChannel);
  if (target.platform === "twitch") twitchChat.connect(target.login);
  else
    void kickChat
      .connect(target.login)
      .catch(() => chatState.emit("disconnected"));
}
export function pauseChat(): void {
  stopReplay();
  twitchChat.disconnect();
  kickChat.disconnect();
}
export async function initializePlatform(): Promise<void> {
  const raw = await preferenceStore.read();
  if (raw) {
    try {
      preferences = appPreferencesSchema.parse({
        ...preferences,
        ...storedAppPreferencesPatchSchema.parse(JSON.parse(raw)),
      });
    } catch {
      /* A corrupt preference record does not prevent startup. */
    }
  }
  // Android has one native player and no desktop audio compressor.
  preferences = {
    ...preferences,
    preferredPlayerMode: "native",
    audioCompression: false,
    chatOnLeft: false,
    genericLinkPreviewsEnabled: false,
  };
  await configureNativePreferences();
  await VioletNative.addListener("playerState", (value) => {
    document.documentElement.classList.toggle("android-chat-only", value.quality === "chat_only" && value.status !== "idle");
    state = value;
    nativeStateEvent.emit(value);
  });
  await VioletNative.addListener("fullscreenRequest", (event) => {
    void setFullscreen(event.value);
  });
  await VioletNative.addListener("pipClosed", () => {
    window.dispatchEvent(new Event("android-close-player"));
  });
  await VioletNative.addListener("surfaceGesture", (event) => window.dispatchEvent(new CustomEvent("android-player-gesture", { detail: event })));
  await VioletNative.addListener("streamAction", ({ action }) => window.dispatchEvent(new CustomEvent("android-stream-" + action, { detail: activeChannel })));
  await VioletNative.addListener("vodSeek", () => { if (activeVod) startReplay(); });
  await VioletNative.addListener("viewMode", ({ chatOnly }) => { document.documentElement.classList.toggle("android-chat-only", chatOnly); if (chatOnly) window.dispatchEvent(new Event("android-stream-chat-mode")); });
  await VioletNative.addListener("authenticationClosed", () => twitch.cancelSignIn());
  await accounts.initialize();
  await twitch.initialize();
}

export const androidUpdates = new AndroidUpdateService();
const pageUrl = (channel: string) => {
  const target = parseChannelKey(channelKeySchema.parse(channel));
  return channelUrl(target.platform, target.login);
};

/** Implements the existing renderer contract. Its historical name is kept for desktop compatibility. */
export const androidPlatform: DesktopApi = {
  system: { openExternal, copyText: (text) => VioletNative.copyText({ text }), getLinkPreview: async () => null },
  twitch: {
    getAuthState: () => twitch.getAuthState(),
    beginSignIn: () => twitch.beginSignIn(),
    completeSignIn: async () => { try { return await twitch.completeSignIn(); } finally { await VioletNative.closeAuthentication(); } },
    cancelSignIn: async () => {
      twitch.cancelSignIn();
      await VioletNative.closeAuthentication();
    },
    signOut: () => twitch.signOut(),
    getPlaybackSessionState: async () => accounts.playbackState(),
    linkPlaybackSession: () => accounts.linkPlayback(),
    unlinkPlaybackSession: () => accounts.unlinkPlayback(),
    getFollowedChannels: () => twitch.getFollowedChannels(),
    getBrowseCategories: (query, after) =>
      twitch.getBrowseCategories(query, after),
    getCategoryStreams: (id, after) => twitch.getCategoryStreams(id, after),
    search: (query) => twitch.search(query),
    getStreamMetadata: (channel) => twitch.getStreamMetadata(channel),
    getChatUserProfile: (channel, login) =>
      twitch.getChatUserProfile(channel, login),
    getPinnedChatMessage: (id) => twitch.getPinnedChatMessage(id),
    getChatColor: () => twitch.getChatColor(),
    updateChatColor: (color) => twitch.updateChatColor(color),
    createClip: (channel) => twitch.createClip(channel),
    openChannel: async (channel) => { window.dispatchEvent(new CustomEvent("android-open-profile", { detail: channel })); },
  },
  kick: {
    search: (query) => kick.search(query),
    getChannel: (slug) => kick.getChannel(slug),
    getCategories: (query, cursor) => kick.getCategories(query, cursor),
    getCategoryStreams: (id, cursor) => kick.getCategoryStreams(id, cursor),
    getUser: () => accounts.getUser(),
    getAuthState: () => accounts.authState(),
    signIn: () => accounts.signIn(),
    signOut: () => accounts.signOut(),
    getFollowedChannels: () => accounts.followed(kick),
    getEmoteSets: (slug) => kick.getEmoteSets(slug),
    getChatUserProfile: () => unsupported("Kick user profiles"),
    getPinnedChatMessage: (id) => kick.getPinnedChatMessage(id),
    getChatColor: async () => ({ color: "", canUpdate: false }),
    updateChatColor: () => unsupported("Kick account chat colors"),
    setFollowing: (slug, follow) => accounts.setFollowing(slug, follow),
    openWindow: (slug) => openExternal(channelUrl("kick", slug)),
  },
  emotes: {
    getSevenTvGlobal: () => archiveEmotes("7tv", "global", () => sevenTv.getGlobal()),
    getSevenTvChannel: (id, platform) => archiveEmotes("7tv", "channel", () => sevenTv.getChannel(id, platform)),
    getFfzGlobal: () => archiveEmotes("ffz", "global", () => thirdParty.getFfzGlobal()),
    getFfzChannel: (id) => archiveEmotes("ffz", "channel", () => thirdParty.getFfzChannel(id)),
    getBttvGlobal: () => archiveEmotes("bttv", "global", () => thirdParty.getBttvGlobal()),
    getBttvChannel: (id) => archiveEmotes("bttv", "channel", () => thirdParty.getBttvChannel(id)),
    clearCache: async () => {
      await Promise.all([sevenTv.clear(), thirdParty.clear()]);
    },
  },
  chat: {
    async send(channel, message, reply) {
      if (activeVod) throw new Error("Chat replay is read-only. Open the live stream to send messages.");
      const target = parseChannelKey(channelKeySchema.parse(channel));
      if (target.platform === "kick") {
        const details = await kick.getChannel(target.login);
        if (!details?.chatroomId) throw new Error("Kick chatroom was not found.");
        const parent = reply ? kickChat.getReplyTarget(reply) : undefined;
        if (reply && !parent) throw new Error("The Kick reply has expired. Select the message again.");
        return accounts.send(details.chatroomId, outgoingChatMessageSchema.parse(message), parent);
      }
      await twitch.sendChatMessage(
        target.login,
        outgoingChatMessageSchema.parse(message),
        reply ? chatReplyParentIdSchema.parse(reply) : undefined,
      );
    },
    async getAssets(channel) {
      const archive = queuedVod?.video.channel === channel ? queuedVod : activeVod;
      if (archive?.downloadId) { const saved = await archiveAssets(archive.downloadId); if (saved.assets) return saved.assets; return { broadcasterId: archive.video.broadcasterId ?? "", badges: [], emotes: [] }; }
      const target = parseChannelKey(channelKeySchema.parse(channel));
      if (target.platform === "twitch")
        return twitch.getChatAssets(target.login);
      const details = await kick.getChannel(target.login);
      const sets = await kick.getEmoteSets(target.login);
      return {
        broadcasterId: details?.userId ?? details?.id ?? "",
        badges: [],
        emotes: sets.flatMap((group) =>
          group.emotes.map((emote) => ({
            id: emote.id,
            name: emote.name,
            imageUrl: emote.imageUrl,
            scope: "channel" as const,
            subscriptionOnly: emote.subscribersOnly,
          })),
        ),
      };
    },
    setHistoryLimit(limit) {
      twitchChat.setHistoryLimit(limit);
      kickChat.setHistoryLimit(limit);
    },
    clearEmoteCache: () => VioletNative.clearEmoteCache(),
    getCacheSize: () => VioletNative.emoteCacheUsage(),
    getDisplays: async () => [],
    placeWindow: () => unsupported("Separate chat windows"),
    onMessage: messages.subscribe,
    onState: chatState.subscribe,
    onRestrictions: restrictions.subscribe,
  },
  preferences: {
    getOrMigrate: async () => structuredClone(preferences),
    update(patch) {
      const parsed = appPreferencesPatchSchema.parse(patch);
      const result = preferencesQueue
        .catch(() => undefined)
        .then(async () => {
          const next = appPreferencesSchema.parse({
            ...preferences,
            ...parsed,
            preferredPlayerMode: "native",
            audioCompression: false,
            chatOnLeft: false,
            genericLinkPreviewsEnabled: false,
          });
          await preferenceStore.write(JSON.stringify(next));
          preferences = next;
          await configureNativePreferences();
          changed.emit(structuredClone(next));
          return structuredClone(next);
        });
      preferencesQueue = result;
      return result;
    },
    onChanged: changed.subscribe,
  },
  updates: androidUpdates,
  player: {
    async open(channel, _mode, requestedQuality) {
      document.documentElement.classList.remove("android-offline-chat");
      let quality = requestedQuality ?? preferences.defaultStreamQuality;
      const validated = channelKeySchema.parse(channel);
      const generation = ++playGeneration;
      await VioletNative.stop();
      if (generation !== playGeneration)
        throw new Error("Playback request superseded.");
      pauseChat();
      activeChannel = validated;
      activeVod = queuedVod?.video.channel === validated ? queuedVod : null; queuedVod = null;
      vodPlaybackEvent.emit(activeVod); document.documentElement.classList.toggle("android-vod", !!activeVod);
      state = { ...state, status: "starting", quality, error: undefined };
      nativeStateEvent.emit(state);
      if (!activeVod) resumeChat();
      const openOffline = offlineChannel === validated; offlineChannel = null;
      if(openOffline) { state={...state,status:"error",error:"Stream is offline."};nativeStateEvent.emit(state);document.documentElement.classList.add("android-offline-chat");return {channel:validated,mode:"native"}; }
      try {
        const archive = activeVod;
        const resolved = archive && !archive.downloadId ? await resolveArchive(archive.video, accounts.playbackToken()) : null;
        if(resolved && ["best","source","worst"].includes(quality))quality=(quality==="worst"?resolved.variants.at(-1):resolved.variants[0])!.value;
        const url = archive?.downloadId ? "https://offline.violetwire.invalid/" : resolved ? resolved.url : await resolveStream(validated, nativeFetch, kick, accounts.playbackToken());
        if (generation !== playGeneration)
          throw new Error("Playback request superseded.");
        await VioletNative.play({
          url,
          channel: validated,
          vod: !!archive,
          downloadId: archive?.downloadId,
          volume: preferences.playerVolume,
          quality,
          targetOffsetMs:
            preferences.playbackLatencyMode === "ultra-low" ? 2500 : 6000,
          controlsHideDelay: preferences.controlsHideDelay,
        });
        if (archive) startReplay();
      } catch (error) {
        if (generation === playGeneration) {
          stopReplay(); activeVod = null; vodPlaybackEvent.emit(null); document.documentElement.classList.remove("android-vod");
          state = {
            ...state,
            status: "error",
            error: error instanceof Error ? error.message : "Playback failed.",
          };
          nativeStateEvent.emit(state);
        }
        if (!activeVod && error instanceof Error && error.message === "Stream is offline.") {
          document.documentElement.classList.add("android-offline-chat");
          return { channel: validated, mode: "native" };
        }
        throw error;
      }
      return { channel: validated, mode: "native" };
    },
    async close() {
      document.documentElement.classList.remove("android-offline-chat");
      ++playGeneration;
      activeChannel = null;
      pauseChat();
      activeVod = null; queuedVod = null; vodPlaybackEvent.emit(null); document.documentElement.classList.remove("android-vod");
      await VioletNative.stop();
    },
    preresolveStream() {},
    setFullscreen,
    onFullscreenChanged: fullscreenEvent.subscribe,
    openChannelAction: (channel, action) =>
      action === "clip"
        ? unsupported("Embedded clip creation")
        : openExternal(pageUrl(channel)),
    openSubscription: (channel) =>
      openExternal(`${pageUrl(channel)}/subscribe`),
    getNativeAvailability: async () => ({ available: true }),
    getNativeQualities: async () => (await VioletNative.qualities()).items,
    setNativeQuality: (_channel, quality) =>
      VioletNative.quality({ value: quality }),
    controlNative(command) {
      // Shared renderer sends its default compressor state on every open.
      // Disabling an unavailable effect is already satisfied on Android.
      if (command.command === "set-compressor" && !command.enabled) return;
      void VioletNative.control(command).catch((error) =>
        window.dispatchEvent(
          new CustomEvent("android-notice", { detail: String(error) }),
        ),
      );
    },
    reportNativeHlsState() {},
    onNativeHlsCommand: ignoreListener,
    getNativeStats: async () => ({
      ...await VioletNative.stats(),
      status: state.status,
    }),
    onNativeState: nativeStateEvent.subscribe,
    sendNativeControlAction: actions.emit,
    onNativeControlAction: actions.subscribe,
    multiStart: () => unsupported("Multistream"),
    multiStop() {},
    multiAddTile: () => unsupported("Multistream"),
    multiRemoveTile() {},
    multiSetActive() {},
    multiControl() {},
    multiSetQuality: () => unsupported("Multistream"),
    onMultiChatMessage: ignoreListener,
    onMultiChatState: ignoreListener,
    onMultiTileState: ignoreListener,
    onMultiTileRemoved: ignoreListener,
  },
};
