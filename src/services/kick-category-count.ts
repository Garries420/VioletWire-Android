import { z } from "zod";

export interface KickCategoryCount { value: number; atLeast: boolean; }
const pageSchema = z.object({ data: z.object({
  livestreams: z.array(z.object({ channel: z.object({ id: z.union([z.string(), z.number()]).nullish(), slug: z.string().nullish() }) })),
  pagination: z.object({ next_cursor: z.string().nullish() }).nullish(),
}) });

/** Count unique live channels in a bounded directory snapshot, without blocking cards. */
export class KickCategoryCounts {
  private cache = new Map<string, { at: number; count: KickCategoryCount }>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private page: (id: string, cursor: string | undefined, signal: AbortSignal) => Promise<unknown>) {}
  private async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const enter = () => { signal.removeEventListener("abort", abort); this.active++; resolve(); };
      const abort = () => { this.waiting = this.waiting.filter(entry => entry !== enter); reject(signal.reason); };
      if (this.active < 2) enter();
      else { this.waiting.push(enter); signal.addEventListener("abort", abort, { once: true }); }
    });
    return () => { this.active--; this.waiting.shift()?.(); };
  }
  async get(id: string, signal: AbortSignal): Promise<KickCategoryCount> {
    signal.throwIfAborted();
    const previous = this.cache.get(id);
    if (previous && Date.now() - previous.at < 180_000) return previous.count;
    const release = await this.acquire(signal);
    try {
      signal.throwIfAborted();
      const channels = new Set<string>(), cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        signal.throwIfAborted();
        const data = pageSchema.parse(await this.page(id, cursor, signal)).data;
        signal.throwIfAborted();
        for (const stream of data.livestreams) {
          const key = stream.channel.id != null ? String(stream.channel.id) : stream.channel.slug;
          if (!key) throw new Error("Kick omitted a live channel identity.");
          channels.add(key);
        }
        const next = data.pagination?.next_cursor;
        const complete = !next;
        if (complete || !data.livestreams.length || cursors.has(next) || page === 19) {
          const count = { value: channels.size, atLeast: !complete };
          this.cache.delete(id); this.cache.set(id, { at: Date.now(), count });
          if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
          return count;
        }
        cursors.add(next); cursor = next;
      }
      throw new Error("Kick category count did not finish.");
    } finally { release(); }
  }
}
