import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Add 5% to the natural row height after the cover column and text have laid out. */
export function AndroidGameCard({
  provider,
  image,
  onClick,
  children,
}: {
  provider: "twitch" | "kick";
  image?: string;
  onClick(): void;
  children: ReactNode;
}) {
  const card = useRef<HTMLButtonElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const artwork = useRef<HTMLSpanElement>(null);
  const showImage = Boolean(image);
  useLayoutEffect(() => {
    const button = card.current;
    const text = copy.current;
    if (!button || !text) return;
    const measure = () => {
      if (!button.clientWidth) return;
      const top = button.getBoundingClientRect().top;
      const row = [...(button.parentElement?.children ?? [])].filter(
        (node): node is HTMLButtonElement =>
          node instanceof HTMLButtonElement &&
          node.classList.contains("mobile-game") &&
          Math.abs(node.getBoundingClientRect().top - top) < 0.5,
      );
      // Grid cards share the tallest natural height in their row. Measure only
      // content/74px slot, so remeasurement never scales an already-scaled height.
      const baseline = Math.max(
        ...row.map((node) => {
          const style = getComputedStyle(node);
          const natural =
            Math.max(
              node.querySelector("div")?.getBoundingClientRect().height ?? 0,
              node
                .querySelector(".mobile-game-art-slot")
                ?.getBoundingClientRect().height ?? 0,
            ) +
            parseFloat(style.paddingTop) +
            parseFloat(style.paddingBottom) +
            parseFloat(style.borderTopWidth) +
            parseFloat(style.borderBottomWidth);
          return Math.max(natural, parseFloat(style.minHeight) || 0);
        }),
      );
      const height = `${baseline * 1.05}px`;
      for (const node of row) {
        if (node.style.getPropertyValue("--game-card-height") !== height)
          node.style.setProperty("--game-card-height", height);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    if (artwork.current) observer.observe(artwork.current);
    measure();
    return () => observer.disconnect();
  }, [showImage, children]);
  return (
    <button
      className={`mobile-game ${provider}`}
      type="button"
      onClick={onClick}
      ref={card}
    >
      {showImage && (
        <span className="mobile-game-art-slot" ref={artwork} aria-hidden="true">
          <img src={image} alt="" />
        </span>
      )}
      <div ref={copy}>{children}</div>
    </button>
  );
}
