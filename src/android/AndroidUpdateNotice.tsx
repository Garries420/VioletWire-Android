import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import type { AppUpdateStatus } from "../shared/updates";

export function AndroidUpdateNotice() {
  const [status, setStatus] = useState<AppUpdateStatus>();
  const [dismissed, setDismissed] = useState<string>();
  useEffect(() => {
    void window.desktop.updates.getStatus().then(setStatus);
    return window.desktop.updates.onStatus(setStatus);
  }, []);
  if (
    status?.state !== "available" ||
    !status.releaseUrl ||
    status.availableVersion === dismissed
  )
    return null;
  return (
    <aside
      className="android-update-notice"
      role="status"
      aria-label="App update available"
    >
      <div>
        <strong>
          VioletWire Android {status.availableVersion} is available
        </strong>
        <button
          className="primary-button"
          onClick={() =>
            void window.desktop.system.openExternal(status.releaseUrl!)
          }
        >
          <ExternalLink size={16} /> View APK on GitHub
        </button>
      </div>
      <button
        aria-label="Dismiss update notification"
        onClick={() => setDismissed(status.availableVersion)}
      >
        <X size={18} />
      </button>
    </aside>
  );
}
