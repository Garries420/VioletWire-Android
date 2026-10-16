import { z } from "zod";
import type { ChatReward } from "../shared/chat";
import type { NativePlayerState } from "../shared/player";

const CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const CONTEXT_HASH = "33884dcfeab64eb44c2d61255145643cf69ea993e0c6c2ecb0fa46238586a111";
const picture = z.object({ url: z.string(), url2x: z.string().optional() }).nullish();
const rewardSchema = z.object({ id: z.string(), title: z.string().optional(), type: z.string().optional(),
  cost: z.number().nonnegative(), prompt: z.string().nullish(), image: picture, defaultImage: picture,
  backgroundColor: z.string().nullish(), pricingType: z.string().nullish(), isEnabled: z.boolean(),
  isPaused: z.boolean().optional(), isInStock: z.boolean(), isSubOnly: z.boolean().optional(),
  isHiddenForSubs: z.boolean().optional(), isUserInputRequired: z.boolean().optional(),
  cooldownExpiresAt: z.string().nullish(), redemptionsRedeemedCurrentStream: z.number().nullish(),
  maxPerStreamSetting: z.object({ isEnabled: z.boolean(), maxPerStream: z.number() }).nullish(),
});
const contextSchema = z.object({ community: z.object({ id: z.string(), channel: z.object({
  self: z.object({ communityPoints: z.object({ balance: z.number(), availableClaim: z.object({ id: z.string() }).nullish() }).nullish() }).nullish(),
  communityPointsSettings: z.object({ isEnabled: z.boolean(), name: z.string().nullish(), image: picture,
    customRewards: z.array(z.unknown()).nullish(), automaticRewards: z.array(z.unknown()).nullish() }).nullish(),
}) }).nullish() });
export type PointsReward = z.infer<typeof rewardSchema> & { automatic: boolean };
export interface PointsContext {
  channelId: string; name: string; image?: string; balance: number | null;
  claimId?: string; enabled: boolean; rewards: PointsReward[];
}
export function parsePointsContext(data: unknown, includeDisabled = false): PointsContext {
  const parsed = contextSchema.safeParse(data);
  if (!parsed.success) throw new Error("Twitch returned incomplete channel point details. Try again.");
  const channel = parsed.data.community;
  if (!channel) throw new Error("This Twitch channel could not be found.");
  const settings = channel.channel.communityPointsSettings;
  const points = channel.channel.self?.communityPoints;
  return { channelId: channel.id, name: settings?.name || "Channel points", image: settings?.image?.url2x ?? settings?.image?.url,
    balance: points?.balance ?? null, claimId: points?.availableClaim?.id, enabled: settings?.isEnabled ?? false,
    rewards: [...(settings?.customRewards ?? []).map(r => ({ value: r, automatic: false })),
      ...(settings?.automaticRewards ?? []).map(r => ({ value: r, automatic: true }))]
      .flatMap(({ value, automatic }) => {
        // Bits-priced and unpriced automatic rewards can have a null cost.
        // Validate each entry independently so none can disable earning or the catalog.
        const reward = rewardSchema.safeParse(value);
        return reward.success && (includeDisabled || reward.data.isEnabled) && (!reward.data.pricingType || reward.data.pricingType === "POINTS")
          ? [{ ...reward.data, automatic }] : [];
      }),
  };
}
export function rewardUnavailable(reward: PointsReward, balance: number | null, now = Date.now()): string | undefined {
  if (!reward.isEnabled || reward.isPaused) return "This reward is paused.";
  if (!reward.isInStock) return "This reward is out of stock.";
  if (reward.cooldownExpiresAt && Date.parse(reward.cooldownExpiresAt) > now) return "This reward is on cooldown.";
  if (reward.maxPerStreamSetting?.isEnabled && (reward.redemptionsRedeemedCurrentStream ?? 0) >= reward.maxPerStreamSetting.maxPerStream) return "This stream's reward limit has been reached.";
  if (balance === null) return "Link your Twitch website session to use channel points.";
  if (balance < reward.cost) return "You don't have enough channel points.";
  return undefined;
}
interface Options {
  fetch: typeof fetch;
  token: () => string | undefined;
  bonus: () => boolean;
  notice: (channel: string, text: string) => void;
  socket?: (url: string) => WebSocket;
  redemption?: (channel: string, data: unknown, immediate?: boolean) => void;
  login?: () => string | undefined;
}
const responseSchema = z.object({ data: z.record(z.string(), z.unknown()).nullish(), errors: z.array(z.object({ message: z.string() })).optional() });
/** Twitch remains authoritative for balances, eligibility, claims and spending. */
export class ChannelPointsService {
  private channel: string | null = null;
  private playing = false;
  private watchedMs = 0;
  private previousTick = 0;
  private generation = 0;
  private interval?: ReturnType<typeof setInterval>;
  private context?: PointsContext;
  private identity?: { token: string; id: string; login?: string };
  private socket?: WebSocket;
  private reconnect?: ReturnType<typeof setTimeout>;
  private socketWatchdog?: ReturnType<typeof setTimeout>;
  private retryMs = 1000;
  private claimPending = false;
  private redeemed = false;
  private redemptionIntent?: { key: string; transactionId: string };
  private contextPending?: Promise<PointsContext>;
  private claimed = new Set<string>();
  private eventIds = new Set<string>();
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private pendingBase = false;
  private pendingBonus = false;
  private diagnostics = { beacons: 0, passiveAwards: 0, bonusClaims: 0, connected: false, error: "", lastAwardAt: 0 };
  status() { return { channel: this.channel, playing: this.playing, linked: Boolean(this.options.token()), balance: this.context?.balance ?? null, ...this.diagnostics }; }
  private spade?: string;
  private tickPending = false;
  private retryAfter = 0;
  private catalogs = new Map<string, { at: number; rewards: PointsReward[] }>();
  private catalogPending = new Map<string, Promise<PointsContext>>();
  constructor(private readonly options: Options) {}
  async lookup(channel: string, id: string): Promise<ChatReward | undefined> {
    if (!this.catalogs.has(channel) || Date.now() - this.catalogs.get(channel)!.at > 60000) {
      let pending = this.catalogPending.get(channel);
      if (!pending) { pending = this.load(channel, true).finally(() => this.catalogPending.delete(channel)); this.catalogPending.set(channel, pending); }
      await pending;
    }
    const reward = this.catalogs.get(channel)?.rewards.find(r => r.id === id);
    return reward ? { id: reward.id, title: reward.title ?? reward.type?.replace(/_/g, " "), cost: reward.cost, imageUrl: reward.image?.url } : undefined;
  }
  private async gql(body: unknown, token = this.options.token()) {
    const response = await this.options.fetch("https://gql.twitch.tv/gql", { method: "POST",
      headers: { "Client-ID": CLIENT_ID, "Content-Type": "application/json", ...(token ? { Authorization: `OAuth ${token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Twitch could not load channel points (${response.status}).`);
    const payload = responseSchema.parse(await response.json());
    if (payload.errors?.length) {
      const integrity = payload.errors.some(e => /integrity/i.test(e.message));
      throw new Error(integrity ? "Twitch needs a fresh website sign-in. Relink your Twitch website session in Accounts." : payload.errors[0].message.slice(0, 240));
    }
    if (!payload.data) throw new Error("Twitch did not return channel points data.");
    return payload.data;
  }
  async load(login: string, publicOnly = false): Promise<PointsContext> {
    const token = publicOnly ? "" : this.options.token();
    const data = await this.gql({ operationName: "ChannelPointsContext", variables: { channelLogin: login, includeGoalTypes: ["CREATOR", "BOOST"] },
      extensions: { persistedQuery: { version: 1, sha256Hash: CONTEXT_HASH } } }, token);
    const result = parsePointsContext(data);
    this.catalogs.set(login, { at: Date.now(), rewards: parsePointsContext(data, true).rewards });
    if (this.catalogs.size > 20) this.catalogs.delete(this.catalogs.keys().next().value!);
    if (!publicOnly && this.channel === login && token === this.options.token()) this.context = result;
    return result;
  }
  private refresh() {
    if (this.contextPending) return this.contextPending;
    const login = this.channel;
    if (!login) return Promise.reject(new Error("Open a live Twitch stream first."));
    const pending = this.load(login).finally(() => { if (this.contextPending === pending) this.contextPending = undefined; });
    this.contextPending = pending;
    return pending;
  }
  /** Called from native playback reports, rather than chat membership or a UI timer. */
  playback(channel: string | null, state: NativePlayerState, vod: boolean) {
    const liveChannel = channel && !channel.startsWith("kick:") && !vod ? channel : null;
    if (liveChannel !== this.channel) {
      this.stop(); this.channel = liveChannel;
      if (liveChannel) { this.previousTick = Date.now(); this.interval = setInterval(() => void this.tick(), 1000); }
    }
    this.playing = state.status === "playing" && !state.paused && state.quality !== "chat_only";
  }
  resetSession() { const channel = this.channel; this.stop(); this.channel = channel; if (channel) { this.previousTick = Date.now(); this.interval = setInterval(() => void this.tick(), 1000); } }
  private async getIdentity() {
    const token = this.options.token();
    if (!token) throw new Error("Link your Twitch website session in Accounts to collect channel points.");
    if (this.identity?.token === token) return this.identity;
    const response = await this.options.fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Relink your Twitch website session in Accounts.");
    const result = z.object({ user_id: z.string().min(1), login: z.string().optional() }).parse(await response.json());
    if (this.options.token() !== token) throw new Error("The Twitch account changed. Try again.");
    return this.identity = { token, id: result.user_id, login: result.login };
  }
  private async tick() {
    const now = Date.now(); const elapsed = Math.min(2000, Math.max(0, now - this.previousTick)); this.previousTick = now;
    if (!this.channel) return;
    if (this.options.token() && this.playing) this.watchedMs = Math.min(60000, this.watchedMs + elapsed);
    if (this.tickPending || now < this.retryAfter) return;
    this.tickPending = true;
    const generation = this.generation;
    try {
      let identity: Awaited<ReturnType<ChannelPointsService["getIdentity"]>> | undefined;
      let identityError: unknown;
      try { if (this.options.token()) identity = await this.getIdentity(); }
      catch (error) { identityError = error; }
      if (generation !== this.generation) return;
      if (!this.context || Math.floor(now / 30000) !== Math.floor((now - elapsed) / 30000)) {
        const context = identityError ? await this.load(this.channel!, true) : await this.refresh();
        if (generation !== this.generation) return;
        this.context = context;
        if (identity && this.playing && context.claimId && this.options.bonus()) await this.claimBonus(context, generation);
      }
      if (this.context?.enabled && !this.socket && !this.reconnect) this.connect(identity, generation);
      if (identityError) throw identityError;
      if (identity && this.playing && this.watchedMs >= 60000) {
        this.watchedMs -= 60000;
        await this.minuteWatched(identity, generation);
      }
    } catch (error) { this.diagnostics.error = error instanceof z.ZodError ? "Twitch returned incomplete points tracking data." : error instanceof Error ? error.message : "Points tracking could not connect."; this.retryAfter = Date.now() + 30000; /* Retry a provider outage with backoff; never invent a claim. */ }
    finally { this.tickPending = false; }
  }
  private async minuteWatched(identity: { token: string; id: string }, generation: number) {
    const channel = this.channel;
    if (!channel || !this.context || !this.playing) return;
    const data = await this.gql({ query: "query PointsBroadcast($login:String!) { user(login:$login) { stream { id } } }", variables: { login: channel } }, identity.token);
    const broadcast = z.object({ user: z.object({ stream: z.object({ id: z.string() }).nullish() }).nullish() }).parse(data).user?.stream?.id;
    if (!broadcast || generation !== this.generation) return;
    if (!this.spade) {
      const page = await this.options.fetch(`https://www.twitch.tv/${encodeURIComponent(channel)}`, { signal: AbortSignal.timeout(10000) });
      const settings = (await page.text()).match(/https:\/\/[\w.]+\/config\/settings\.[\w-]+\.js/)?.[0];
      if (!settings || !/^https:\/\/(?:[\w-]+\.)*(?:twitch\.tv|twitchcdn\.net)\//.test(settings)) return;
      const config = await this.options.fetch(settings, { signal: AbortSignal.timeout(10000) });
      const destination = (await config.text()).match(/"(?:spade_url|beacon_url)"\s*:\s*"([^"]+)"/)?.[1]?.replace(/\\\//g, "/");
      if (!destination) return;
      const url = new URL(destination);
      if (url.protocol !== "https:" || !["twitch.tv", "twitchcdn.net"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return;
      this.spade = destination;
    }
    if (generation !== this.generation || !this.playing || this.options.token() !== identity.token) return;
    const event = { event: "minute-watched", properties: { channel_id: this.context.channelId, broadcast_id: broadcast, player: "site", user_id: Number(identity.id) } };
    const response = await this.options.fetch(this.spade, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: btoa(JSON.stringify(event)) }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Twitch watch tracking could not connect (${response.status}).`);
    this.diagnostics.beacons++; this.diagnostics.error = "";
    // A delivered watch beacon is not an awarded-point confirmation. Only the
    // provider's points-earned event below creates a chat notice.
  }
  private async claimBonus(context: PointsContext, generation: number) {
    const claim = context.claimId; const token = this.options.token();
    if (!claim || !token || this.claimed.has(claim) || this.claimPending || !this.options.bonus()) return;
    this.claimPending = true;
    try {
      const data = await this.gql({ query: "mutation ClaimBonus($input:ClaimCommunityPointsInput!) { claimCommunityPoints(input:$input) { claim { id } currentPoints error { code } } }",
        variables: { input: { channelID: context.channelId, claimID: claim } } }, token);
      const result = z.object({ claimCommunityPoints: z.object({ claim: z.object({ id: z.string() }).nullish(), currentPoints: z.number().nullish(), error: z.object({ code: z.string() }).nullish() }).nullish() }).parse(data).claimCommunityPoints;
      if (result?.error || !result?.claim || generation !== this.generation || token !== this.options.token()) return;
      this.claimed.add(claim); if (this.claimed.size > 100) this.claimed.delete(this.claimed.values().next().value!);
      if (result.currentPoints != null) context.balance = result.currentPoints;
      context.claimId = undefined;
      this.diagnostics.bonusClaims++; this.diagnostics.lastAwardAt = Date.now();
      this.queueNotice(true);
    } finally { this.claimPending = false; }
  }
  private queueNotice(bonus: boolean) {
    this.pendingBonus ||= bonus; this.pendingBase ||= !bonus;
    clearTimeout(this.noticeTimer);
    const channel = this.channel;
    this.noticeTimer = setTimeout(() => {
      if (channel && channel === this.channel) {
        if (this.pendingBase) this.options.notice(channel, "Channel points has been claimed");
        if (this.pendingBonus) this.options.notice(channel, "Bonus channel points has been claimed");
      }
      this.pendingBase = this.pendingBonus = false;
    }, 900);
  }
  private connect(identity: { token: string; id: string } | undefined, generation: number) {
    if (!this.context || generation !== this.generation) return;
    const socket = (this.options.socket ?? (url => new WebSocket(url)))(`wss://hermes.twitch.tv/v1?clientId=${CLIENT_ID}`);
    this.socket = socket;
    const sessionToken = this.options.token();
    const subscription = crypto.randomUUID(), channelSubscription = crypto.randomUUID();
    const send = (body: Record<string, unknown>) => socket.send(JSON.stringify({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...body }));
    const watchdog = (ms = 30000) => { clearTimeout(this.socketWatchdog); this.socketWatchdog = setTimeout(() => socket.close(), ms); };
    socket.onopen = () => watchdog();
    socket.onmessage = event => {
      if (generation !== this.generation || sessionToken !== this.options.token()) { socket.close(); return; }
      try {
        const packet = JSON.parse(String(event.data));
        if (packet.type === "welcome") {
          this.retryMs = 1000; watchdog((packet.welcome?.keepaliveSec ?? 15) * 1000 + 5000);
          if (identity) {
            send({ type: "authenticate", authenticate: { token: identity.token } });
            send({ type: "subscribe", subscribe: { id: subscription, type: "pubsub", pubsub: { topic: `community-points-user-v1.${identity.id}` } } });
          }
          send({ type: "subscribe", subscribe: { id: channelSubscription, type: "pubsub", pubsub: { topic: `community-points-channel-v1.${this.context!.channelId}` } } });
        } else if (packet.type === "subscribeResponse") {
          this.diagnostics.connected = packet.subscribeResponse?.result === "ok" && !packet.subscribeResponse?.error;
        } else if (packet.type === "keepalive") watchdog();
        else if (packet.type === "reconnect") socket.close();
        else if (packet.type === "notification") {
          watchdog();
          const source = packet.notification?.subscription?.id;
          if (![subscription, channelSubscription].includes(source) || typeof packet.notification.pubsub !== "string") return;
          if (packet.id && this.eventIds.has(packet.id)) return;
          if (packet.id) { this.eventIds.add(packet.id); if (this.eventIds.size > 500) this.eventIds.delete(this.eventIds.values().next().value!); }
          const message = JSON.parse(packet.notification.pubsub);
          if (source === channelSubscription) {
            const redemption = message.data?.redemption;
            if (message.type === "reward-redeemed" && String(redemption?.channel_id) === this.context?.channelId && this.channel) this.options.redemption?.(this.channel, redemption);
            return;
          }
          const pointsChannel = String(message.data?.balance?.channel_id ?? message.data?.claim?.channel_id ?? message.data?.channel_id ?? "");
          if (pointsChannel !== this.context?.channelId) return;
          if (message.type === "points-earned" && Number(message.data?.point_gain?.total_points ?? 0) > 0) {
            if (typeof message.data?.balance?.balance === "number") this.context.balance = message.data.balance.balance;
            const reason = String(message.data?.point_gain?.reason_code ?? "").toUpperCase();
            // The claim mutation confirms bonus claims; its matching earned event
            // must not also masquerade as passive watch-time earnings.
            if (!/CLAIM|BONUS/.test(reason)) {
              this.diagnostics.passiveAwards++; this.diagnostics.lastAwardAt = Date.now(); this.queueNotice(false);
            }
          } else if (message.type === "claim-available" && this.options.bonus()) {
            void this.refresh().then(context => this.claimBonus(context, generation)).catch(() => undefined);
          }
        }
      } catch { /* Ignore malformed provider events. */ }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined; this.diagnostics.connected = false; clearTimeout(this.socketWatchdog);
      if (generation === this.generation) {
        this.reconnect = setTimeout(() => { this.reconnect = undefined; if (generation === this.generation && this.playing) this.connect(identity, generation); }, this.retryMs);
        this.retryMs = Math.min(30000, this.retryMs * 2);
      }
    };
  }
  async redeem(login: string, selected: PointsReward, text: string) {
    if (this.redeemed) throw new Error("A redemption is already being submitted.");
    if (selected.automatic) throw new Error("Use Twitch's reward controls for this reward.");
    this.redeemed = true;
    const token = this.options.token();
    if (!token) { this.redeemed = false; throw new Error("Link your Twitch website session first."); }
    try {
      const context = await this.load(login);
      if (token !== this.options.token()) throw new Error("The Twitch account changed. Try again.");
      const reward = context.rewards.find(item => item.id === selected.id && !item.automatic);
      if (!reward) throw new Error("This reward is no longer available.");
      const unavailable = rewardUnavailable(reward, context.balance);
      if (unavailable) throw new Error(unavailable);
      if (reward.cost !== selected.cost || reward.title !== selected.title || reward.prompt !== selected.prompt) throw new Error("The reward changed. Close this reward and select it again to review the current details.");
      if (reward.isUserInputRequired && !text.trim()) throw new Error("Enter a message for this reward.");
      if (text.length > 500) throw new Error("Reward messages must be 500 characters or fewer.");
      const intentKey = JSON.stringify([token, login, reward.id, reward.cost, reward.title, reward.prompt, text]);
      if (this.redemptionIntent?.key !== intentKey) this.redemptionIntent = { key: intentKey, transactionId: crypto.randomUUID() };
      // Reuse the provider transaction ID after a lost response. A second tap
      // must not charge twice just because the first reply never reached us.
      const transactionID = this.redemptionIntent.transactionId;
      const data = await this.gql({ query: "mutation RedeemReward($input:RedeemCommunityPointsCustomRewardInput!) { redeemCommunityPointsCustomReward(input:$input) { error { code } redemption { id } } }",
        variables: { input: { channelID: context.channelId, rewardID: reward.id, cost: reward.cost, title: reward.title,
          prompt: reward.prompt || null, textInput: reward.isUserInputRequired ? text : null, transactionID } } }, token);
      const result = z.object({ redeemCommunityPointsCustomReward: z.object({ error: z.object({ code: z.string() }).nullish(), redemption: z.object({ id: z.string() }).nullish() }).nullish() }).parse(data).redeemCommunityPointsCustomReward;
      if (result?.error) { this.redemptionIntent = undefined; throw new Error(`Twitch could not redeem this reward: ${result.error.code.replace(/_/g, " ").toLowerCase()}.`); }
      if (!result?.redemption?.id) throw new Error("Twitch did not confirm the redemption. Check your points balance before trying again.");
      this.redemptionIntent = undefined;
      this.options.redemption?.(login, { id: result.redemption.id, channel_id: context.channelId, redeemed_at: new Date().toISOString(),
        user: { login: this.options.login?.() ?? this.identity?.login ?? "" }, user_input: reward.isUserInputRequired ? text : "",
        reward: { id: reward.id, title: reward.title ?? "Channel points reward", cost: reward.cost } }, true);
      return result.redemption.id;
    } finally { this.redeemed = false; }
  }
  stop() {
    this.generation++; this.channel = null; this.playing = false; this.watchedMs = 0;
    clearInterval(this.interval); clearTimeout(this.reconnect); clearTimeout(this.socketWatchdog); clearTimeout(this.noticeTimer);
    const socket = this.socket; this.socket = undefined; socket?.close(); this.reconnect = undefined;
    this.context = undefined; this.contextPending = undefined; this.identity = undefined; this.redemptionIntent = undefined;
    this.diagnostics = { beacons: 0, passiveAwards: 0, bonusClaims: 0, connected: false, error: "", lastAwardAt: 0 };
    this.retryAfter = 0; this.pendingBase = this.pendingBonus = false; this.claimed.clear(); this.eventIds.clear();
  }
}
