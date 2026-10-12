export interface FloatingBounds {
  left: number;
  top: number;
  width: number;
}
export function fitFloating(
  bounds: FloatingBounds,
  viewport: { width: number; height: number },
): FloatingBounds {
  const width = Math.min(
    Math.max(160, bounds.width),
    Math.max(100, viewport.width - 16),
    Math.max(100, ((viewport.height - 88) * 16) / 9),
  );
  return {
    width,
    left: Math.max(8, Math.min(viewport.width - width - 8, bounds.left)),
    top: Math.max(
      8,
      Math.min(viewport.height - (width * 9) / 16 - 80, bounds.top),
    ),
  };
}
