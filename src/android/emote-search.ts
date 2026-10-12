/** Matching intentionally includes beginnings, middles, and endings, without changing emote names. */
export function searchEmotes<T extends { name: string }>(
  emotes: readonly T[],
  query: string,
): T[] {
  const match = query.trim().toLowerCase();
  return emotes.filter((emote) => emote.name.toLowerCase().includes(match));
}
