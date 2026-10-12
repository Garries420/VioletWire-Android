import { z } from "zod";
import type { ChatUserListEntry, ChatUserRole } from "../shared/chat-content";
import { mobileGql } from "./mobile-discovery";

const login = z.object({ login: z.string().regex(/^[a-z0-9_]{1,25}$/i) });
const rosterSchema = z.object({
  broadcasters: z.array(login).nullish(), moderators: z.array(login).nullish(),
  vips: z.array(login).nullish(), viewers: z.array(login).nullish(),
  count: z.number().int().nonnegative().nullish(),
});
export interface ViewerRoster { entries: ChatUserListEntry[]; count: number; }
export function parseViewerRoster(value: unknown, channel: string): ViewerRoster {
  const roster = rosterSchema.parse(value);
  const entries: ChatUserListEntry[] = [];
  const seen = new Set<string>();
  for (const [key, role] of [["broadcasters", "broadcaster"], ["moderators", "moderator"], ["vips", "vip"], ["viewers", "chatter"]] as const) {
    for (const user of roster[key] ?? []) {
      const name = user.login.toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      entries.push({ role: role as ChatUserRole, message: {
        id: `viewer-${name}`, channel, login: name, displayName: user.login, color: "",
        text: "", sentAt: 0, twitchEmotes: [], badges: role === "chatter" ? [] : [`${role}/1`],
      } });
    }
  }
  return { entries, count: roster.count ?? entries.length };
}
export async function loadViewerRoster(channel: string): Promise<ViewerRoster> {
  const result = await mobileGql(
    "query ViewerRoster($login:String!){user(login:$login){channel{chatters{count broadcasters{login} moderators{login} vips{login} viewers{login}}}}}",
    { login: channel.replace(/^twitch:/, "") },
  );
  const parsed = z.object({user:z.object({channel:z.object({chatters:z.unknown()})})}).parse(result);
  return parseViewerRoster(parsed.user.channel.chatters, channel);
}
