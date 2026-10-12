import { z } from "zod";
import type { BrowseCategory } from "../shared/twitch";

export const KICK_ORIGIN = "https://kick.com";

// Kick's newer API host serves its viewer-sorted, cursor-paginated directory.
export const KICK_WEB_ORIGIN = "https://web.kick.com";

export const REQUEST_TIMEOUT_MS = 10_000;

// Only rendered fields are declared; absent optional fields degrade a card.
export const kickLivestreamSchema = z.object({
  id: z.number().nullish(),
  is_live: z.boolean().nullish(),
  viewer_count: z.number().nullish(),
  session_title: z.string().nullish(),
  created_at: z.string().nullish(),
  start_time: z.string().nullish(),
  categories: z.array(z.object({ name: z.string().nullish() })).optional(),
});

export const kickChannelSchema = z.object({
  id: z.number().nullish(),
  slug: z.string().nullish(),
  user_id: z.number().nullish(),
  user: z
    .object({
      id: z.number().nullish(),
      username: z.string().nullish(),
      profile_pic: z.string().nullish(),
      bio: z.string().nullish(),
      created_at: z.string().nullish(),
    })
    .optional(),
  subscriber_badges: z
    .array(z.object({ id: z.number().nullish(), months: z.number().nullish() }))
    .nullish(),
  chatroom: z
    .object({
      id: z.number().nullish(),
      followers_mode: z.boolean().nullish(),
      subscribers_mode: z.boolean().nullish(),
      emotes_mode: z.boolean().nullish(),
      slow_mode: z.boolean().nullish(),
      message_interval: z.number().nullish(),
      following_min_duration: z.number().nullish(),
    })
    .optional(),
  livestream: kickLivestreamSchema.nullable().optional(),
  // Only returned to a signed-in caller; absent otherwise.
  following: z.boolean().nullish(),
});

export const kickSearchSchema = z.object({
  channels: z
    .array(
      z.object({
        id: z.number().nullish(),
        slug: z.string().nullish(),
        isLive: z.boolean().nullish(),
        user: z
          .object({
            username: z.string().nullish(),
            profilePic: z.string().nullish(),
            profile_pic: z.string().nullish(),
          })
          .optional(),
        recentCategories: z
          .array(z.object({ name: z.string().nullish() }))
          .optional(),
      }),
    )
    .optional(),
});

export const kickEmoteSetsSchema = z.array(
  z.object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().nullish(),
    emotes: z
      .array(
        z.object({
          id: z.number().nullish(),
          name: z.string().nullish(),
          subscribers_only: z.boolean().nullish(),
        }),
      )
      .optional(),
  }),
);

export interface KickChatHistoryEntry {
  id?: string | null;
  content?: string | null;
  created_at?: string | null;
  type?: string | null;
  metadata?: unknown;
  thread_parent_id?: string | null;
  replied_to?: unknown;
  replies_to?: unknown;
  sender?: {
    id?: number | null;
    slug?: string | null;
    username?: string | null;
    identity?: {
      color?: string | null;
      badges?:
        | {
            type?: string | null;
            text?: string | null;
            count?: number | null;
          }[]
        | null;
      badges_v2?: { name?: string | null; image_url?: string | null }[] | null;
    } | null;
  } | null;
}

export const kickHistorySenderSchema = z
  .object({
    id: z.number().nullish(),
    slug: z.string().nullish(),
    username: z.string().nullish(),
    identity: z
      .object({
        color: z.string().nullish(),
        badges: z
          .array(
            z.object({
              type: z.string().nullish(),
              text: z.string().nullish(),
              count: z.number().nullish(),
            }),
          )
          .nullish(),
        badges_v2: z
          .array(
            z.object({
              name: z.string().nullish(),
              image_url: z.string().nullish(),
            }),
          )
          .nullish(),
      })
      .nullish(),
  })
  .nullish();

export const kickChatHistorySchema = z.object({
  data: z
    .object({
      messages: z
        .array(
          z.object({
            id: z.union([z.string(), z.number()]).nullish(),
            content: z.string().nullish(),
            created_at: z.string().nullish(),
            type: z.string().nullish(),
            metadata: z.unknown().optional(),
            thread_parent_id: z.union([z.string(), z.number()]).nullish(),
            replied_to: z.unknown().optional(),
            replies_to: z.unknown().optional(),
            sender: kickHistorySenderSchema,
          }),
        )
        .nullish()
        .transform((messages) =>
          (messages ?? []).map((message) => ({
            ...message,
            id:
              message.id === null || message.id === undefined
                ? undefined
                : String(message.id),
            thread_parent_id:
              message.thread_parent_id === null ||
              message.thread_parent_id === undefined
                ? undefined
                : String(message.thread_parent_id),
          })),
        ),
      pinned_message: z
        .object({
          duration: z.union([z.string(), z.number()]).nullish(),
          finish_at: z.string().nullish(),
          pinned_by: z
            .object({
              username: z.string().nullish(),
              slug: z.string().nullish(),
            })
            .nullish(),
          message: z
            .object({
              id: z.union([z.string(), z.number()]),
              content: z.string(),
              created_at: z.string().nullish(),
              sender: kickHistorySenderSchema,
            })
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

export interface KickEmote {
  id: string;
  name: string;
  imageUrl: string;
  subscribersOnly: boolean;
}

export interface KickEmoteSet {
  id: string;
  name: string;
  emotes: KickEmote[];
}

export interface KickChatRestrictions {
  followersOnly: boolean;
  followersMinMinutes?: number;
  subscribersOnly: boolean;
  slowModeSeconds?: number;
  emoteOnly: boolean;
}

export interface KickChannel {
  id: string;
  /** Kick's user id, which is what 7TV indexes a Kick channel by. */
  userId?: string;
  slug: string;
  displayName: string;
  profileImageUrl: string;
  /** Needed to subscribe to the channel's chat; absent means chat is unavailable. */
  chatroomId?: string;
  /** Whether the signed-in account follows this channel; undefined if unknown. */
  following?: boolean;
  restrictions?: KickChatRestrictions;
  /** Sub badge tiers, newest-months first, so a sub's count picks its image. */
  subscriberBadges?: { months: number; imageUrl: string }[];
  isLive: boolean;
  title?: string;
  category?: string;
  viewerCount: number;
  startedAt?: string;
  thumbnailUrl?: string;
}

export interface KickChatReplyTarget {
  id: string;
  content: string;
  senderId: number;
  senderUsername: string;
  threadParentId?: string;
}

export function toIsoTimestamp(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  return `${match[1]}T${match[2]}Z`;
}

export const kickBannerSchema = z
  .object({
    responsive: z.string().nullish(),
    srcset: z.string().nullish(),
    url: z.string().nullish(),
    src: z.string().nullish(),
  })
  .nullish();

export const kickCategorySchema = z.object({
  id: z.number().nullish(),
  name: z.string().nullish(),
  slug: z.string().nullish(),
  banner: kickBannerSchema,
  viewer_count: z.number().nullish(),
  viewers_count: z.number().nullish(),
  livestreams_count: z.number().nullish(),
});

export const kickCategoryListSchema = z.object({
  data: z.array(kickCategorySchema).nullish(),
  current_page: z.number().nullish(),
  next_page_url: z.string().nullish(),
});

export const kickCategorySearchSchema = z.object({
  categories: z.array(kickCategorySchema).nullish(),
});

export const kickWebStreamSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  title: z.string().nullish(),
  start_time: z.string().nullish(),
  language: z.string().nullish(),
  is_mature: z.boolean().nullish(),
  viewer_count: z.number().nullish(),
  tags: z.array(z.string()).nullish(),
  thumbnail: z.object({ src: z.string().nullish() }).nullish(),
  channel: z
    .object({
      id: z.number().nullish(),
      slug: z.string().nullish(),
      username: z.string().nullish(),
      profile_pic: z.string().nullish(),
    })
    .nullish(),
  category: z.object({ name: z.string().nullish() }).nullish(),
});

export const kickCategoryStreamsSchema = z.object({
  data: z
    .object({
      livestreams: z.array(kickWebStreamSchema).nullish(),
      pagination: z.object({ next_cursor: z.string().nullish() }).nullish(),
    })
    .nullish(),
});

export function firstSrcsetUrl(
  ...candidates: (string | null | undefined)[]
): string {
  for (const value of candidates) {
    if (!value) continue;
    const first = value.split(",")[0]?.trim().split(/\s+/)[0];
    if (first) return first;
  }
  return "";
}

export function mapKickCategory(
  entry: z.infer<typeof kickCategorySchema>,
): BrowseCategory | null {
  if (entry.id == null || !entry.name) return null;
  return {
    id: String(entry.id),
    name: entry.name,
    boxArtUrl: firstSrcsetUrl(
      entry.banner?.responsive,
      entry.banner?.srcset,
      entry.banner?.url,
      entry.banner?.src,
    ),
    viewers: entry.viewer_count ?? entry.viewers_count ?? undefined,
    broadcasters: entry.livestreams_count ?? undefined,
  };
}
