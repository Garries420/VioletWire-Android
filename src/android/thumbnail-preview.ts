/** Twitch CDN resolutions can contain frames from different cache generations. */
export async function newestTwitchPreview(channel: string, original: string | undefined, request: typeof fetch): Promise<string | undefined> {
  if (!/^[a-z0-9_]{1,25}$/i.test(channel)) return original;
  const base = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel.toLowerCase()}`;
  const candidates = [`${base}-640x360.jpg`, `${base}-320x180.jpg`, `${base}-1920x1080.jpg`];
  const inspect = async (url: string) => {
    try {
      const response = await request(`${url}?vw=${Math.floor(Date.now() / 10000)}`, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const raw = response.headers.get("age");
      return { url, age: raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : Number.POSITIVE_INFINITY };
    } catch { return null; }
  };
  const standard = await inspect(candidates[0]);
  if (standard && standard.age <= 20) return standard.url;
  const variants = await Promise.all(candidates.slice(1).map(inspect));
  const available = [standard, ...variants].filter((value): value is { url: string; age: number } => value !== null);
  // Prefer the compact normal preview when generations are equally fresh.
  available.sort((a, b) => a.age - b.age);
  return available[0]?.url ?? original;
}
