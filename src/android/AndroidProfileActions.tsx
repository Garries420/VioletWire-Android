import { useEffect, useState, type ReactNode } from "react";
import { Heart, Star } from "lucide-react";

export function AndroidProfileActions({ channel, name, children }: {
  channel: string; name: string; children: ReactNode;
}) {
  const [following, setFollowing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const kick = channel.startsWith("kick:");
  useEffect(() => {
    let cancelled = false;
    if (kick) void window.desktop.kick.getChannel(channel.slice(5)).then(value => {
      if (!cancelled) setFollowing(value?.following === true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [channel, kick]);
  const act = async (subscribe: boolean) => {
    if (pending) return;
    setPending(true); setError("");
    try {
      if (subscribe) await window.desktop.player.openSubscription(channel, `${name} Subscription`);
      else if (!kick) await window.desktop.player.openChannelAction(channel, "channel");
      else {
        if (!await window.desktop.kick.getUser()) throw new Error("Sign in to Kick from Settings to follow channels.");
        await window.desktop.kick.setFollowing(channel.slice(5), true);
        setFollowing(true);
        window.dispatchEvent(new Event("android-stream-refresh"));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open this channel action.");
    } finally { setPending(false); }
  };
  return <>
    <div className="android-profile-actions">
      {children}
      <button disabled={pending || following} onClick={() => void act(false)}>
        <Heart size={16} fill={following ? "currentColor" : "none"} /> {following ? "Following" : "Follow"}
      </button>
      <button disabled={pending} onClick={() => void act(true)}><Star size={16} /> Subscribe</button>
    </div>
    {error && <p role="alert" className="android-library-error">{error}</p>}
  </>;
}
