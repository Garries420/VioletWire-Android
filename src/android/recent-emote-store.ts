import { Preferences } from "@capacitor/preferences";
import { createRecentEmoteStore } from "./recent-emotes";

const KEY = "chat.recent-emotes.v1";
export const recentEmoteStore = createRecentEmoteStore({
  async read() {
    const stored = await Preferences.get({ key: KEY });
    return JSON.parse(stored.value ?? "[]") as unknown;
  },
  async write(keys) {
    await Preferences.set({ key: KEY, value: JSON.stringify(keys) });
  },
});
