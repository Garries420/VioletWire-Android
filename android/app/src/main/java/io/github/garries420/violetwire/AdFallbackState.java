package io.github.garries420.violetwire;

/** Require two advancing, ad-free media snapshots before leaving the proxy.
 * Changing server timestamps or signed URLs alone is not media advancement. */
final class AdFallbackState {
    private int clean;
    private long previousEdge = -1;
    private int previousParts;
    boolean observe(String playlist, boolean blocked) {
        if (!playlist.contains("#EXTINF:") && !playlist.contains("#EXT-X-PART:")) return false;
        long sequence = 0;
        int segments = 0, trailingParts = 0;
        for (String raw : playlist.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
                try { sequence = Long.parseLong(line.substring(22)); }
                catch (NumberFormatException invalid) { return false; }
                if (sequence < 0) return false;
            }
            if (line.startsWith("#EXTINF:")) segments++;
            if (line.startsWith("#EXT-X-PART:")) trailingParts++;
            if (!line.isEmpty() && !line.startsWith("#")) trailingParts = 0;
        }
        long edge = sequence + segments;
        if (blocked) { clean = 0; previousEdge = edge; previousParts = trailingParts; return false; }
        if (edge < previousEdge || (edge == previousEdge && trailingParts <= previousParts)) return false;
        previousEdge = edge; previousParts = trailingParts;
        return ++clean >= 2;
    }
}
