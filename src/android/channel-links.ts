import { channelKeySchema, parseChannelKey } from "../shared/platform";

export function profileUrl(channel: string): string {
  const target = parseChannelKey(channelKeySchema.parse(channel));
  const login = encodeURIComponent(target.login);
  return target.platform === "kick" ? `https://kick.com/${login}` : `https://www.twitch.tv/${login}/about`;
}
export function subscriptionUrl(channel: string): string {
  const target = parseChannelKey(channelKeySchema.parse(channel));
  const login = encodeURIComponent(target.login);
  return target.platform === "kick" ? `https://kick.com/${login}/subscribe` : `https://subs.twitch.tv/${login}`;
}
