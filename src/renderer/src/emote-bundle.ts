import type {
  EmoteProvider,
  EmoteSetResult,
  ProviderEmote,
} from "../../shared/emotes";

export interface EmoteBundle {
  maps: Map<EmoteProvider, Map<string, ProviderEmote>>;
  names: Map<EmoteProvider, Set<string>>;
}
/** Scope order, rather than network completion order, decides aliases. Channel names win. */
function bundleFrom(sets: EmoteSetResult[]): EmoteBundle {
  const maps = new Map<EmoteProvider, Map<string, ProviderEmote>>();
  const names = new Map<EmoteProvider, Set<string>>();
  for (const scope of ["global", "channel"] as const) {
    for (const set of sets.filter((item) => item.scope === scope)) {
      const emotes = maps.get(set.provider) ?? new Map<string, ProviderEmote>();
      for (const emote of set.emotes) emotes.set(emote.name, emote);
      maps.set(set.provider, emotes);
      if (scope === "channel")
        names.set(set.provider, new Set(set.emotes.map((emote) => emote.name)));
    }
  }
  return { maps, names };
}
/** Deliver ready providers without waiting for a slow/unavailable host. Never cache failures as empty sets. */
export async function collectEmoteSets(
  requests: Promise<EmoteSetResult>[],
  onProgress?: (bundle: EmoteBundle) => void,
): Promise<{ bundle: EmoteBundle; complete: boolean }> {
  const sets: EmoteSetResult[] = [];
  const results = await Promise.allSettled(
    requests.map(async (request) => {
      const set = await request;
      sets.push(set);
      onProgress?.(bundleFrom(sets));
    }),
  );
  return {
    bundle: bundleFrom(sets),
    complete: results.every((result) => result.status === "fulfilled"),
  };
}
