import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, RefreshCw, X } from "lucide-react";
import { channelPoints, getFullscreen, setFullscreen } from "./platform";
import { VioletNative } from "./native";
import { rewardUnavailable, type PointsContext, type PointsReward } from "./channel-points";
export function ChannelPointsIcon() { return <span className="channel-points-icon" aria-hidden="true" />; }
const automaticNames: Record<string, string> = {
  SEND_HIGHLIGHTED_MESSAGE: "Highlight My Message", RANDOM_SUB_EMOTE_UNLOCK: "Unlock a Random Emote",
  CHOSEN_SUB_EMOTE_UNLOCK: "Choose an Emote to Unlock", CHOSEN_MODIFIED_SUB_EMOTE_UNLOCK: "Modify an Emote",
  SINGLE_MESSAGE_BYPASS_SUB_MODE: "Send a Message in Subscriber-only Chat", CELEBRATION: "Celebration",
};
export function AndroidChannelPoints({ channel, onClose }: { channel: string; onClose: () => void }) {
  const [context, setContext] = useState<PointsContext | null>(null);
  const [selected, setSelected] = useState<PointsReward | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [top, setTop] = useState(0);
  const mounted = useRef(true), pending = useRef(false);
  const sheet = useRef<HTMLElement>(null);
  const load = async () => {
    setLoading(true); setError("");
    try { const value = await channelPoints.load(channel); if (mounted.current) setContext(value); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    const fullscreen = getFullscreen();
    const presentation = setFullscreen(false).then(() => VioletNative.rewardPresentation({ active: true }));
    void presentation.catch(e => { if (mounted.current) setError(String(e)); });
    void load();
    return () => {
      mounted.current = false;
      void presentation.finally(async () => {
        await VioletNative.rewardPresentation({ active: false });
        await setFullscreen(fullscreen);
      }).catch(() => undefined);
    };
    // A channel-keyed component owns this one presentation and request lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const box = document.querySelector(".player-host.hls-surface-host")?.getBoundingClientRect();
      const next = box && box.height > 1 ? Math.max(0, Math.ceil(box.bottom)) : 0;
      setTop(previous => previous === next ? previous : next);
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const back = (event: Event) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (pending.current) return;
      if (selected) { setSelected(null); setError(""); setText(""); }
      else onClose();
    };
    window.addEventListener("android-back", back, true);
    return () => window.removeEventListener("android-back", back, true);
  }, [selected, onClose]);
  const spend = async () => {
    if (!selected || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      await channelPoints.redeem(channel, selected, text);
      if (mounted.current) onClose();
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const close = () => { if (!pending.current) onClose(); };
  const unavailable = selected ? rewardUnavailable(selected, context?.balance ?? null) : undefined;
  return createPortal(<div className="android-points-overlay">
    <section role="dialog" aria-modal="true" aria-label="Channel points rewards" className="android-points-sheet" ref={sheet} style={{ top }}>
      <header>
        {selected && <button aria-label="Back to rewards" type="button" disabled={busy} onClick={() => { setSelected(null); setText(""); setError(""); }}><ArrowLeft /></button>}
        <strong>{selected?.title ?? (selected?.type ? automaticNames[selected.type] ?? "Twitch reward" : "Channel Points & Rewards")}</strong>
        {!selected && <button aria-label="Refresh rewards" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={19} /></button>}
        <button aria-label="Close channel points" type="button" disabled={busy} onClick={close}><X /></button>
      </header>
      <div className="android-points-scroll">
        {error && <p role="alert" className="android-points-error">{error}</p>}
        {loading && !context && <p role="status">Loading channel points…</p>}
        {!loading && !context && <button className="primary-button" onClick={() => void load()} type="button">Try again</button>}
        {context && !context.enabled && <p>This channel has not enabled channel points.</p>}
        {context?.enabled && context.balance === null && <div className="android-points-connect"><p>Link your Twitch website session in Accounts to earn and spend channel points.</p><button className="primary-button" type="button" onClick={() => { close(); window.dispatchEvent(new CustomEvent("android-open-settings", { detail: { section: "account" } })); }}>Open Accounts</button></div>}
        {selected ? <form onSubmit={event => { event.preventDefault(); void spend(); }}>
          <div className="android-points-reward-detail" style={{ backgroundColor: selected.backgroundColor || "#60349a" }}>
            {(selected.image?.url2x ?? selected.image?.url ?? selected.defaultImage?.url) && <img alt="" src={selected.image?.url2x ?? selected.image?.url ?? selected.defaultImage?.url} />}
            <strong><ChannelPointsIcon /> {selected.cost.toLocaleString()}</strong>
          </div>
          {selected.prompt && <p className="android-points-prompt">{selected.prompt}</p>}
          {selected.isSubOnly && <p>Subscriber-only reward. Twitch checks your subscription when you redeem.</p>}
          {selected.isUserInputRequired && <label className="android-points-input">Your message<textarea aria-label="Reward message" maxLength={500} value={text} onChange={event => setText(event.target.value)} placeholder="Send a message" disabled={busy} /><small>{text.length}/500</small></label>}
          {unavailable && <p className="android-points-reason">{unavailable}</p>}
          {selected.automatic ? <><p>Use Twitch's reward controls to choose emotes, apply modifications, or send a highlighted message. Your stream keeps playing.</p><button className="primary-button" type="button" disabled={busy || !!unavailable} onClick={() => { void VioletNative.rewardWebsite({ channel }).catch(e => setError(String(e))); }}>Open Twitch reward controls</button></> :
            <button className="primary-button android-points-redeem" type="submit" disabled={busy || !!unavailable || (!!selected.isUserInputRequired && !text.trim())}>{busy ? "Redeeming…" : `Redeem · ${selected.cost.toLocaleString()}`}</button>}
        </form> : <div className="android-points-grid">
          {context?.enabled && context.rewards.map(reward => <button key={reward.id} type="button" onClick={() => { setSelected(reward); setText(""); setError(""); }}>
            <span className="android-points-tile" style={{ backgroundColor: reward.backgroundColor || "#60349a" }}>
              {(reward.image?.url2x ?? reward.image?.url ?? reward.defaultImage?.url) && <img alt="" src={reward.image?.url2x ?? reward.image?.url ?? reward.defaultImage?.url} />}
              <strong><ChannelPointsIcon /> {reward.cost.toLocaleString()}</strong>
            </span>
            <span>{reward.title ?? automaticNames[reward.type ?? ""] ?? "Twitch reward"}</span>
            {(reward.isPaused || !reward.isInStock) && <small>{reward.isPaused ? "Paused" : "Out of stock"}</small>}
          </button>)}
          {context?.enabled && !context.rewards.length && <p>No channel point rewards are currently available.</p>}
        </div>}
      </div>
      {context?.enabled && <footer>{context.image ? <img alt="" src={context.image} /> : <ChannelPointsIcon />}<strong>{context.balance === null ? "—" : context.balance.toLocaleString()}</strong><span>{context.name}</span></footer>}
    </section>
  </div>, document.body);
}
