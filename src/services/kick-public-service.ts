import { z } from "zod";
import { KickCategoryCounts } from "./kick-category-count";
import type { ChatUserProfile } from "../shared/twitch";
import type {
  BrowseCategory,
  BrowsePage,
  BrowseStream,
  TwitchPinnedChatMessage,
} from "../shared/twitch";
import {
  KickChannel,
  kickSearchSchema,
  kickCategorySearchSchema,
  mapKickCategory,
  kickCategoryListSchema,
  KICK_WEB_ORIGIN,
  KICK_ORIGIN,
  REQUEST_TIMEOUT_MS,
  kickCategoryStreamsSchema,
  toIsoTimestamp,
  KickChatHistoryEntry,
  kickChatHistorySchema,
  KickEmoteSet,
  kickEmoteSetsSchema,
  kickChannelSchema,
} from "./kick-models";

const kickLiveDetails = z.object({
  data: z
    .object({
      thumbnail: z.object({ src: z.string().nullish() }).nullish(),
      language: z.string().nullish(), is_mature: z.boolean().nullish(), tags: z.array(z.string()).nullish(),
      category: z.object({ tags: z.array(z.string()).nullish() }).nullish(),
      start_time: z.string().nullish(),
      created_at: z.string().nullish(),
    })
    .nullish(),
});
/** Public Kick provider logic reused from VioletWire; browser session login stays platform-specific. */
export class KickPublicService {
  constructor(private readonly request: typeof fetch) {}
  private categoryCounts = new KickCategoryCounts(async (id, cursor, signal) => {
    const params = new URLSearchParams({ limit: "100", sort: "viewer_count_desc", category_id: id });
    if (cursor) params.set("after", cursor);
    const response = await this.request(`${KICK_WEB_ORIGIN}/api/v1/livestreams?${params}`, {
      headers: { Accept: "application/json", "User-Agent": this.userAgent(), Referer: `${KICK_ORIGIN}/` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (!response.ok) throw new Error(`Kick refused category statistics (${response.status}).`);
    return response.json();
  });
  getCategoryBroadcasters(id: string, signal: AbortSignal) {
    return this.categoryCounts.get(id, signal);
  }
  private userAgent(): string {
    return "VioletWire-Android/0.3.4";
  }
  private async requestJson(path: string): Promise<unknown> {
    const response = await this.request(KICK_ORIGIN + path, {
      headers: { Accept: "application/json", Referer: KICK_ORIGIN + "/" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `Kick refused the request (${response.status}). Try again or sign in to Kick.`,
      );
    return response.json();
  }
  /** Negotiate the public chat transport just as Kick's website does. Keys rotate. */
  async getChatConnection(channelId: string): Promise<{ appKey: string; cluster: string }> {
    const response = await this.request(
      `https://web.kick.com/api/v1/realtime/channels/${encodeURIComponent(channelId)}/chat/connection`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-app-platform": "web" },
        body: JSON.stringify({
          client: { id: crypto.randomUUID(), type: "web" },
          capabilities: { accepted_providers: [{ provider: "pusher" }] },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`Kick chat connection unavailable (${response.status}).`);
    const parsed = z.object({ data: z.object({
      mode: z.literal("websocket"),
      connections: z.array(z.object({ provider: z.string(), credentials: z.object({
        app_key: z.string().regex(/^[a-zA-Z0-9]+$/).max(128).optional(),
        cluster: z.string().regex(/^[a-z]{2,3}[0-9]?$/).optional(),
      }).passthrough() })),
    }) }).parse(await response.json());
    const transport = parsed.data.connections.find((entry) => entry.provider === "pusher");
    if (!transport?.credentials.app_key || !transport.credentials.cluster) {
      throw new Error("Kick did not offer a supported public chat connection.");
    }
    return { appKey: transport.credentials.app_key, cluster: transport.credentials.cluster };
  }

  async getChatUserProfile(channel: string, login: string): Promise<ChatUserProfile> {
    const data = z.object({ id: z.union([z.string(), z.number()]), username: z.string(),
      slug: z.string().nullish(), profile_pic: z.string().nullish(), created_at: z.string().nullish(),
      following_since: z.string().nullish(), subscribed_for: z.number().nonnegative().nullish(),
      subscription: z.object({ created_at: z.string().nullish(), expires_at: z.string().nullish() }).nullish(),
    }).parse(await this.requestJson(`/api/v2/channels/${encodeURIComponent(channel)}/users/${encodeURIComponent(login)}`));
    return { id: String(data.id), login: data.slug ?? data.username.toLowerCase(), displayName: data.username,
      profileImageUrl: data.profile_pic ?? "", description: "", createdAt: toIsoTimestamp(data.created_at) ?? "",
      relationship: { isFollowing: !!data.following_since, followedAt: toIsoTimestamp(data.following_since),
        ...(data.subscribed_for != null ? { subscription: { isSubscribed: data.subscribed_for > 0,
          months: data.subscribed_for, since: toIsoTimestamp(data.subscription?.created_at),
          expiresAt: toIsoTimestamp(data.subscription?.expires_at) } } : {}) },
    };
  }

  async getVideos(slug: string): Promise<unknown> {
    return this.requestJson(
      `/api/v2/channels/${encodeURIComponent(slug)}/videos`,
    );
  }
  async getLivestream(
    slug: string,
  ): Promise<{ thumbnailUrl?: string; startedAt?: string; tags: string[] } | null> {
    const payload = await this.requestJson(
      `/api/v2/channels/${encodeURIComponent(slug)}/livestream`,
    );
    const parsed = kickLiveDetails.safeParse(payload);
    if (!parsed.success || !parsed.data.data) return null;
    return {
      thumbnailUrl: parsed.data.data.thumbnail?.src ?? undefined,
      tags: [...new Set([...(parsed.data.data.tags ?? []), ...(parsed.data.data.category?.tags ?? []),
        ...(parsed.data.data.language ? [parsed.data.data.language] : []), ...(parsed.data.data.is_mature ? ["18+"] : [])])],
      startedAt: toIsoTimestamp(
        parsed.data.data.start_time ?? parsed.data.data.created_at,
      ),
    };
  }
  async search(term: string): Promise<KickChannel[]> {
    const query = term.trim();
    if (query.length === 0) return [];

    const payload = await this.requestJson(
      `/api/search?searched_word=${encodeURIComponent(query)}`,
    );
    if (payload === null) return [];

    const parsed = kickSearchSchema.safeParse(payload);
    if (!parsed.success) return [];

    const results: KickChannel[] = [];
    for (const entry of parsed.data.channels ?? []) {
      const slug = entry.slug;
      if (!slug) continue;
      results.push({
        id: entry.id === undefined ? slug : String(entry.id),
        slug,
        displayName: entry.user?.username ?? slug,
        profileImageUrl:
          entry.user?.profilePic ?? entry.user?.profile_pic ?? "",
        // Search does not include the chatroom, so opening a result looks the
        // channel up before connecting chat.
        chatroomId: undefined,
        isLive: Boolean(entry.isLive),
        category: entry.recentCategories?.[0]?.name ?? undefined,
        viewerCount: 0,
      });
    }
    return results;
  }

  async getCategories(
    query: string,
    cursor?: string,
  ): Promise<BrowsePage<BrowseCategory>> {
    const search = query.trim();
    if (search.length > 0) {
      const payload = await this.requestJson(
        `/api/search?searched_word=${encodeURIComponent(search)}`,
      );
      const parsed = kickCategorySearchSchema.safeParse(payload);
      if (!parsed.success) return { items: [] };
      return {
        items: (parsed.data.categories ?? []).flatMap((entry) => {
          const category = mapKickCategory(entry);
          return category ? [category] : [];
        }),
      };
    }

    const page = cursor ?? "1";
    const payload = await this.requestJson(
      `/api/v1/subcategories?page=${encodeURIComponent(page)}`,
    );
    const parsed = kickCategoryListSchema.safeParse(payload);
    if (!parsed.success) return { items: [] };
    return {
      items: (parsed.data.data ?? []).flatMap((entry) => {
        const category = mapKickCategory(entry);
        return category ? [category] : [];
      }),
      cursor: parsed.data.next_page_url
        ? String((parsed.data.current_page ?? Number(page)) + 1)
        : undefined,
    };
  }

  async getCategoryStreams(
    categoryId: string,
    cursor?: string,
  ): Promise<BrowsePage<BrowseStream>> {
    const id = categoryId.trim();

    const params = new URLSearchParams({
      limit: "24",
      sort: "viewer_count_desc",
    });
    if (id) params.set("category_id", id);
    if (cursor) params.set("after", cursor);

    const response = await this.request(
      `${KICK_WEB_ORIGIN}/api/v1/livestreams?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": this.userAgent(),
          Referer: `${KICK_ORIGIN}/`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`Kick refused category streams (${response.status}).`);
    }
    const payload: unknown = await response.json();

    const parsed = kickCategoryStreamsSchema.safeParse(payload);
    if (!parsed.success) return { items: [] };

    const items: BrowseStream[] = [];
    for (const stream of parsed.data.data?.livestreams ?? []) {
      const channelSlug = stream.channel?.slug;
      if (!channelSlug) continue;
      items.push({
        id: stream.id == null ? channelSlug : String(stream.id),
        broadcasterId:
          stream.channel?.id == null ? channelSlug : String(stream.channel.id),
        login: channelSlug,
        displayName: stream.channel?.username ?? channelSlug,
        title: stream.title ?? "",
        category: stream.category?.name ?? "",
        language: stream.language ?? "",
        tags: stream.tags ?? [],
        isMature: Boolean(stream.is_mature),
        profileImageUrl: stream.channel?.profile_pic ?? "",
        thumbnailUrl: stream.thumbnail?.src ?? "",
        viewerCount: stream.viewer_count ?? 0,
        startedAt: toIsoTimestamp(stream.start_time) ?? "",
      });
    }
    const next = parsed.data.data?.pagination?.next_cursor ?? undefined;
    // Only advance when there is both a cursor and something on this page, so
    // the scroll stops at the end instead of refetching the last page.
    return { items, cursor: next && items.length > 0 ? next : undefined };
  }

  async getChatHistory(channelId: string): Promise<KickChatHistoryEntry[]> {
    const payload = await this.requestJson(
      `/api/v2/channels/${encodeURIComponent(channelId)}/messages`,
    );
    if (payload === null) return [];
    const parsed = kickChatHistorySchema.safeParse(payload);
    if (!parsed.success) return [];
    return parsed.data.data?.messages ?? [];
  }

  async getPinnedChatMessage(
    channelId: string,
  ): Promise<TwitchPinnedChatMessage | null> {
    const payload = await this.requestJson(
      `/api/v2/channels/${encodeURIComponent(channelId)}/messages`,
    );
    if (payload === null) return null;
    const parsed = kickChatHistorySchema.safeParse(payload);
    if (!parsed.success) return null;
    const pin = parsed.data.data?.pinned_message;
    const message = pin?.message;
    if (!pin || !message) return null;
    if (pin.finish_at && Date.parse(pin.finish_at) <= Date.now()) return null;

    const fragments: TwitchPinnedChatMessage["fragments"] = [];
    const emotePattern = /\[emote:(\d+):([^\]]+)\]/g;
    let cursor = 0;
    for (const match of message.content.matchAll(emotePattern)) {
      if (match.index > cursor) {
        fragments.push({
          type: "text",
          text: message.content.slice(cursor, match.index),
        });
      }
      fragments.push({
        type: "emote",
        text: match[2],
        emote: {
          id: match[1],
          formats: ["static"],
          imageUrl: `https://files.kick.com/emotes/${match[1]}/fullsize`,
        },
      });
      cursor = match.index + match[0].length;
    }
    if (cursor < message.content.length) {
      fragments.push({ type: "text", text: message.content.slice(cursor) });
    }

    const senderName =
      message.sender?.username ?? message.sender?.slug ?? "Kick user";
    return {
      id: String(message.id),
      senderId:
        message.sender?.id === null || message.sender?.id === undefined
          ? ""
          : String(message.sender.id),
      senderLogin: message.sender?.slug ?? senderName.toLowerCase(),
      senderName,
      pinnedByName: pin.pinned_by?.username ?? pin.pinned_by?.slug ?? undefined,
      text: message.content.replace(
        emotePattern,
        (_match, _id, name: string) => name,
      ),
      fragments,
      startsAt: message.created_at ?? new Date().toISOString(),
      endsAt: pin.finish_at ?? undefined,
    };
  }

  async getEmoteSets(slug: string): Promise<KickEmoteSet[]> {
    const payload = await this.requestJson(
      `/emotes/${encodeURIComponent(slug)}`,
    );
    if (payload === null) return [];

    const parsed = kickEmoteSetsSchema.safeParse(payload);
    if (!parsed.success) return [];

    const sets: KickEmoteSet[] = [];
    for (const group of parsed.data) {
      const emotes = (group.emotes ?? [])
        .filter((emote) => emote.id !== undefined && emote.name)
        .map((emote) => ({
          id: String(emote.id),
          name: emote.name as string,
          imageUrl: `https://files.kick.com/emotes/${emote.id}/fullsize`,
          subscribersOnly: Boolean(emote.subscribers_only),
        }));
      if (emotes.length === 0) continue;
      sets.push({
        id: group.id === undefined ? (group.name ?? "set") : String(group.id),
        // The channel's own set is named after the channel; keep that, and let
        // the picker show it as the channel group.
        name: group.name ?? "Kick",
        emotes,
      });
    }
    return sets;
  }

  async getChannel(slug: string): Promise<KickChannel | null> {
    const payload = await this.requestJson(
      `/api/v2/channels/${encodeURIComponent(slug)}`,
    );
    if (payload === null) return null;

    const parsed = kickChannelSchema.safeParse(payload);
    if (!parsed.success)
      throw new Error("Kick returned an unsupported channel response.");
    return this.mapChannel(parsed.data);
  }

  private mapChannel(
    channel: z.infer<typeof kickChannelSchema>,
  ): KickChannel | null {
    const slug = channel.slug;
    if (!slug) return null;

    const livestream = channel.livestream ?? null;
    const userId = channel.user?.id ?? channel.user_id;
    return {
      id: channel.id === undefined ? slug : String(channel.id),
      userId:
        userId === null || userId === undefined ? undefined : String(userId),
      slug,
      displayName: channel.user?.username ?? slug,
      profileImageUrl: channel.user?.profile_pic ?? "",
      followers: channel.followers_count ?? undefined,
      description: channel.user?.bio ?? undefined,
      tags: [...new Set([...(livestream?.tags ?? []), ...(livestream?.categories?.flatMap(c => c.tags ?? []) ?? []),
        ...(livestream?.language ? [livestream.language] : []), ...(livestream?.is_mature ? ["18+"] : [])])],
      chatroomId:
        channel.chatroom?.id === undefined
          ? undefined
          : String(channel.chatroom.id),
      following: channel.following ?? undefined,
      subscriberBadges: (channel.subscriber_badges ?? [])
        .filter(
          (badge): badge is { id: number; months: number } =>
            typeof badge.id === "number" && typeof badge.months === "number",
        )
        .map((badge) => ({
          months: badge.months,
          imageUrl: `https://files.kick.com/channel_subscriber_badges/${badge.id}/original`,
        }))
        // Highest month tier first, so matching a sub's months takes the best.
        .sort((left, right) => right.months - left.months),
      restrictions: {
        followersOnly: Boolean(channel.chatroom?.followers_mode),
        followersMinMinutes:
          channel.chatroom?.following_min_duration ?? undefined,
        subscribersOnly: Boolean(channel.chatroom?.subscribers_mode),
        slowModeSeconds: channel.chatroom?.slow_mode
          ? (channel.chatroom.message_interval ?? undefined)
          : undefined,
        emoteOnly: Boolean(channel.chatroom?.emotes_mode),
      },
      // A null livestream is how Kick reports an offline channel.
      isLive: Boolean(livestream?.is_live),
      title: livestream?.session_title ?? undefined,
      category: livestream?.is_live
        ? (livestream.categories?.[0]?.name ?? undefined)
        : "Offline",
      viewerCount: livestream?.viewer_count ?? 0,
      startedAt: toIsoTimestamp(
        livestream?.start_time ?? livestream?.created_at,
      ),
      // Deliberately omitted: this endpoint's thumbnail host answers 403.
      // getLivestream carries the one that loads.
      thumbnailUrl: undefined,
    };
  }
}
