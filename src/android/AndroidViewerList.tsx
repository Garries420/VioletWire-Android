import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatMessage } from "../shared/chat";
import type { ChatUserListEntry } from "../shared/chat-content";
import { loadViewerRoster, type ViewerRoster } from "./viewer-list";

export function AndroidViewerList({channel, entries, onClose, onOpenUser}: {
  channel: string; entries: ChatUserListEntry[]; onClose(): void;
  onOpenUser(message: ChatMessage, anchor: DOMRect): void;
}) {
  const [roster, setRoster] = useState<ViewerRoster | null>(null);
  const [loading, setLoading] = useState(!channel.startsWith("kick:"));
  const [limit, setLimit] = useState(100);
  useEffect(() => {
    if (channel.startsWith("kick:")) return;
    let disposed = false;
    void loadViewerRoster(channel).then((value) => { if (!disposed) setRoster(value); })
      .catch(() => undefined).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [channel]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const users = roster?.entries ?? entries;
  const displayed = users.slice(0, limit);
  return (
    <div className="android-viewer-backdrop" onClick={onClose}>
      <section className="android-viewer-list" role="dialog" aria-modal="true" aria-label="Viewers list" onClick={(event) => event.stopPropagation()}>
        <div className="android-sheet-handle" />
        <header><strong>Viewers list</strong><button type="button" aria-label="Close viewers list" autoFocus onClick={onClose}><X size={22} /></button></header>
        <p className="android-viewer-count">{roster ? `${roster.count.toLocaleString()} users in chat` : loading ? "Loading users in chat…" : "Users seen in recent chat"}</p>
        <div className="android-viewer-scroll" onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight - node.scrollTop - node.clientHeight < 80) setLimit((value) => Math.min(users.length, value + 100));
        }}>
          {([["broadcaster", "Broadcaster"], ["moderator", "Moderators"], ["vip", "VIPs"], ["chatter", "Viewers"]] as const).map(([role, title]) => {
            const section = displayed.filter((entry) => entry.role === role);
            return section.length > 0 && <section key={role}><h3>{title}</h3>{section.map(({message}) => (
              <button key={message.login} type="button" onClick={(event) => onOpenUser(message, event.currentTarget.getBoundingClientRect())}>{message.displayName || message.login}</button>
            ))}</section>;
          })}
          {!users.length && !loading && <p>No users are available yet.</p>}
          {limit < users.length && <button className="android-viewer-more" type="button" onClick={() => setLimit((value) => value + 100)}>Show more</button>}
        </div>
      </section>
    </div>
  );
}
