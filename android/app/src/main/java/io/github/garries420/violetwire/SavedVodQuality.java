package io.github.garries420.violetwire;

import java.util.SortedMap;

final class SavedVodQuality {
    private SavedVodQuality() {}
    static String resolve(String requested, boolean downloaded, SortedMap<String, String> tracks) {
        if (!downloaded || tracks.isEmpty() || "audio_only".equals(requested) || "chat_only".equals(requested)) return requested;
        // A saved HLS rendition can omit FPS from its track metadata. Select the
        // actual saved video track so the menu and selector describe the same item.
        return tracks.containsKey(requested) ? requested : tracks.firstKey();
    }
}
