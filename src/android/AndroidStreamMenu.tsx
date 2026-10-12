import { MoreVertical } from "lucide-react";
import { useEffect, useState } from "react";

/** The same actions remain available when an offline channel has no video surface. */
export function AndroidStreamMenu({chatVisible}: {chatVisible: boolean}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const back = (event: Event) => { event.preventDefault(); setOpen(false); };
    window.addEventListener("android-back", back, true);
    return () => window.removeEventListener("android-back", back, true);
  }, [open]);
  return <div className="android-stream-menu-anchor">
    <button type="button" aria-label="More stream options" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}><MoreVertical /></button>
    {open && <>
      <button className="android-stream-menu-dismiss" aria-label="Close stream options" type="button" onClick={() => setOpen(false)} />
      <div className="android-stream-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setOpen(false); window.dispatchEvent(new Event("android-stream-chat-toggle")); }}>{chatVisible ? "Remove chat" : "Open chat"}</button>
        <button type="button" role="menuitem" onClick={() => { setOpen(false); window.dispatchEvent(new Event("android-stream-viewers")); }}>Viewers list</button>
      </div>
    </>}
  </div>;
}
