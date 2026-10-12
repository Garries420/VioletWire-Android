package io.github.garries420.violetwire;

import java.util.SortedMap;

final class StreamQuality {
    private StreamQuality() {}

    /** Tracks are sorted from highest resolution/frame rate to lowest. */
    static String resolve(String requested, SortedMap<String, String> tracks) {
        if (tracks.isEmpty() || !requested.matches("\\d{2,4}p(?:\\d{2,3})?")) return requested;
        if (tracks.containsKey(requested)) return requested;
        // Resolution-only preferences also match providers that include FPS.
        if (requested.endsWith("p")) {
            for (String available : tracks.keySet()) {
                if (available.startsWith(requested)) return available;
            }
        }
        return tracks.firstKey();
    }
}
