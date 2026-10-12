import { createPortal } from "react-dom";
import type { EmoteProvider } from "../../shared/emotes";
import { ProviderLogo, type ProviderLogoName } from "./ProviderLogo";

export type PreviewProvider = EmoteProvider | "twitch" | "kick";
export interface EmotePreviewPosition {
  above: boolean;
  left: number;
  top: number;
  imageHeight: number;
  root: Document;
}
const labels: Record<PreviewProvider, string> = {
  "7tv": "7TV",
  ffz: "FrankerFaceZ",
  bttv: "BetterTTV",
  twitch: "Twitch",
  kick: "Kick",
};
/** Shared by chat and the Android picker: one preview, with the same artwork and provider label. */
export function EmotePreview({
  position,
  imageUrl,
  name,
  provider,
}: {
  position: EmotePreviewPosition;
  imageUrl: string;
  name: string;
  provider: PreviewProvider;
}) {
  return createPortal(
    <span
      className={`chat-emote-tooltip ${position.above ? "above" : "below"}`}
      role="tooltip"
      style={{
        left: position.left,
        top: position.top,
        width: "min(280px, calc(100vw - 16px))",
        maxWidth: "calc(100vw - 16px)",
      }}
    >
      <img
        alt=""
        decoding="async"
        src={imageUrl}
        style={{ height: position.imageHeight }}
      />
      <strong aria-label={name} title={name}>
        {name.split("").map((character, index) => (
          <span key={index}>
            {character}
            {index < name.length - 1 && "\u00ad"}
          </span>
        ))}
      </strong>
      <span>
        <ProviderLogo name={provider as ProviderLogoName} />
        {labels[provider]}
      </span>
    </span>,
    position.root.body,
  );
}
