/** Dimensions describe the asset at 1x, independently of the downloaded image resolution. */
export function emoteGridLayout(
  width: number,
  height: number,
  provider: string,
  columns: number,
  availableWidth = Math.max(1, columns) * 46 - 2,
) {
  const baseline = provider === "bttv" ? 28 : 32;
  const cols = Math.max(1, columns);
  const logicalWidth = Number.isFinite(width) && width > 0 ? width : baseline;
  const logicalHeight =
    Number.isFinite(height) && height > 0 ? height : baseline;
  // Uniform scaling only. Oversized assets fit the available grid without being squashed.
  const scale = Math.min(
    32 / baseline,
    (availableWidth - 10) / logicalWidth,
    96 / logicalHeight,
  );
  const displayWidth = logicalWidth * scale,
    displayHeight = logicalHeight * scale;
  const columnWidth = (availableWidth - (cols - 1) * 2) / cols;
  return {
    width: displayWidth,
    height: displayHeight,
    columnSpan: Math.min(
      cols,
      Math.max(1, Math.ceil((displayWidth + 12) / (columnWidth + 2))),
    ),
    rowSpan: Math.max(1, Math.ceil((displayHeight + 12) / 46)),
  };
}
