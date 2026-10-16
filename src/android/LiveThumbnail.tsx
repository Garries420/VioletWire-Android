import { useEffect, useRef, useState } from "react";
import { newestTwitchPreview } from "./thumbnail-preview";
import { nativeFetch } from "./native";
import { discoverKick } from "./platform";
/** Preload into a separate image and replace only on success; failed CDN refreshes
 * leave the previous frame visible. Offscreen cards do no work; data saver
 * retains text metadata updates without downloading preview images. */
export function LiveThumbnail({ channel, src, onMetadata, noImage = false }: { channel: string; src?: string; noImage?: boolean; onMetadata?: (value: { startedAt?: string; tags?: string[] }) => void }) {
  const metadata = useRef(onMetadata); metadata.current = onMetadata;
  const host = useRef<HTMLSpanElement>(null);
  const [displayed, setDisplayed] = useState(src);
  useEffect(() => {
    let active = true, visible = false, pending = false;
    const refresh = async () => {
      if (!active || !visible || document.hidden || pending || (noImage && !channel.startsWith("kick:"))) return;
      pending = true;
      try {
        let url = src;
        if (channel.startsWith("kick:")) {
          const details = await discoverKick.getLivestream(channel.slice(5));
          if (!active || !visible) return;
          if (details) { url = details.thumbnailUrl ?? url; metadata.current?.({ startedAt: details.startedAt, tags: details.tags }); }
        }
        else url = await newestTwitchPreview(channel, url, nativeFetch);
        if (!active || !visible || noImage) return;
        if (url) {
          const fresh = new URL(url);
          const signed = [...fresh.searchParams.keys()].some(key => /signature|^policy$|^expires$|^x-amz-/i.test(key));
          if (!signed) fresh.searchParams.set("vw", String(Date.now()));
          url = fresh.href;
        }
        if (!url) return;
        const image = new Image(); image.src = url;
        await image.decode();
        if (active && visible) setDisplayed(url);
      } catch { /* Preserve the last successfully decoded thumbnail. */ }
      finally { pending = false; }
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible) void refresh();
    });
    if (host.current) observer.observe(host.current);
    const force = () => void refresh();
    window.addEventListener("android-refresh-thumbnails", force);
    const timer = setInterval(force, 10000);
    return () => { active = false; observer.disconnect(); clearInterval(timer); window.removeEventListener("android-refresh-thumbnails", force); };
  }, [channel, src, noImage]);
  return <span className="live-thumbnail" ref={host}>{displayed && !noImage && <img src={displayed} alt="" />}</span>;
}
