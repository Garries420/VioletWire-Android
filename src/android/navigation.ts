export interface FocusRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Direction = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** Rank candidates by forward distance plus lateral distance, in viewport coordinates. */
export function focusScore(
  origin: FocusRect,
  candidate: FocusRect,
  direction: Direction,
): number {
  const dx = candidate.x + candidate.width / 2 - origin.x - origin.width / 2;
  const dy = candidate.y + candidate.height / 2 - origin.y - origin.height / 2;
  const vertical = direction === "ArrowUp" || direction === "ArrowDown";
  const forward =
    (vertical ? dy : dx) *
    (direction === "ArrowUp" || direction === "ArrowLeft" ? -1 : 1);
  if (forward < 1) return Infinity;
  const lateral = Math.abs(vertical ? dx : dy);
  return forward + lateral * 2 + (lateral * lateral) / forward;
}

const focusable =
  'button, a[href], input, textarea, select, summary, [tabindex="0"], [contenteditable="true"]';
export function installDpadNavigation(): void {
  document.addEventListener(
    "keydown",
    (event) => {
      if (!document.documentElement.classList.contains("android-tv")) return;
      const origin = document.activeElement;
      // Left/right edits single-line text and sliders; up/down leaves the field
      // so a remote can reach the rest of the screen without a physical Tab key.
      if (
        origin instanceof HTMLElement &&
        (origin.matches('textarea, select, [contenteditable="true"]') ||
          (origin.matches("input") &&
            !["ArrowUp", "ArrowDown"].includes(event.key))) &&
        event.key !== "Escape"
      )
        return;
      if (
        event.key === "Enter" &&
        origin instanceof HTMLElement &&
        !origin.matches("button, a, summary")
      ) {
        event.preventDefault();
        origin.click();
        return;
      }
      if (
        !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      )
        return;
      const dialogs = [
        ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ];
      const scope = dialogs.at(-1) ?? document;
      const candidates = [
        ...scope.querySelectorAll<HTMLElement>(focusable),
      ].filter(
        (node) =>
          !node.matches(":disabled") &&
          node.tabIndex >= 0 &&
          node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility !== "hidden" &&
          !node.closest('[inert], [aria-hidden="true"]'),
      );
      if (!candidates.length) return;
      const current =
        origin instanceof HTMLElement ? origin.getBoundingClientRect() : null;
      const direction = event.key as Direction;
      const target =
        !current || !candidates.includes(origin as HTMLElement)
          ? candidates[0]
          : candidates
              .filter((node) => node !== origin)
              .map((node) => ({
                node,
                score: focusScore(
                  current,
                  node.getBoundingClientRect(),
                  direction,
                ),
              }))
              .filter((value) => Number.isFinite(value.score))
              .sort((a, b) => a.score - b.score)[0]?.node;
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        target.focus();
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    },
    true,
  );
}
