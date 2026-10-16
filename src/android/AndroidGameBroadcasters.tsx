import { useEffect, useRef, useState } from "react";
import { discoverKick } from "./platform";
import type { KickCategoryCount } from "../services/kick-category-count";

export function AndroidGameBroadcasters({ id, provider, value }: { id: string; provider: "twitch" | "kick"; value?: number }) {
  const element = useRef<HTMLParagraphElement>(null);
  const [count, setCount] = useState<KickCategoryCount>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setCount(undefined); setFailed(false);
    if (provider !== "kick" || value !== undefined || !element.current) return;
    let controller: AbortController | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { controller?.abort(); controller = undefined; return; }
      if (controller) return;
      const request = new AbortController(); controller = request;
      void discoverKick.getCategoryBroadcasters(id, request.signal).then(result => {
        if (!request.signal.aborted) { setCount(result); setFailed(false); }
      }).catch(() => { if (!request.signal.aborted) setFailed(true); });
    });
    observer.observe(element.current);
    return () => { observer.disconnect(); controller?.abort(); };
  }, [id, provider, value]);
  const total = value !== undefined ? { value, atLeast: false } : count;
  if (provider !== "kick" && !total) return null;
  return <p ref={element}>{total ? `${total.value.toLocaleString()}${total.atLeast ? "+" : ""} broadcasters` : failed ? "Broadcasters unavailable" : "Loading broadcasters…"}</p>;
}
