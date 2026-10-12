export const RECENT_EMOTE_LIMIT = 60;

export function normalizeRecentEmotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key): key is string =>
    typeof key === "string" && /^(twitch|kick|7tv|bttv|ffz):[^\s:]{1,120}$/.test(key),
  ))].slice(0, RECENT_EMOTE_LIMIT);
}

export function rememberRecentEmote(recent: string[], key: string): string[] {
  return normalizeRecentEmotes([key, ...recent.filter((item) => item !== key)]);
}

export function createRecentEmoteStore(storage: {
  read(): Promise<unknown>;
  write(keys: string[]): Promise<void>;
}) {
  let keys: string[] = [];
  let loaded: Promise<string[]> | undefined;
  let queue = Promise.resolve();
  const listeners = new Set<(keys: string[]) => void>();
  const load = async () => {
    loaded ??= storage.read().then((value) => {
      keys = normalizeRecentEmotes(value);
      return keys;
    }).catch(() => keys);
    await loaded;
    return [...keys];
  };
  return {
    load,
    subscribe(listener: (keys: string[]) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    remember(key: string) {
      queue = queue.catch(() => undefined).then(async () => {
        await load();
        keys = rememberRecentEmote(keys, key);
        listeners.forEach((listener) => listener([...keys]));
        await storage.write(keys);
      });
      return queue;
    },
  };
}

export function usedEmoteKeys(message: string, available: { key: string; name: string }[]): string[] {
  const byName = new Map(available.map((emote) => [emote.name, emote.key]));
  return message.split(/\s+/).flatMap((name) => { const key = byName.get(name); return key ? [key] : []; });
}
