import { z } from "zod";

const viewerSchema = z.object({
  following_since: z.string().nullable().optional(),
  is_following: z.boolean().optional(),
  subscription: z.object({ expires_at: z.string().nullish() }).nullable().optional(),
});

/** Kick's authenticated /me response describes this viewer, not the broadcaster. */
export function kickViewerState(raw: unknown, now = Date.now()): { following?: boolean; subscribed?: boolean } {
  const viewer = viewerSchema.parse(raw);
  const following = viewer.is_following ?? (viewer.following_since === undefined ? undefined : Boolean(viewer.following_since));
  let subscribed: boolean | undefined;
  if (viewer.subscription === null) subscribed = false;
  else if (viewer.subscription) {
    const expiry = viewer.subscription.expires_at;
    // Legacy Kick timestamps without a zone are UTC; preserve explicit offsets.
    const normalized = expiry && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(expiry)
      ? expiry.replace(" ", "T") + "Z" : expiry;
    const expiresAt = normalized == null ? undefined : Date.parse(normalized);
    subscribed = expiresAt === undefined ? true : Number.isFinite(expiresAt) ? expiresAt > now : undefined;
  }
  return { following, subscribed };
}
