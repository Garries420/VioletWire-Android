package io.github.garries420.violetwire;

import java.text.SimpleDateFormat;
import java.text.ParsePosition;
import java.util.Locale;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Local filtering only. Keep sequence numbers and timestamps intact: gaps
 * prevent Media3 from downloading marked ads without moving the live timeline. */
final class TwitchAdFilter {
    private static final Pattern ATTRIBUTE = Pattern.compile("([A-Z0-9-]+)=(\"[^\"]*\"|[^,]*)");
    private final Map<String, long[]> ranges = new LinkedHashMap<>();
    static final class Result {
        final String playlist;
        final boolean blocked;
        Result(String playlist, boolean blocked) { this.playlist = playlist; this.blocked = blocked; }
    }
    static Map<String, String> attributes(String line) {
        Map<String, String> result = new LinkedHashMap<>();
        Matcher matcher = ATTRIBUTE.matcher(line);
        while (matcher.find()) {
            String value = matcher.group(2);
            result.put(matcher.group(1), value.startsWith("\"") ? value.substring(1, value.length() - 1) : value);
        }
        return result;
    }
    private static long date(String value) {
        try {
            if (value == null) return Long.MIN_VALUE;
            Matcher timestamp = Pattern.compile("^(.*T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d+))?(Z|[+-]\\d{2}:\\d{2})$").matcher(value);
            if (!timestamp.matches()) return Long.MIN_VALUE;
            String fraction = timestamp.group(2) == null ? "000" : (timestamp.group(2) + "000").substring(0, 3);
            String normalized = timestamp.group(1) + "." + fraction + timestamp.group(3);
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US); format.setLenient(false);
            ParsePosition position = new ParsePosition(0); Date parsed = format.parse(normalized, position);
            return parsed == null || position.getIndex() != normalized.length() ? Long.MIN_VALUE : parsed.getTime();
        }
        catch (RuntimeException error) { return Long.MIN_VALUE; }
    }
    private static long duration(String value) {
        try { double seconds = Double.parseDouble(value); return Double.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0; }
        catch (RuntimeException error) { return 0; }
    }
    private boolean adAt(long time) {
        if (time == Long.MIN_VALUE) return false;
        for (long[] range : ranges.values()) if (time >= range[0] && time < range[1]) return true;
        return false;
    }
    synchronized Result filter(String text) {
        return filter(text, false);
    }
    synchronized Result filter(String text, boolean prefetch) {
        // A master playlist or non-Twitch media is left byte-for-byte intact.
        if (!text.contains("#EXTINF:") && !text.contains("#EXT-X-PART:")) return new Result(text, false);
        prefetch = prefetch && !text.contains("#EXT-X-ENDLIST") && !text.contains("#EXT-X-PLAYLIST-TYPE:");
        String[] lines = text.split("\\r?\\n");
        for (String raw : lines) {
            String line = raw.trim();
            if (!line.startsWith("#EXT-X-DATERANGE:")) continue;
            Map<String, String> attrs = attributes(line);
            String id = attrs.getOrDefault("ID", "");
            if (!"twitch-stitched-ad".equals(attrs.get("CLASS")) && !id.startsWith("stitched-ad-")) continue;
            long[] previous = ranges.get(id);
            long start = date(attrs.get("START-DATE"));
            if (start == Long.MIN_VALUE && previous != null) start = previous[0];
            if (start == Long.MIN_VALUE) continue;
            long end = date(attrs.get("END-DATE"));
            if (end == Long.MIN_VALUE) {
                long length = duration(attrs.getOrDefault("DURATION", attrs.get("PLANNED-DURATION")));
                end = length > 0 ? start + length : previous != null ? previous[1] : start;
            }
            ranges.put(id, new long[]{start, end});
            while (ranges.size() > 128) ranges.remove(ranges.keySet().iterator().next());
        }
        StringBuilder output = new StringBuilder();
        long time = Long.MIN_VALUE, segmentDuration = 0, partOffset = 0;
        long previousDuration = 0;
        boolean discontinuity = false, prefetched = false;
        boolean amazon = false, gap = false, blocked = false;
        for (String raw : lines) {
            String line = raw.trim();
            if (line.equals("#EXT-X-DISCONTINUITY")) discontinuity = true;
            if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) { time = date(line.substring(25)); partOffset = 0; }
            if (line.startsWith("#EXTINF:")) {
                int comma = line.indexOf(',');
                segmentDuration = duration(line.substring(8, comma < 0 ? line.length() : comma));
                amazon = comma >= 0 && line.substring(comma + 1).contains("Amazon");
            }
            if (line.equals("#EXT-X-GAP")) gap = true;
            if (line.startsWith("#EXT-X-PART:")) {
                Map<String, String> attrs = attributes(line);
                boolean ad = adAt(time == Long.MIN_VALUE ? time : time + partOffset);
                partOffset += duration(attrs.get("DURATION"));
                if (ad) raw = raw.replaceAll(",GAP=(YES|NO)", "") + ",GAP=YES";
                blocked = ad;
            }
            if (!line.isEmpty() && !line.startsWith("#") && segmentDuration > 0) {
                boolean ad = amazon || adAt(time);
                if (ad && !gap) output.append("#EXT-X-GAP\n");
                blocked = ad;
                previousDuration = segmentDuration;
                if (time != Long.MIN_VALUE) time += segmentDuration;
                segmentDuration = 0; partOffset = 0; amazon = false; gap = false;
                discontinuity = false;
            }
            if (line.startsWith("#EXT-X-TWITCH-PREFETCH:")) {
                // Only the first in-progress fragment is available to stream now.
                // Never infer across an ad/discontinuity or without timestamps.
                boolean first = !prefetched;
                prefetched = true;
                if (prefetch && first && !blocked && !discontinuity && previousDuration > 0 && time != Long.MIN_VALUE && !adAt(time) && !adAt(time + previousDuration - 1)) {
                    String uri = line.substring("#EXT-X-TWITCH-PREFETCH:".length()).trim();
                    if (!uri.isEmpty()) {
                        output.append("#EXTINF:").append(String.format(Locale.ROOT, "%.3f", previousDuration / 1000d)).append(",live\n").append(uri).append('\n');
                    }
                }
                continue;
            }
            // Do not speculatively preload unclassified ad data. Twitch's
            // Published parts remain; speculative ad preload data is omitted.
            if (line.startsWith("#EXT-X-PRELOAD-HINT:") && adAt(time == Long.MIN_VALUE ? time : time + partOffset)) continue;
            output.append(raw).append('\n');
        }
        return new Result(output.toString(), blocked);
    }
}
