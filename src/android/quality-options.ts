import type { NativeQuality } from "../shared/player";

/** Useful before a channel is open, plus any extra resolutions its playlist offers. */
export function defaultQualityOptions(available: NativeQuality[] = []): NativeQuality[] {
  const resolutions = new Set([
    "1440p60", "1440p", "1080p60", "1080p", "720p60", "720p", "480p", "360p", "160p",
    ...available.map(item => item.value).filter(value => /^\d{2,4}p(?:\d{2,3})?$/.test(value)),
  ]);
  return [
    { value: "best", label: "Auto" },
    ...[...resolutions].sort((a, b) => {
      const [ah, af = 0] = a.split("p").map(Number);
      const [bh, bf = 0] = b.split("p").map(Number);
      return bh - ah || bf - af;
    }).map(value => ({ value, label: value })),
    { value: "audio_only", label: "Audio only" },
    { value: "chat_only", label: "Chat only" },
  ];
}
