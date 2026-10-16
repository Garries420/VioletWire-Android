import { useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { parseChangelog } from "../shared/changelog";
import notes from "./CHANGELOG.md?raw";

const acknowledgmentKey = "acknowledgedAndroidRelease";
export function AndroidWhatsNew({ version, updated }: { version: string; updated: boolean }) {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const entry = parseChangelog(notes).find(item => item.version === version);
  useEffect(() => {
    let cancelled = false;
    void Preferences.get({ key: acknowledgmentKey }).then(async ({ value }) => {
      if (cancelled) return;
      if (updated && value !== version && entry) setVisible(true);
      else if (!updated) await Preferences.set({ key: acknowledgmentKey, value: version });
    }).catch(() => { if (!cancelled && updated && entry) setVisible(true); });
    return () => { cancelled = true; };
  }, [version, updated, !!entry]);
  useEffect(() => {
    if (!visible) return;
    const back = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") back(event); };
    window.addEventListener("android-back", back, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("android-back", back, true); window.removeEventListener("keydown", key, true); };
  }, [visible]);
  const acknowledge = async () => {
    setSaving(true); setError("");
    try { await Preferences.set({ key: acknowledgmentKey, value: version }); setVisible(false); }
    catch { setError("Could not save. Please tap OK again."); }
    finally { setSaving(false); }
  };
  if (!visible || !entry) return null;
  const groups = [["Added",entry.additions],["Replaced",entry.replaced],["Fixed",entry.fixes],["Removed",entry.removed]] as const;
  return <div className="settings-modal-backdrop android-settings-page android-whats-new">
    <section className="settings-modal-panel" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <header className="settings-modal-header"><div><span>WHAT’S NEW</span><h2 id="whats-new-title">VioletWire {version}</h2><p>Your app has been updated.</p></div></header>
      <div className="changelog-modal-content"><article className="changelog-release">
        {groups.map(([title,items]) => items?.length ? <section key={title}><h4>{title}</h4><ul>{items.map(item=><li key={item}>{item}</li>)}</ul></section> : null)}
      </article></div>
      <footer>{error && <p role="alert">{error}</p>}<button autoFocus className="primary-button" disabled={saving} onClick={()=>void acknowledge()}>{saving ? "Saving…" : "OK"}</button></footer>
    </section>
  </div>;
}
