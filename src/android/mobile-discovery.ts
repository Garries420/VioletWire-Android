import { z } from "zod";
import { nativeFetch } from "./native";
import { discoverKick } from "./platform";
import type { Vod } from "./vod-service";
export interface MobileChannel {
  key: string;
  name: string;
  image: string;
  thumbnail?: string;
  title?: string;
  category?: string;
  live: boolean;
  viewers: number;
  followers?: number;
  startedAt?: string;
  tags?: string[];
}
export interface MobileGame {
  id: string;
  name: string;
  image: string;
  viewers?: number;
  broadcasters?: number;
  tags?: string[];
}
export interface MobilePage<T> {
  items: T[];
  cursor?: string;
}
const user = z.object({
  id: z.string(),
  login: z.string(),
  displayName: z.string(),
  profileImageURL: z.string().nullish(),
  followers: z.object({ totalCount: z.number() }).nullish(),
  broadcastSettings: z.object({ title: z.string().nullish() }).nullish(),
  stream: z.object({ viewersCount: z.number() }).nullish(),
});
const stream = z.object({
  id: z.string(),
  broadcaster: user,
  viewersCount: z.number(),
  createdAt: z.string(),
  previewImageURL: z.string().nullish(),
  game: z.object({ displayName: z.string() }).nullish(),
  freeformTags: z.array(z.object({ name: z.string() })).nullish(),
});
const game = z.object({
  id: z.string(),
  displayName: z.string(),
  boxArtURL: z.string().nullish(),
  viewersCount: z.number().nullish(),
  broadcastersCount: z.number().nullish(),
  tags: z.array(z.object({ localizedName: z.string() })).nullish(),
});
const streamFields =
  "id viewersCount createdAt previewImageURL broadcaster { id login displayName profileImageURL(width: 300) broadcastSettings { title } } game { displayName } freeformTags { name }";
export async function mobileGql(
  query: string,
  variables: unknown,
): Promise<Record<string, unknown>> {
  const r = await nativeFetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: {
      "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Twitch request failed (${r.status}).`);
  const p = z
    .object({
      data: z.record(z.string(), z.unknown()).nullish(),
      errors: z.array(z.object({ message: z.string() })).optional(),
    })
    .parse(await r.json());
  if (!p.data || p.errors?.length)
    throw new Error(p.errors?.[0]?.message ?? "Twitch returned no results.");
  return p.data;
}
export const thumbnail = (url: string) =>
  url.replace(/%?\{width\}/g, "640").replace(/%?\{height\}/g, "360");
// Game covers use portrait artwork; requesting stream dimensions distorts the cover.
export const gameArtwork = (url: string) =>
  url.replace(/%?\{width\}/g, "300").replace(/%?\{height\}/g, "400");
function edges<T>(raw: unknown, schema: z.ZodType<T>): MobilePage<T> {
  const p = z
    .object({
      edges: z.array(z.object({ cursor: z.string(), node: schema })),
      pageInfo: z.object({ hasNextPage: z.boolean() }),
    })
    .parse(raw);
  return {
    items: p.edges.map((e) => e.node),
    cursor: p.pageInfo.hasNextPage ? p.edges.at(-1)?.cursor : undefined,
  };
}
const mapStream = (s: z.infer<typeof stream>): MobileChannel => ({
  key: s.broadcaster.login,
  name: s.broadcaster.displayName,
  image: s.broadcaster.profileImageURL ?? "",
  thumbnail: thumbnail(s.previewImageURL ?? ""),
  title: s.broadcaster.broadcastSettings?.title ?? "",
  category: s.game?.displayName,
  live: true,
  viewers: s.viewersCount,
  startedAt: s.createdAt,
  tags: s.freeformTags?.map((t) => t.name),
});
export async function popular(
  provider: "twitch" | "kick",
  cursor?: string,
  category?: string,
): Promise<MobilePage<MobileChannel>> {
  if (provider === "kick") {
    const p = await discoverKick.getCategoryStreams(category ?? "", cursor);
    return {
      ...p,
      items: p.items.map((s) => ({
        key: `kick:${s.login}`,
        name: s.displayName,
        image: s.profileImageUrl,
        thumbnail: s.thumbnailUrl,
        title: s.title,
        category: s.category,
        live: true,
        viewers: s.viewerCount,
        startedAt: s.startedAt,
        tags: s.tags,
      })),
    };
  }
  const d = await mobileGql(
    category
      ? `query List($id: ID!, $after: Cursor) { game(id:$id) { streams(first:30,after:$after,options:{sort:VIEWER_COUNT}) { edges { cursor node { ${streamFields} } } pageInfo { hasNextPage } } } }`
      : `query List($after:Cursor) { streams(first:30,after:$after,options:{sort:VIEWER_COUNT}) { edges { cursor node { ${streamFields} } } pageInfo { hasNextPage } } }`,
    { id: category, after: cursor ?? null },
  );
  const raw = category
    ? z.object({ streams: z.unknown() }).parse(d.game).streams
    : d.streams;
  const p = edges(raw, stream);
  return {
    ...p,
    items: p.items.map(mapStream).sort((a, b) => b.viewers - a.viewers),
  };
}
export async function games(
  provider: "twitch" | "kick",
  cursor?: string,
): Promise<MobilePage<MobileGame>> {
  if (provider === "kick") {
    const p = await discoverKick.getCategories("", cursor);
    return { ...p, items: p.items.map((g) => ({ ...g, image: g.boxArtUrl })) };
  }
  const d = await mobileGql(
    "query Games($after:Cursor) { games(first:30,after:$after) { edges { cursor node { id displayName boxArtURL viewersCount broadcastersCount tags(tagType:CONTENT) { localizedName } } } pageInfo { hasNextPage } } }",
    { after: cursor ?? null },
  );
  const p = edges(d.games, game);
  return {
    ...p,
    items: p.items.map((g) => ({
      id: g.id,
      name: g.displayName,
      image: gameArtwork(g.boxArtURL ?? ""),
      viewers: g.viewersCount ?? undefined,
      broadcasters: g.broadcastersCount ?? undefined,
      tags: g.tags?.map((t) => t.localizedName),
    })),
  };
}
export async function searchChannels(
  query: string,
  cursor?: string,
): Promise<MobilePage<MobileChannel>> {
  const d = await mobileGql(
    "query Search($q:String!,$after:Cursor) { searchUsers(userQuery:$q,first:30,after:$after) { edges { cursor node { id login displayName profileImageURL(width:300) followers { totalCount } stream { viewersCount } } } pageInfo { hasNextPage } } }",
    { q: query, after: cursor ?? null },
  );
  const p = edges(d.searchUsers, user);
  const twitch = p.items.map((u) => ({
    key: u.login,
    name: u.displayName,
    image: u.profileImageURL ?? "",
    live: !!u.stream,
    viewers: u.stream?.viewersCount ?? 0,
    followers: u.followers?.totalCount ?? 0,
  }));
  const kick = cursor ? [] : await discoverKick.search(query).catch(() => []);
  return {
    ...p,
    items: rankChannels(
      [
        ...twitch,
        ...kick.map((k) => ({
          key: `kick:${k.slug}`,
          name: k.displayName,
          image: k.profileImageUrl,
          live: k.isLive,
          viewers: k.viewerCount,
        })),
      ],
      query,
    ),
  };
}
export function rankChannels(items: MobileChannel[], query: string) {
  return [...items].sort(
    (a, b) =>
      (b.followers ?? b.viewers) - (a.followers ?? a.viewers) ||
      Number(
        b.key.replace(/^kick:/, "").toLowerCase() === query.toLowerCase(),
      ) -
        Number(
          a.key.replace(/^kick:/, "").toLowerCase() === query.toLowerCase(),
        ) ||
      a.name.localeCompare(b.name),
  );
}
export async function searchStreams(
  query: string,
  cursor?: string,
): Promise<MobilePage<MobileChannel>> {
  const d = await mobileGql(
    `query Search($q:String!,$after:Cursor) { searchStreams(userQuery:$q,first:30,after:$after) { edges { cursor node { ${streamFields} } } pageInfo { hasNextPage } } }`,
    { q: query, after: cursor ?? null },
  );
  const p = edges(d.searchStreams, stream);
  const k = cursor ? [] : await discoverKick.search(query).catch(() => []);
  const live = await Promise.all(
    k
      .filter((c) => c.isLive)
      .slice(0, 15)
      .map((c) => discoverKick.getChannel(c.slug).catch(() => null)),
  );
  return {
    ...p,
    items: [
      ...p.items.map(mapStream),
      ...live.flatMap((c) =>
        c
          ? [
              {
                key: `kick:${c.slug}`,
                name: c.displayName,
                image: c.profileImageUrl,
                thumbnail: c.thumbnailUrl,
                title: c.title,
                category: c.category,
                live: true,
                viewers: c.viewerCount,
              },
            ]
          : [],
      ),
    ].sort((a, b) => b.viewers - a.viewers),
  };
}
export async function searchVideos(
  query: string,
  cursor?: string,
): Promise<MobilePage<Vod>> {
  const d = await mobileGql(
    'query Search($q:String!,$after:String) { searchFor(userQuery:$q,platform:"",target:{cursor:$after,index:VOD,limit:30}) { videos { cursor items { id title createdAt lengthSeconds previewThumbnailURL viewCount broadcastType owner { id login displayName } } pageInfo { hasNextPage } } } }',
    { q: query, after: cursor ?? null },
  );
  const p = z
    .object({
      videos: z.object({
        cursor: z.string().nullish(),
        items: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            createdAt: z.string(),
            lengthSeconds: z.number(),
            previewThumbnailURL: z.string().nullish(),
            viewCount: z.number(),
            broadcastType: z.string(),
            owner: z.object({
              id: z.string(),
              login: z.string(),
              displayName: z.string(),
            }),
          }),
        ),
        pageInfo: z.object({ hasNextPage: z.boolean() }),
      }),
    })
    .parse(d.searchFor).videos;
  return {
    items: p.items.map((v) => ({
      id: v.id,
      channel: v.owner.login,
      broadcasterId: v.owner.id,
      displayName: v.owner.displayName,
      title: v.title,
      thumbnail: thumbnail(v.previewThumbnailURL ?? ""),
      duration: v.lengthSeconds,
      views: v.viewCount,
      type: v.broadcastType,
      createdAt: v.createdAt,
    })),
    cursor: p.pageInfo.hasNextPage ? (p.cursor ?? undefined) : undefined,
  };
}
