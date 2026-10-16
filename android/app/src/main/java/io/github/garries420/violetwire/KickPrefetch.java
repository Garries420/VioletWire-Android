package io.github.garries420.violetwire;

/** AWS IVS exposes its currently produced TS fragment as EXT-X-PREFETCH.
 * Media3 ignores this draft tag. Advertise the first fragment as streamable
 * media, retaining the original timestamps and never predicting its URL. */
final class KickPrefetch {
    static String expand(String text) {
        if (text.contains("#EXT-X-ENDLIST") || text.contains("#EXT-X-PLAYLIST-TYPE:")
            || text.contains("#EXT-X-PART:") || !text.contains("#EXT-X-PROGRAM-DATE-TIME:")) return text;
        StringBuilder out = new StringBuilder();
        String duration = null;
        boolean discontinuity = false, added = false;
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.startsWith("#EXTINF:")) {
                String value = line.substring(8).split(",", 2)[0];
                try { if (Double.parseDouble(value) > 0) duration = value; }
                catch (NumberFormatException ignored) { duration = null; }
            }
            if (line.equals("#EXT-X-DISCONTINUITY") || line.equals("#EXT-X-PREFETCH-DISCONTINUITY") || line.equals("#EXT-X-GAP")) discontinuity = true;
            if (!line.isEmpty() && !line.startsWith("#")) discontinuity = false;
            if (line.startsWith("#EXT-X-PREFETCH:")) {
                String uri = line.substring("#EXT-X-PREFETCH:".length()).trim();
                if (!added && !discontinuity && duration != null && uri.startsWith("https://")) {
                    out.append("#EXTINF:").append(duration).append(",live\n").append(uri).append('\n');
                }
                added = true; // The second future fragment is not ready to read.
                continue;
            }
            out.append(raw).append('\n');
        }
        return out.toString();
    }
}
