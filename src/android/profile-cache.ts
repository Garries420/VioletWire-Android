import type { VodProfile } from "./vod-service";

/** Short-lived public profile data; no credentials, persisted storage, or account state. */
export class ProfileCache {
  private items = new Map<string, { profile: VodProfile; expires: number }>();
  private pending = new Map<string, Promise<VodProfile>>();
  private generation = 0;
  constructor(private now = Date.now) {}
  peek(key: string): VodProfile | undefined {
    return this.items.get(key)?.profile;
  }
  clear() {
    this.generation++;
    this.items.clear();
    this.pending.clear();
  }
  load(key: string, fetcher: () => Promise<VodProfile>): Promise<VodProfile> {
    const cached = this.items.get(key);
    if (cached && cached.expires > this.now())
      return Promise.resolve(cached.profile);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const request = fetcher()
      .then((profile) => {
        if (generation === this.generation) {
          this.items.delete(key);
          this.items.set(key, { profile, expires: this.now() + 60000 });
          if (this.items.size > 20)
            this.items.delete(this.items.keys().next().value!);
        }
        return profile;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }
}
export const profiles = new ProfileCache();
