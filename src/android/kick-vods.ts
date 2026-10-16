import { z } from "zod";
import type { KickPublicService } from "../services/kick-public-service";
import { toIsoTimestamp } from "../services/kick-models";
import { VioletNative } from "./native";
import {
  loadReplay,
  parseReplayNodes,
  parseVodVariants,
  resolveVod,
  type Vod,
  type VodProfile,
  type ReplayMessage,
} from "./vod-service";

const uuid = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
const archive = z.object({
  duration: z.number(),
  is_live: z.boolean().nullish(),
  source: z.string().nullish(),
  start_time: z.string().nullish(),
  created_at: z.string().nullish(),
  session_title: z.string().nullish(),
  views: z.number().nullish(),
  thumbnail: z.object({ src: z.string().nullish() }).nullish(),
  video: z.object({
    uuid,
    is_private: z.boolean().nullish(),
    is_pruned: z.boolean().nullish(),
    deleted_at: z.string().nullish(),
    created_at: z.string().nullish(),
    views: z.number().nullish(),
  }),
});

export function parseKickVods(
  payload: unknown,
  channel: {
    slug: string;
    displayName: string;
    id: string;
    replayChannelId?: string;
  },
): Vod[] {
  if (!Array.isArray(payload))
    throw new Error(
      "Kick could not load this channel's past videos. Try again.",
    );
  return payload.flatMap((raw) => {
    const parsed = archive.safeParse(raw);
    if (!parsed.success) return [];
    const item = parsed.data;
    if (
      item.is_live ||
      item.duration <= 0 ||
      item.video.is_private ||
      item.video.is_pruned ||
      item.video.deleted_at
    )
      return [];
    const recordedAt = toIsoTimestamp(item.start_time ?? item.created_at);
    return [
      {
        id: item.video.uuid,
        channel: `kick:${channel.slug}`,
        broadcasterId: channel.id,
        replayChannelId: channel.replayChannelId,
        displayName: channel.displayName,
        title: item.session_title ?? "Past broadcast",
        thumbnail: item.thumbnail?.src ?? "",
        duration: Math.floor(item.duration / 1000),
        createdAt:
          toIsoTimestamp(item.video.created_at ?? item.created_at) ??
          recordedAt ??
          "",
        recordedAt,
        playbackUrl: item.source ?? undefined,
        views: item.views ?? item.video.views ?? 0,
        type: "ARCHIVE",
      },
    ];
  });
}
export async function loadKickVodProfile(
  service: KickPublicService,
  slug: string,
): Promise<VodProfile> {
  const [channel, payload] = await Promise.all([
    service.getChannel(slug),
    service.getVideos(slug).catch(() => []),
  ]);
  if (!channel) throw new Error("Kick channel was not found.");
  return {
    login: `kick:${slug}`,
    displayName: channel.displayName,
    image: channel.profileImageUrl,
    description: channel.description ?? "",
    followers: channel.followers,
    live: channel.isLive,
    viewers: channel.viewerCount,
    videos: parseKickVods(payload, {
      ...channel,
      id: channel.userId ?? channel.id,
      replayChannelId: channel.id,
    }),
  };
}
export async function resolveArchive(video: Vod, token?: string) {
  if (!video.channel.startsWith("kick:")) return resolveVod(video.id, token);
  uuid.parse(video.id);
  const address = new URL(video.playbackUrl ?? "");
  if (
    address.protocol !== "https:" ||
    address.hostname !== "stream.kick.com" ||
    address.username ||
    address.password ||
    (address.port && address.port !== "443")
  )
    throw new Error("Kick did not return a playable address for this video.");
  const { text } = await VioletNative.vodManifest({ url: address.toString() });
  const variants = parseVodVariants(text, address.toString());
  if (!variants.length)
    throw new Error("Kick returned no playable VOD qualities.");
  return { url: address.toString(), variants };
}
export async function loadArchiveReplay(
  video: Vod,
  offset: number,
  cursor?: string,
): Promise<{
  messages: ReplayMessage[];
  cursor?: string;
  nextOffset?: number;
}> {
  if (!video.channel.startsWith("kick:"))
    return loadReplay(video.id, video.channel, offset, cursor);
  const start = cursor === undefined ? Math.floor(offset) : Number(cursor);
  const response = await VioletNative.kickVodComments({ video, offset: start });
  const page = z
    .object({
      edges: z.array(z.object({ node: z.unknown() })),
      nextOffset: z.number(),
      pageInfo: z.object({ hasNextPage: z.boolean() }),
    })
    .parse(response.comments);
  if (page.pageInfo.hasNextPage && page.nextOffset <= start)
    throw new Error("Kick chat replay could not advance. Retry chat.");
  return {
    messages: parseReplayNodes(
      page.edges.map((e) => e.node),
      video.channel,
    ),
    cursor: page.pageInfo.hasNextPage ? String(page.nextOffset) : undefined,
    nextOffset: page.nextOffset,
  };
}
