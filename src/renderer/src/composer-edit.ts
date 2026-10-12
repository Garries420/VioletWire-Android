/** Backspace at a logical text caret, treating rendered emote codes as indivisible units. */
export function deleteComposerBackward(
  value: string,
  emoteNames: Iterable<string>,
  caret = value.length,
) {
  const end = Math.max(0, Math.min(value.length, caret));
  if (!end) return { value, caret: 0 };
  const before = value.slice(0, end),
    trimmed = before.trimEnd();
  const token = /(?:^|\s)(\S+)$/.exec(trimmed)?.[1];
  let start: number;
  if (token && new Set(emoteNames).has(token))
    start = trimmed.length - token.length;
  else {
    const segments =
      typeof Intl.Segmenter === "function"
        ? [
            ...new Intl.Segmenter(undefined, {
              granularity: "grapheme",
            }).segment(before),
          ].map((part) => part.index)
        : Array.from(before).map(
            (_, i, parts) => parts.slice(0, i).join("").length,
          );
    start = segments.at(-1) ?? 0;
  }
  return { value: value.slice(0, start) + value.slice(end), caret: start };
}
