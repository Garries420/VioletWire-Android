import { channelKeySchema, parseChannelKey } from "../shared/platform";
import type { KickPublicService } from "../services/kick-public-service";
import { z } from "zod";

const twitchTokenSchema = z.object({
  data: z
    .object({
      streamPlaybackAccessToken: z
        .object({ value: z.string().min(1), signature: z.string().min(1) })
        .nullable(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});
const kickPlaybackSchema = z.object({
  playback_url: z.string().url().nullish(),
  livestream: z.unknown().nullish(),
});

/** Twitch's web playback endpoint is undocumented and may change. No access restrictions are bypassed. */
export async function resolveStream(
  channel: string,
  request: typeof fetch,
  kick: KickPublicService,
  websiteToken?: string,
): Promise<string> {
  const { platform, login } = parseChannelKey(channelKeySchema.parse(channel));
  if (platform === "kick") {
    const details = await kick.getChannel(login);
    if (!details) throw new Error("Kick channel was not found.");
    if (!details.isLive) throw new Error("Stream is offline.");
    const response = await request(
      `https://kick.com/api/v2/channels/${encodeURIComponent(login)}`,
    );
    if (!response.ok)
      throw new Error(
        `Kick playback resolution was refused (${response.status}).`,
      );
    const data = kickPlaybackSchema.parse(await response.json());
    if (!data.playback_url)
      throw new Error("Kick did not return a playback URL.");
    const url = new URL(data.playback_url);
    if (url.protocol !== "https:")
      throw new Error("Kick returned an insecure playback URL.");
    return url.toString();
  }
  // Public identifier used by Twitch's web playback client, never an OAuth secret.
  const response = await request("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: {
      "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
      "Content-Type": "application/json",
      ...(websiteToken ? { Authorization: `OAuth ${websiteToken}` } : {}),
    },
    body: JSON.stringify({
      query:
        'query PlaybackAccessToken($login: String!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) { value signature } }',
      variables: { login, playerType: "site" },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Twitch playback resolution was refused (${response.status}).`,
    );
  const payload = twitchTokenSchema.parse(await response.json());
  const token = payload.data?.streamPlaybackAccessToken;
  if (!token)
    throw new Error(
      "Twitch did not authorize public playback. Restricted streams require a supported playback session.",
    );
  const params = new URLSearchParams({
    sig: token.signature,
    token: token.value,
    allow_source: "true",
    allow_audio_only: "true",
    fast_bread: "true",
    supported_codecs: "h264,h265,av1",
    p: String(Math.floor(Math.random() * 1000000)),
  });
  return `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login)}.m3u8?${params}`;
}
