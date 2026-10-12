import type { EmotePreviewPosition } from "./EmotePreview";

export function emotePreviewPosition(host: HTMLElement): EmotePreviewPosition {
  const bounds = host.getBoundingClientRect();
  const view = host.ownerDocument.defaultView ?? window;
  const above = bounds.top >= 155;
  const halfWidth = Math.min(140, (view.innerWidth - 16) / 2);
  const renderedHeight =
    host.querySelector("img")?.getBoundingClientRect().height ?? 27;
  return {
    above,
    left: Math.min(
      Math.max(bounds.left + bounds.width / 2, halfWidth + 8),
      view.innerWidth - halfWidth - 8,
    ),
    top: above ? bounds.top - 8 : bounds.bottom + 8,
    imageHeight: Math.min(150, Math.round(renderedHeight * 2.2)),
    root: host.ownerDocument,
  };
}
