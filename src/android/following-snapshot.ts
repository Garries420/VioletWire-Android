import { Preferences } from "@capacitor/preferences";
import { z } from "zod";
import type { MobileChannel } from "./mobile-discovery";
const entry = z.object({ key: z.string(), name: z.string(), image: z.string(), thumbnail: z.string().optional(),
  title: z.string().optional(), category: z.string().optional(), live: z.boolean(), viewers: z.number(),
  startedAt: z.string().optional(), tags: z.array(z.string()).optional() });
const snapshot = z.object({ savedAt: z.number(), channels: z.array(entry).max(5000),
  accounts: z.object({ twitch: z.boolean(), kick: z.boolean(), identity: z.string().optional() }) });
let storageKey = "";
export let followingBootstrap: z.infer<typeof snapshot> | undefined;
/** Scope the last feed to the installed secure sessions without persisting their tokens. */
export async function initializeFollowingSnapshot(twitchRecord: string | null, kickRecord: string | null) {
  if (!twitchRecord && !kickRecord) return;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([twitchRecord, kickRecord])));
  storageKey = "following.snapshot." + [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
  try {
    const raw = (await Preferences.get({ key: "following.snapshot.v1" })).value;
    const data = JSON.parse(raw ?? "null");
    if (data?.key !== storageKey) return;
    const parsed = snapshot.parse(data.snapshot);
    if (Date.now() - parsed.savedAt < 24 * 60 * 60 * 1000) followingBootstrap = parsed;
  } catch { /* A damaged or older cache is simply refreshed. */ }
}
export function saveFollowingSnapshot(channels: MobileChannel[], accounts: z.infer<typeof snapshot>["accounts"]) {
  followingBootstrap = { channels, accounts, savedAt: Date.now() };
  if (storageKey) void Preferences.set({ key: "following.snapshot.v1", value: JSON.stringify({ key: storageKey, snapshot: followingBootstrap }) });
}
export function mergeFollowing(old: MobileChannel[], fresh: MobileChannel[]) {
  const next = new Map(fresh.map(channel => [channel.key, channel]));
  // Keep existing cards in place while people are reading. New live channels
  // append silently; offline channels leave the live tab without clearing it.
  return [...old.filter(channel => next.has(channel.key)).map(channel => ({ ...channel, ...next.get(channel.key),
    startedAt: next.get(channel.key)?.startedAt ?? channel.startedAt, tags: next.get(channel.key)?.tags ?? channel.tags,
    thumbnail: next.get(channel.key)?.thumbnail ?? channel.thumbnail, image: next.get(channel.key)?.image || channel.image })),
    ...fresh.filter(channel => !old.some(previous => previous.key === channel.key))];
}
