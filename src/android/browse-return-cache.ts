export const BROWSE_RETURN_TTL_MS = 5 * 60 * 1000;

/** In-memory list snapshots only; never persists a stale directory across app launches. */
export class BrowseReturnCache<T> {
  private entries = new Map<string, { data: T; scrollTop: number; expiresAt: number }>();
  constructor(private readonly now = Date.now) {}
  remember(key: string, data: T, scrollTop: number) {
    const expiresAt = this.entries.get(key)?.expiresAt ?? this.now() + BROWSE_RETURN_TTL_MS;
    this.entries.delete(key);
    this.entries.set(key, { data, scrollTop, expiresAt });
    if (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!);
  }
  setScroll(key: string, scrollTop: number) {
    const entry = this.entries.get(key);
    if (entry) entry.scrollTop = scrollTop;
  }
  enterStream() {
    const expiresAt = this.now() + BROWSE_RETURN_TTL_MS;
    for (const entry of this.entries.values()) entry.expiresAt = expiresAt;
  }
  restore(key: string) {
    const entry = this.entries.get(key);
    if (entry && this.now() < entry.expiresAt) return entry;
    this.entries.delete(key);
    return undefined;
  }
}
