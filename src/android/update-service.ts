import type { AppUpdateStatus, UpdateApi } from "../shared/updates";
import { nativeFetch } from "./native";
import changelog from "./CHANGELOG.md?raw";

export const ANDROID_VERSION = "1.1";
export const RELEASE_REPOSITORY = "Garries420/VioletWire-Android";

export function numericVersion(value: string): number[] | null {
  if (!/^v?\d{1,9}(?:\.\d{1,9}){1,3}$/i.test(value)) return null;
  return value.replace(/^v/i, "").split(".").map(Number);
}
export function compareVersions(a: string, b: string): number {
  const x = numericVersion(a),
    y = numericVersion(b);
  if (!x || !y) throw new Error("Invalid release version.");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
function releaseLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(`/${RELEASE_REPOSITORY}/releases/tag/`)
    );
  } catch {
    return false;
  }
}

/** Public metadata only. APK download and installation remain with the user. */
export class AndroidUpdateService implements UpdateApi {
  private status: AppUpdateStatus = {
    state: "idle",
    currentVersion: ANDROID_VERSION,
  };
  private listeners = new Set<(status: AppUpdateStatus) => void>();
  private pending?: Promise<AppUpdateStatus>;
  constructor(private fetcher: typeof fetch = nativeFetch) {}
  getStatus = async () => ({ ...this.status });
  getReleaseNotes = async () => changelog;
  install() {
    /* Android never installs updates automatically. */
  }
  onStatus = (listener: (status: AppUpdateStatus) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(status: Omit<AppUpdateStatus, "currentVersion">) {
    this.status = { ...status, currentVersion: ANDROID_VERSION };
    for (const listener of this.listeners) listener({ ...this.status });
    return { ...this.status };
  }
  check = (): Promise<AppUpdateStatus> => {
    if (this.pending) return this.pending;
    this.publish({
      state: "checking",
      message: "Checking GitHub for APK releases…",
    });
    this.pending = this.checkReleases().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  };
  private async checkReleases(): Promise<AppUpdateStatus> {
    const signal = AbortSignal.timeout(8000);
    let newest: { version: string; url: string } | undefined;
    try {
      for (let page = 1; ; page++) {
        // Fail explicitly rather than incorrectly compare an incomplete release list.
        if (page > 10)
          throw new Error("Too many releases to check in one request.");
        const response = await this.fetcher(
          `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=100&page=${page}`,
          { headers: { Accept: "application/vnd.github+json" }, signal },
        );
        if (response.status === 404)
          return this.publish({
            state: "not-available",
            message: "No public APK releases have been published yet.",
          });
        if (!response.ok)
          throw new Error("GitHub is unavailable. Try again later.");
        const releases: unknown = await response.json();
        if (!Array.isArray(releases))
          throw new Error("GitHub returned an invalid release list.");
        for (const release of releases) {
          if (!release || typeof release !== "object") continue;
          const r = release as Record<string, unknown>;
          if (
            r.draft !== false ||
            r.prerelease !== false ||
            typeof r.tag_name !== "string" ||
            !numericVersion(r.tag_name) ||
            !releaseLink(r.html_url) ||
            !Array.isArray(r.assets)
          )
            continue;
          if (
            !r.assets.some(
              (asset: unknown) =>
                !!asset &&
                typeof asset === "object" &&
                "name" in asset &&
                typeof asset.name === "string" &&
                /\.apk$/i.test(asset.name) &&
                (!("state" in asset) || asset.state === "uploaded"),
            )
          )
            continue;
          if (!newest || compareVersions(r.tag_name, newest.version) > 0)
            newest = {
              version: r.tag_name.replace(/^v/i, ""),
              url: r.html_url,
            };
        }
        if (releases.length < 100) break;
      }
      return newest && compareVersions(newest.version, ANDROID_VERSION) > 0
        ? this.publish({
            state: "available",
            availableVersion: newest.version,
            releaseUrl: newest.url,
            message: `Version ${newest.version} is available on GitHub.`,
          })
        : this.publish({
            state: "not-available",
            message: newest
              ? "You have the latest published APK version."
              : "No public APK releases have been published yet.",
          });
    } catch (error) {
      return this.publish({
        state: "error",
        message: signal.aborted
          ? "The update check timed out. Try again later."
          : error instanceof Error
            ? error.message
            : "Could not check for updates.",
      });
    }
  }
}
