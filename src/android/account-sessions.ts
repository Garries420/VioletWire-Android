import { z } from "zod";
import { kickViewerState } from "./kick-viewer";
import type { KickAuthState, KickUserAccount } from "../shared/platform";
import type { KickChannel } from "../services/kick-models";
import { toIsoTimestamp } from "../services/kick-models";
import type { KickPublicService } from "../services/kick-public-service";
import type { PlaybackSessionState } from "../shared/twitch";
import type { KickChatReplyTarget } from "../services/kick-models";
import { VioletNative, nativeFetch } from "./native";

const websiteToken = z.object({ token: z.string().min(1), login: z.string().optional() });
const kickRecord = z.object({ token: z.string().min(1), account: z.object({ id: z.string(), username: z.string(), profileImageUrl: z.string() }) });
const userSchema = z.object({ id: z.union([z.number(), z.string()]), username: z.string().min(1), profile_pic: z.string().nullish() });
const followedSchema = z.object({ channels: z.array(z.unknown()).nullish(), next_cursor: z.union([z.string(), z.number()]).nullish() });
const followedEntry = z.object({
  id: z.union([z.number(), z.string()]).nullish(), channel_slug: z.string().nullish(), slug: z.string().nullish(),
  user_username: z.string().nullish(), username: z.string().nullish(), profile_picture: z.string().nullish(), profile_pic: z.string().nullish(), profilePic: z.string().nullish(),
  is_live: z.boolean().nullish(), isLive: z.boolean().nullish(), viewer_count: z.number().nullish(), viewers: z.number().nullish(), session_title: z.string().nullish(),
  category_name: z.string().nullish(), start_time: z.string().nullish(), created_at: z.string().nullish(),
});

export class AndroidAccountSessions {
  private playback: z.infer<typeof websiteToken> | null = null;
  private kick: z.infer<typeof kickRecord> | null = null;
  private generation = 0;
  private rejections = 0;
  async initialize(): Promise<void> {
    for (const record of ["kick", "twitch-playback"] as const) {
      const saved = (await VioletNative.secureGet({ record })).value;
      if (!saved) continue;
      try {
        if (record === "kick") this.kick = kickRecord.parse(JSON.parse(saved));
        else this.playback = websiteToken.parse(JSON.parse(saved));
      } catch { await VioletNative.secureRemove({ record }); }
    }
  }
  playbackToken(): string | undefined { return this.playback?.token; }
  hasKickAccount(): boolean { return this.kick !== null; }
  playbackState(): PlaybackSessionState { return { linked: this.playback !== null, login: this.playback?.login }; }
  async linkPlayback(): Promise<PlaybackSessionState> {
    const result = await VioletNative.authentication({ provider: "twitch", url: "https://www.twitch.tv/login", capture: true });
    if (!result.token) return this.playbackState();
    const response = await nativeFetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${result.token}` } });
    if (!response.ok) throw new Error("Twitch rejected this website session. Sign in again.");
    const identity = z.object({ login: z.string().optional() }).parse(await response.json());
    const session = { token: result.token, login: identity.login };
    await VioletNative.secureSet({ record: "twitch-playback", value: JSON.stringify(session) });
    this.playback = session;
    return this.playbackState();
  }
  async unlinkPlayback(): Promise<PlaybackSessionState> {
    await VioletNative.secureRemove({ record: "twitch-playback" }); this.playback = null;
    await VioletNative.clearWebsiteSession({ provider: "twitch" }); return this.playbackState();
  }
  async request(path: string, method = "GET", body?: unknown, token = this.kick?.token): Promise<Response> {
    if (!token) throw new Error("Sign in to Kick first.");
    const result = await VioletNative.kickRequest({ path, method, token, body: body === undefined ? undefined : JSON.stringify(body) });
    if (result.status === 0) throw new Error("Kick could not be reached. Try again.");
    return new Response(result.status === 204 ? null : result.data, { status: result.status });
  }
  async signIn(): Promise<KickUserAccount | null> {
    const generation = ++this.generation;
    await VioletNative.clearWebsiteSession({ provider: "kick" });
    const result = await VioletNative.authentication({ provider: "kick", url: "https://id.kick.com/login?redirect=https%3A%2F%2Fkick.com%2F", capture: true });
    if (!result.token || generation !== this.generation) return null;
    const response = await this.request("/api/v1/user", "GET", undefined, result.token);
    if (!response.ok) throw new Error(`Kick could not verify the account (${response.status}). Try signing in again.`);
    const user = userSchema.parse(await response.json());
    const account = { id: String(user.id), username: user.username, profileImageUrl: user.profile_pic ?? "" };
    if (generation !== this.generation) return null;
    const session = { token: result.token, account };
    await VioletNative.secureSet({ record: "kick", value: JSON.stringify(session) });
    this.kick = session; this.rejections = 0; return account;
  }
  async signOut(): Promise<void> {
    this.generation++; await VioletNative.secureRemove({ record: "kick" }); this.kick = null; this.rejections = 0;
    await VioletNative.clearWebsiteSession({ provider: "kick" });
  }
  async authState(): Promise<KickAuthState> {
    const session = this.kick; if (!session) return { status: "signed-out", account: null };
    try {
      const response = await this.request("/api/v1/user");
      if (this.kick !== session) return this.kick ? { status: "signed-in", account: this.kick.account } : { status: "signed-out", account: null };
      if ([401, 403, 419].includes(response.status)) {
        if (++this.rejections < 3) return { status: "unavailable", account: null };
        await this.signOut(); return { status: "signed-out", account: null, reason: "expired" };
      }
      if (!response.ok) return { status: "unavailable", account: null };
      const user = userSchema.safeParse(await response.json());
      if (!user.success) return { status: "unavailable", account: null };
      if (this.kick !== session) return { status: "signed-out", account: null };
      this.rejections = 0;
      session.account = { id: String(user.data.id), username: user.data.username, profileImageUrl: user.data.profile_pic ?? "" };
      return { status: "signed-in", account: session.account };
    } catch { return { status: "unavailable", account: null }; }
  }
  async getUser(): Promise<KickUserAccount | null> { const state = await this.authState(); return state.status === "signed-in" ? state.account : null; }
  async followed(_publicService: KickPublicService): Promise<KickChannel[]> {
    if (!this.kick) return [];
    const channels: KickChannel[] = [], seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await this.request("/api/v2/channels/followed" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""));
      if (!response.ok) throw new Error(`Kick could not load followed channels (${response.status}).`);
      const raw: unknown = await response.json(); const data = followedSchema.parse(Array.isArray(raw) ? { channels: raw } : raw);
      for (const rawEntry of data.channels ?? []) {
        const parsed = followedEntry.safeParse(rawEntry); if (!parsed.success) continue;
        const entry = parsed.data, slug = entry.channel_slug ?? entry.slug; if (!slug || seen.has(slug)) continue; seen.add(slug);
        channels.push({ id: entry.id == null ? slug : String(entry.id), slug, displayName: entry.user_username ?? entry.username ?? slug,
          profileImageUrl: entry.profile_picture ?? entry.profilePic ?? entry.profile_pic ?? "", isLive: Boolean(entry.is_live ?? entry.isLive), following: true,
          title: entry.session_title ?? undefined, category: entry.category_name ?? undefined, viewerCount: entry.viewer_count ?? entry.viewers ?? 0,
          startedAt: toIsoTimestamp(entry.start_time ?? entry.created_at) });
      }
      const next = data.next_cursor == null ? undefined : String(data.next_cursor);
      if (!next || next === "0" || next === cursor) break; cursor = next;
    }
    return channels;
  }
  async viewer(slug: string): Promise<{ following?: boolean; subscribed?: boolean }> {
    if (!this.kick) return { following: false, subscribed: false };
    const session = this.kick;
    const response = await this.request(`/api/v2/channels/${encodeURIComponent(slug)}/me`);
    if (!response.ok) throw new Error(`Kick could not check channel membership (${response.status}).`);
    const viewer = kickViewerState(await response.json());
    // Never attach the previous account's entitlements after sign-out/sign-in.
    return this.kick === session ? viewer : {};
  }
  async setFollowing(slug: string, follow: boolean): Promise<void> {
    const response = await this.request(`/api/v2/channels/${encodeURIComponent(slug)}/follow`, follow ? "POST" : "DELETE");
    if (!response.ok && response.status !== 409) throw new Error(`Kick could not change the follow state (${response.status}).`);
  }
  async send(room: string, content: string, reply?: KickChatReplyTarget): Promise<void> {
    const response = await this.request(`/api/v2/messages/send/${encodeURIComponent(room)}`, "POST", reply ? {
      content, type: "reply", message_ref: String(Date.now()), metadata: { original_message: { id: reply.id, content: reply.content }, original_sender: { id: reply.senderId, username: reply.senderUsername } },
      ...(reply.threadParentId ? { thread_parent_id: reply.threadParentId } : {}),
    } : { content, type: "message", message_ref: String(Date.now()) });
    if (!response.ok) {
      let detail = ""; try { const data = z.object({ message: z.string().optional() }).parse(await response.json()); detail = data.message ?? ""; } catch { /* Optional provider error. */ }
      throw new Error(detail.slice(0, 200) || `Kick could not send the message (${response.status}).`);
    }
  }
}
