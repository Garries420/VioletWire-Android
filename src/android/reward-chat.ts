import { z } from "zod";
import type { ChatMessage, ChatReward } from "../shared/chat";
const receipt = z.object({ id: z.string().min(1), channel_id: z.string(), redeemed_at: z.string().optional(),
  user: z.object({ login: z.string(), display_name: z.string().optional() }), user_input: z.string().nullish(),
  reward: z.object({ id: z.string(), title: z.string(), cost: z.number().nonnegative(), pricing_type: z.string().nullish(), image: z.object({ url_1x: z.string().optional() }).nullish() }) });
interface Entry { message: ChatMessage; emitted: boolean; timer?: ReturnType<typeof setTimeout>; }
/** Join the public redemption event and its IRC text into one themed chat row. */
export class RewardChat {
  private channel: string | null = null;
  private generation = 0;
  private entries: Entry[] = [];
  constructor(private options: { emit: (message: ChatMessage) => void; lookup: (channel: string, id: string) => Promise<ChatReward | undefined> }) {}
  watch(channel: string | null) {
    this.generation++; this.channel = channel;
    for (const entry of this.entries) clearTimeout(entry.timer);
    this.entries = [];
  }
  private remember(entry: Entry) {
    this.entries.push(entry);
    if (this.entries.length > 500) { const first = this.entries.shift(); clearTimeout(first?.timer); }
  }
  message(message: ChatMessage) {
    if (!message.reward || message.deleted || message.channel !== this.channel) { this.options.emit(message); return; }
    const generation = this.generation;
    const event = [...this.entries].reverse().find(entry => entry.message.reward?.id === message.reward!.id
      && entry.message.login.toLowerCase() === message.login.toLowerCase() && entry.message.text.trim() === message.text.trim()
      && Math.abs(entry.message.sentAt - message.sentAt) < 15000 && entry.message.reward?.eventOnly);
    let entry: Entry;
    if (event) {
      clearTimeout(event.timer);
      message = { ...message, replacesId: event.emitted ? event.message.id : undefined, metadataOnly: event.emitted, reward: { ...event.message.reward!, eventOnly: false } };
      event.message = message; entry = event;
    } else { entry = { message, emitted: false }; this.remember(entry); }
    this.options.emit(message); entry.emitted = true;
    if (message.reward?.title && message.reward.cost !== undefined) return;
    void this.options.lookup(message.channel, message.reward!.id).then(reward => {
      if (!reward || generation !== this.generation) return;
      entry.message = { ...entry.message, metadataOnly: true, reward: { ...entry.message.reward!, ...reward, title: entry.message.reward?.title ?? reward.title } };
      this.options.emit(entry.message);
    }).catch(() => undefined);
  }
  redemption(channel: string, raw: unknown, immediate = false) {
    if (channel !== this.channel) return;
    const parsed = receipt.safeParse(raw); if (!parsed.success || parsed.data.reward.pricing_type === "BITS") return;
    const r = parsed.data;
    const duplicate = this.entries.find(entry => entry.message.reward?.redemptionId === r.id);
    if (duplicate) return;
    const reward: ChatReward = { id: r.reward.id, title: r.reward.title, cost: r.reward.cost, imageUrl: r.reward.image?.url_1x, redemptionId: r.id };
    const at = Date.parse(r.redeemed_at ?? ""); const sentAt = Number.isFinite(at) ? at : Date.now();
    const existing = [...this.entries].reverse().find(entry => !entry.message.reward?.redemptionId && entry.message.reward?.id === reward.id
      && entry.message.login.toLowerCase() === r.user.login.toLowerCase() && entry.message.text.trim() === (r.user_input ?? "").trim()
      && Math.abs(entry.message.sentAt - sentAt) < 15000);
    if (existing) {
      existing.message = { ...existing.message, metadataOnly: true, reward };
      this.options.emit(existing.message); return;
    }
    const entry: Entry = { emitted: false, message: { id: `reward-${r.id}`, channel, login: r.user.login, displayName: r.user.display_name || r.user.login || "You",
      color: "#a970ff", text: r.user_input ?? "", badges: [], twitchEmotes: [], sentAt, reward: { ...reward, eventOnly: true } } };
    this.remember(entry);
    const emit = () => { if (!entry.emitted && channel === this.channel) { entry.emitted = true; this.options.emit(entry.message); } };
    // Text redemptions also arrive over IRC with badges and emote ranges.
    // Briefly join them; non-text/locally confirmed receipts can display now.
    if (entry.message.text && !immediate) entry.timer = setTimeout(emit, 1500); else emit();
  }
}
