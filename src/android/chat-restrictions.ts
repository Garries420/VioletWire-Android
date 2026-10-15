import type { ChatRestrictions } from "../shared/chat";

export function chatRestrictionParts(restrictions: ChatRestrictions, following: boolean | null, subscribed: boolean,
  duration: (minutes: number) => string) {
  const parts: { key: string; text: string }[] = [];
  if (restrictions.followersOnly && following !== true) {
    const minutes = restrictions.followersMinMinutes;
    parts.push({ key: "followers", text: minutes && minutes > 0
      ? `Followers-only · follow for ${duration(minutes)} to chat` : "Followers-only chat" });
  }
  if (restrictions.subscribersOnly && !subscribed) parts.push({ key: "subscribers", text: "Subscribers-only chat" });
  if (restrictions.emoteOnly) parts.push({ key: "emotes", text: "Emote-only chat" });
  if (restrictions.slowModeSeconds) parts.push({ key: "slow", text: `Slow mode · ${restrictions.slowModeSeconds}s between messages` });
  return parts;
}
