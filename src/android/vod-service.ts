import { z } from "zod";
import type { ChatMessage, TwitchChatAssets } from "../shared/chat";
import type { EmoteSetResult } from "../shared/emotes";
import { nativeFetch, VioletNative } from "./native";

export interface Vod {
  id: string;
  channel: string;
  broadcasterId?: string;
  displayName: string;
  title: string;
  thumbnail: string;
  duration: number;
  createdAt: string;
  views: number;
  type: string;
  downloadStart?: number;
  downloadEnd?: number;
  playbackUrl?: string;
  recordedAt?: string;
  replayChannelId?: string;
}
export interface VodChatAssets extends TwitchChatAssets {
  providerSets?: EmoteSetResult[];
  saveArtwork?: boolean;
}
export interface VodProfile {
  login: string;
  displayName: string;
  description: string;
  image: string;
  videos: Vod[];
  cursor?: string;
  live?: boolean;
  viewers?: number;
  followers?: number;
  banner?: string;
}
export interface VodVariant {
  value: string;
  label: string;
  url: string;
  bitrate: number;
}
export interface VodDownload {
  id: string;
  video: Vod;
  state: string;
  videoPercent: number;
  chatPercent: number;
  chatState: string;
  bytes: number;
  quality: string;
  error?: string;
  assets?: TwitchChatAssets;
}
export const vodId = z.string().regex(/^\d{1,20}$/);
const clientId = "kimne78kx3ncx6brgo4mv6wki5h1ko";
async function gql(
  query: string,
  variables: unknown,
  token?: string,
): Promise<Record<string, unknown>> {
  const response = await nativeFetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `OAuth ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(`Twitch VOD request failed (${response.status}).`);
  const payload = z
    .object({
      data: z.record(z.string(), z.unknown()).nullish(),
      errors: z.array(z.object({ message: z.string() })).optional(),
    })
    .parse(await response.json());
  if (!payload.data || payload.errors?.length)
    throw new Error(
      payload.errors?.[0]?.message ?? "Twitch did not return this video.",
    );
  return payload.data;
}
const videoSchema = z.object({
  id: vodId,
  title: z.string(),
  previewThumbnailURL: z.string().nullish(),
  lengthSeconds: z.number(),
  createdAt: z.string(),
  viewCount: z.number().nullish(),
  broadcastType: z.string().nullish(),
});
export async function loadVodProfile(
  login: string,
  cursor?: string,
  token?: string,
): Promise<VodProfile> {
  const data = await gql(
    `query ProfileVideos($login: String!, $after: Cursor) { user(login: $login) { id login displayName description profileImageURL(width: 300) stream { viewersCount } followers { totalCount } videos(first: 20, after: $after, sort: TIME, types: [ARCHIVE, HIGHLIGHT, UPLOAD]) { edges { cursor node { id title previewThumbnailURL lengthSeconds createdAt viewCount broadcastType } } pageInfo { hasNextPage } } } }`,
    { login, after: cursor ?? null },
    token,
  );
  const parsed = z
    .object({
      id: z.string().nullish(),
      login: z.string(),
      displayName: z.string(),
      description: z.string().nullish(),
      profileImageURL: z.string().nullish(),
      stream: z.object({ viewersCount: z.number() }).nullish(),
      followers: z.object({ totalCount: z.number() }).nullish(),
      videos: z.object({
        edges: z.array(
          z.object({ cursor: z.string().nullish(), node: videoSchema }),
        ),
        pageInfo: z.object({ hasNextPage: z.boolean() }),
      }),
    })
    .safeParse(data.user);
  if (!parsed.success)
    throw new Error("Twitch could not load this channel's profile. Try again.");
  const user = parsed.data;
  return {
    login: user.login,
    displayName: user.displayName,
    description: user.description ?? "",
    image: user.profileImageURL ?? "",
    live: !!user.stream,
    viewers: user.stream?.viewersCount,
    followers: user.followers?.totalCount,
    videos: user.videos.edges.map(({ node }) => ({
      id: node.id,
      channel: user.login,
      broadcasterId: user.id ?? undefined,
      displayName: user.displayName,
      title: node.title,
      thumbnail:
        node.previewThumbnailURL
          ?.replace(/%?\{width\}/g, "640")
          .replace(/%?\{height\}/g, "360") ?? "",
      duration: node.lengthSeconds,
      createdAt: node.createdAt,
      views: node.viewCount ?? 0,
      type: node.broadcastType ?? "ARCHIVE",
    })),
    cursor: user.videos.pageInfo.hasNextPage
      ? (user.videos.edges.at(-1)?.cursor ?? undefined)
      : undefined,
  };
}
export function parseVodVariants(text: string, master: string): VodVariant[] {
  const lines = text.split(/\r?\n/),
    items: VodVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const fields = Object.fromEntries(
      [...lines[i].matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map((m) => [
        m[1],
        m[2].replace(/^"|"$/g, ""),
      ]),
    );
    const address = lines
      .slice(i + 1)
      .find((line) => line.trim() && !line.startsWith("#"));
    if (!address) continue;
    const height = Number(fields.RESOLUTION?.split("x")[1] ?? 0),
      fps = Math.round(Number(fields["FRAME-RATE"] ?? 0));
    const value = height ? `${height}p${fps > 30 ? fps : ""}` : "audio_only";
    const url = new URL(address, master);
    if (url.protocol !== "https:" || url.username || url.password) continue;
    items.push({
      value,
      label: height ? `${height}p${fps > 30 ? fps : ""}` : "Audio only",
      url: url.toString(),
      bitrate: Number(fields.BANDWIDTH ?? 0),
    });
  }
  if (!items.length && text.includes("#EXTINF:"))
    items.push({ value: "source", label: "Source", url: master, bitrate: 0 });
  return items;
}
export async function resolveVod(
  id: string,
  token?: string,
): Promise<{ url: string; variants: VodVariant[] }> {
  const data = await gql(
    `query VodAccess($id: ID!) { videoPlaybackAccessToken(id: $id, params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) { value signature } }`,
    { id: vodId.parse(id) },
    token,
  );
  const access = z
    .object({ value: z.string(), signature: z.string() })
    .parse(data.videoPlaybackAccessToken);
  const query = new URLSearchParams({
    nauth: access.value,
    nauthsig: access.signature,
    allow_source: "true",
    allow_audio_only: "true",
    supported_codecs: "h264,h265,av1",
  });
  const url = `https://usher.ttvnw.net/vod/${id}.m3u8?${query}`;
  const result = await VioletNative.vodManifest({ url });
  const variants = parseVodVariants(result.text, url);
  if (!variants.length)
    throw new Error("Twitch returned no playable VOD qualities.");
  return { url, variants };
}
const commentNode = z.object({
  id: z.string(),
  contentOffsetSeconds: z.number(),
  createdAt: z.string().nullish(),
  commenter: z.object({ login: z.string(), displayName: z.string() }).nullish(),
  message: z
    .object({
      fragments: z
        .array(
          z.object({
            text: z.string(),
            emote: z
              .object({
                emoteID: z.string(),
                imageUrl: z.string().optional(),
                provider: z.enum(["twitch", "kick"]).optional(),
              })
              .nullish(),
          }),
        )
        .nullish(),
      userBadges: z
        .array(z.object({ setID: z.string(), version: z.string() }))
        .nullish(),
      userColor: z.string().nullish(),
      badgeAssets: z
        .array(
          z.object({
            key: z.string(),
            title: z.string(),
            imageUrl: z.string(),
          }),
        )
        .optional(),
    })
    .nullish(),
});
export interface ReplayMessage {
  offset: number;
  message: ChatMessage;
}
export function parseReplayNodes(
  nodes: unknown[],
  channel: string,
): ReplayMessage[] {
  return nodes
    .flatMap((raw) => {
      const parsed = commentNode.safeParse(raw);
      if (!parsed.success || !parsed.data.message) return [];
      const node = parsed.data;
      let text = "";
      const emotes: ChatMessage["twitchEmotes"] = [];
      for (const fragment of node.message!.fragments ?? []) {
        const start = Array.from(text).length;
        text += fragment.text;
        if (fragment.emote)
          emotes.push({
            id: fragment.emote.emoteID,
            start,
            end: start + Array.from(fragment.text).length - 1,
            ...(fragment.emote.imageUrl
              ? {
                  imageUrl: fragment.emote.imageUrl,
                  provider: fragment.emote.provider,
                }
              : {}),
          });
      }
      return [
        {
          offset: node.contentOffsetSeconds,
          message: {
            id: node.id,
            channel,
            login: node.commenter?.login ?? "",
            displayName: node.commenter?.displayName ?? "Deleted user",
            color: node.message!.userColor ?? "",
            text,
            badges: (node.message!.userBadges ?? []).map(
              (b) => `${b.setID}/${b.version}`,
            ),
            sentAt: node.createdAt ? Date.parse(node.createdAt) : Date.now(),
            twitchEmotes: emotes,
            badgeAssets: node.message!.badgeAssets,
          },
        },
      ];
    })
    .sort((a, b) => a.offset - b.offset);
}
export async function loadReplay(
  id: string,
  channel: string,
  offset: number,
  cursor?: string,
): Promise<{ messages: ReplayMessage[]; cursor?: string }> {
  const data = await VioletNative.vodComments({
    id: vodId.parse(id),
    cursor,
    offset: Math.floor(offset),
  });
  const video = z
    .object({
      comments: z
        .object({
          edges: z.array(z.object({ cursor: z.string(), node: z.unknown() })),
          pageInfo: z.object({ hasNextPage: z.boolean() }),
          offsetPaging: z.boolean().optional(),
        })
        .nullish(),
    })
    .parse(data);
  if (!video.comments) return { messages: [] };
  const messages = parseReplayNodes(
    video.comments.edges.map((e) => e.node),
    channel,
  );
  const next = video.comments.pageInfo.hasNextPage
    ? video.comments.edges.at(-1)?.cursor
    : undefined;
  if (video.comments.pageInfo.hasNextPage && (!next || next === cursor))
    throw new Error("Twitch chat replay could not advance. Retry chat.");
  const boundary = z
    .object({ id: z.string(), contentOffsetSeconds: z.number() })
    .safeParse(video.comments.edges.at(-1)?.node);
  const checkpoint =
    next && boundary.success
      ? `offset:${Math.floor(boundary.data.contentOffsetSeconds)}:${encodeURIComponent(boundary.data.id)}:${next}`
      : next;
  if (checkpoint && checkpoint === cursor)
    throw new Error("Twitch chat replay could not advance. Retry chat.");
  return { messages, cursor: checkpoint };
}
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
