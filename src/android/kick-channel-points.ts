import { z } from "zod";
import type { NativePlayerState } from "../shared/player";
import { rewardUnavailable, type PointsContext, type PointsReward } from "./channel-points";

const reward = z.object({ id: z.string().regex(/^[A-Z0-9]{26}$/), title: z.string(), cost: z.number().nonnegative(),
  description: z.string().nullish(), prompt: z.string().nullish(), background_color: z.string().nullish(),
  is_enabled: z.boolean(), is_paused: z.boolean(), is_user_input_required: z.boolean() });
const catalog = z.object({ data: z.array(z.unknown()) });
const points = z.object({ data: z.object({ points: z.union([z.number().nonnegative(), z.string().regex(/^\d+$/).transform(Number)]) }) });
const info = z.object({ id: z.number(), livestream: z.object({ id: z.number(), vod_id: z.string() }).nullish() });
interface Options {
  request: (path: string, method?: string, body?: unknown) => Promise<Response>;
  session: () => string | undefined;
  notice: (channel: string, text: string) => void;
  visible?: () => boolean;
  socket?: (url: string) => WebSocket;
}
export function parseKickRewards(raw: unknown): PointsReward[] {
  return catalog.parse(raw).data.flatMap(value => {
    const parsed = reward.safeParse(value); if (!parsed.success || !parsed.data.is_enabled) return [];
    const r = parsed.data;
    return [{ id: r.id, title: r.title, cost: r.cost, prompt: r.description || r.prompt || "", backgroundColor: r.background_color,
      isEnabled: r.is_enabled, isPaused: r.is_paused, isInStock: !r.is_paused, isUserInputRequired: r.is_user_input_required, automatic: false }];
  });
}
/** Kick's viewer protocol reports real foreground playback. Balances stay server-owned. */
export class KickChannelPointsService {
  private channel: string | null = null;
  private account?: string;
  private playing = false;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private socket?: WebSocket;
  private lastTick = 0;
  private watchedMs = 0;
  private watchStarted = false;
  private intervalMs = 120000;
  private lastHandshake = 0;
  private lastPoll = 0;
  private lastInfo = 0;
  private retryAt = 0;
  private pending = false;
  private balance: number | null = null;
  private current?: z.infer<typeof info>;
  private redeeming = false;
  private intent?: { key: string; transaction: string };
  private diagnostics = { connected: false, watchEvents: 0, awards: 0, error: "" };
  constructor(private readonly options: Options) {}
  status() { return { channel: this.channel, playing: this.playing, balance: this.balance, ...this.diagnostics }; }
  private async json(path: string, method = "GET", body?: unknown) {
    const response = await this.options.request(path, method, body);
    if (!response.ok) throw new Error([401,403,419].includes(response.status) ? "Sign in to Kick in Accounts to earn and spend channel points." : `Kick could not load channel points (${response.status}). Try again.`);
    if (response.status === 204) return null;
    return response.json();
  }
  async load(channel: string): Promise<PointsContext> {
    const slug = channel.replace(/^kick:/, "");
    const signed = Boolean(this.options.session());
    const [raw, balance, settings] = await Promise.all([
      this.json(`/api/v2/channels/${slug}/rewards`),
      signed ? this.json(`/api/v2/channels/${slug}/points`).then(raw => points.parse(raw).data.points) : null,
      signed ? this.json(`/api/v2/channels/${slug}/channel-points/channel-settings`) : null,
    ]);
    const rewards = parseKickRewards(raw);
    const enabled = settings ? z.object({ data: z.object({ channel_points_enabled: z.boolean() }) }).parse(settings).data.channel_points_enabled : rewards.length > 0;
    return { channelId: slug, name: "Channel points", balance, enabled, rewards };
  }
  playback(channel: string | null, state: NativePlayerState, vod: boolean) {
    const next = channel?.startsWith("kick:") && !vod ? channel : null;
    const account = this.options.session();
    if (next !== this.channel || account !== this.account) {
      this.stop(); this.channel = next; this.account = account;
      if (next && account) { this.lastTick = Date.now(); this.timer = setInterval(() => void this.tick(), 1000); }
    }
    this.playing = state.status === "playing" && !state.paused && state.quality !== "chat_only" && !state.pictureInPicture;
    if (!this.playing) this.disconnect();
  }
  private send(type: string, data?: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, ...(data ? { data } : {}) })); return true;
  }
  private async tick() {
    const now = Date.now(), elapsed = Math.min(2000, Math.max(0, now - this.lastTick)); this.lastTick = now;
    if (!this.playing || !this.channel || !this.account || this.account !== this.options.session() || !(this.options.visible?.() ?? !document.hidden)) { this.disconnect(); return; }
    this.watchedMs += elapsed;
    if (this.pending || now < this.retryAt) return;
    this.pending = true; const generation = this.generation;
    const slug = this.channel.slice(5);
    try {
      if (!this.current || now - this.lastInfo >= 60000) {
        const current = info.parse(await this.json(`/api/v2/channels/${slug}/info`));
        const settings = await this.json("/api/internal/settings/global");
        if (generation !== this.generation) return;
        if (this.current && this.current.livestream?.id !== current.livestream?.id) {
          this.disconnect(); this.watchStarted = false; this.watchedMs = 0;
        }
        this.current = current; this.lastInfo = now;
        const seconds = z.object({ events: z.record(z.string(), z.object({ interval: z.number() })) }).safeParse(settings);
        if (seconds.success) this.intervalMs = Math.max(30000, Math.min(600000, (seconds.data.events["tracking.user.watch.livestream"]?.interval ?? 120) * 1000));
      }
      if (generation !== this.generation || !this.playing) return;
      if (!this.socket && this.current.livestream) {
        const result = z.object({ data: z.object({ token: z.string().min(1) }) }).parse(await this.json("/viewer/v1/token"));
        if (generation !== this.generation || !this.playing) return;
        const socket = (this.options.socket ?? (url => new WebSocket(url)))(`wss://websockets.kick.com/viewer/v1/connect?token=${encodeURIComponent(result.data.token)}`);
        this.socket = socket;
        socket.onopen = () => { if (generation !== this.generation) { socket.close(); return; } this.diagnostics.connected = true; this.lastHandshake = 0; };
        socket.onerror = () => socket.close();
        socket.onclose = () => { if (this.socket === socket) { this.socket = undefined; this.diagnostics.connected = false; this.retryAt = Date.now() + 10000; } };
      }
      const live = this.current.livestream;
      if (live && this.socket?.readyState === WebSocket.OPEN) {
        if (now - this.lastHandshake >= 15000) {
          this.send("channel_handshake", { message: { channelId: String(this.current.id) } }); this.send("ping"); this.lastHandshake = now;
        }
        if (!this.watchStarted || this.watchedMs >= this.intervalMs) {
          if (this.send("user_event", { message: { name: "tracking.user.watch.livestream", channel_id: this.current.id, livestream_id: live.id, vod_id: live.vod_id } })) {
            this.watchStarted = true; this.watchedMs = 0; this.diagnostics.watchEvents++;
          }
        }
      }
      if (now - this.lastPoll >= 30000) {
        const value = points.parse(await this.json(`/api/v2/channels/${slug}/points`)).data.points;
        if (generation !== this.generation || this.account !== this.options.session()) return;
        // Initial balance is not an award. Only a confirmed subsequent increase
        // generates a local notice; Kick handles its own engagement bonuses.
        if (this.balance !== null && value > this.balance) { this.options.notice(this.channel, "Channel points has been claimed"); this.diagnostics.awards++; }
        this.balance = value; this.lastPoll = now;
      }
      this.diagnostics.error = "";
    } catch (error) { this.diagnostics.error = error instanceof z.ZodError ? "Kick returned incomplete points tracking data." : error instanceof Error ? error.message : "Kick points could not connect."; this.retryAt = Date.now() + 30000; }
    finally { if (generation === this.generation) this.pending = false; }
  }
  async redeem(channel: string, selected: PointsReward, text: string) {
    if (this.redeeming) throw new Error("A redemption is already being submitted.");
    if (!this.options.session()) throw new Error("Sign in to Kick first.");
    this.redeeming = true; const account = this.options.session();
    try {
      const context = await this.load(channel);
      if (account !== this.options.session()) throw new Error("The Kick account changed. Try again.");
      const fresh = context.rewards.find(r => r.id === selected.id);
      if (!fresh || !context.enabled) throw new Error("This reward is no longer available.");
      const unavailable = rewardUnavailable(fresh, context.balance); if (unavailable) throw new Error(unavailable);
      if (fresh.cost !== selected.cost || fresh.title !== selected.title || fresh.prompt !== selected.prompt) throw new Error("The reward changed. Select it again to review the current details.");
      if (fresh.isUserInputRequired && !text.trim()) throw new Error("Enter a message for this reward.");
      if (text.length > 500) throw new Error("Reward messages must be 500 characters or fewer.");
      const key = JSON.stringify([account, channel, fresh, text]);
      if (this.intent?.key !== key) this.intent = { key, transaction: crypto.randomUUID() };
      const response = await this.json(`/api/v2/channels/${channel.replace(/^kick:/, "")}/rewards/${fresh.id}/redeem`, "POST", { transaction_id: this.intent.transaction, ...(text ? { message: text } : {}) });
      if (!response || typeof response !== "object" || !(response.message === "OK" || (response.data && typeof response.data === "object" && (response.data.id || response.data.redemption?.id)))) throw new Error("Kick did not confirm the redemption. Check your balance before trying again.");
      this.intent = undefined;
      // Refresh the authoritative balance rather than subtracting an assumed cost.
      if (this.channel === channel) this.lastPoll = 0;
      return "confirmed";
    } finally { this.redeeming = false; }
  }
  private disconnect() {
    this.send("channel_disconnect", { message: { channelId: String(this.current?.id ?? "") } });
    const socket = this.socket; this.socket = undefined; socket?.close(); this.diagnostics.connected = false;
  }
  stop() {
    this.generation++; clearInterval(this.timer); this.disconnect(); this.channel = null; this.account = undefined;
    this.playing = false; this.current = undefined; this.balance = null; this.lastPoll = 0; this.lastInfo = 0; this.retryAt = 0; this.pending = false;
    this.watchedMs = 0; this.watchStarted = false; this.intent = undefined;
    this.diagnostics = { connected: false, watchEvents: 0, awards: 0, error: "" };
  }
}
