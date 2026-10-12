package io.github.garries420.violetwire;

import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.hls.playlist.DefaultHlsPlaylistParserFactory;
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParserFactory;
import androidx.media3.exoplayer.upstream.ParsingLoadable;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

@OptIn(markerClass = UnstableApi.class)
final class TwitchPlaylistParserFactory implements HlsPlaylistParserFactory {
    interface Listener { void adBreak(boolean blocked); }
    interface Observer { void playlist(Uri uri, String text, boolean blocked); }
    private final DefaultHlsPlaylistParserFactory delegate = new DefaultHlsPlaylistParserFactory();
    private final TwitchAdFilter filter = new TwitchAdFilter();
    private final Listener listener;
    private final Observer observer;
    private final boolean lowLatency;
    TwitchPlaylistParserFactory(Listener listener) { this(listener, null); }
    TwitchPlaylistParserFactory(Listener listener, Observer observer) { this(listener, observer, false); }
    TwitchPlaylistParserFactory(Listener listener, Observer observer, boolean lowLatency) { this.listener = listener; this.observer = observer; this.lowLatency = lowLatency; }
    private ParsingLoadable.Parser<HlsPlaylist> wrap(ParsingLoadable.Parser<HlsPlaylist> parser) {
        return (Uri uri, java.io.InputStream input) -> {
            String host = uri.getHost();
            boolean twitch = host != null && (host.equals("ttvnw.net") || host.endsWith(".ttvnw.net") || host.equals("twitch.tv") || host.endsWith(".twitch.tv") || host.endsWith(".luminous.dev") || host.endsWith(".cdn-perfprod.com"));
            if (!twitch && !lowLatency) return parser.parse(uri, input);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int length;
            while ((length = input.read(buffer)) != -1) {
                if (bytes.size() + length > 1024 * 1024) throw new java.io.IOException("Playlist too large");
                bytes.write(buffer, 0, length);
            }
            String text = bytes.toString(StandardCharsets.UTF_8.name());
            TwitchAdFilter.Result result = twitch ? filter.filter(text, lowLatency) : new TwitchAdFilter.Result(text, false);
            HlsPlaylist playlist = parser.parse(uri, new ByteArrayInputStream(result.playlist.getBytes(StandardCharsets.UTF_8)));
            if (playlist instanceof HlsMediaPlaylist) {
                HlsMediaPlaylist media = (HlsMediaPlaylist) playlist;
                if (lowLatency && !media.hasEndTag && media.playlistType == HlsMediaPlaylist.PLAYLIST_TYPE_UNKNOWN) {
                    long reloadDurationUs = media.targetDurationUs;
                    if (twitch && text.contains("#EXT-X-TWITCH-PREFETCH:") && media.partTargetDurationUs == androidx.media3.common.C.TIME_UNSET) {
                        // Twitch advertises a 6s upper bound for its usual 2s
                        // fragments. Media3 otherwise polls every 6s and starves
                        // near the live edge. This local scheduling field uses
                        // half the observed fragment length (at least 1s), so
                        // reduce stalls caused by the phase of the first poll.
                        // Segment durations and timestamps remain unchanged.
                        long longest = 0;
                        for (HlsMediaPlaylist.Segment segment : media.segments) longest = Math.max(longest, segment.durationUs);
                        if (longest > 0) reloadDurationUs = Math.min(reloadDurationUs, Math.max(1000000, longest / 2));
                    }
                    // Keep segment timing and DRM intact; avoid boundary rounding.
                    playlist = new HlsMediaPlaylist(media.playlistType, media.baseUri, media.tags,
                        androidx.media3.common.C.TIME_UNSET, true, media.startTimeUs, media.hasDiscontinuitySequence,
                        media.discontinuitySequence, media.mediaSequence, media.version, reloadDurationUs,
                        media.partTargetDurationUs, media.hasIndependentSegments, media.hasEndTag, media.hasProgramDateTime,
                        media.protectionSchemes, media.segments, media.trailingParts, media.serverControl,
                        media.renditionReports, media.interstitials, media.lastSeenInitSegment);
                }
                if (twitch) { listener.adBreak(result.blocked); if (observer != null) observer.playlist(uri, text, result.blocked); }
            }
            return playlist;
        };
    }
    @Override public ParsingLoadable.Parser<HlsPlaylist> createPlaylistParser() { return wrap(delegate.createPlaylistParser()); }
    @Override public ParsingLoadable.Parser<HlsPlaylist> createPlaylistParser(HlsMultivariantPlaylist master, @Nullable HlsMediaPlaylist previous) {
        return wrap(delegate.createPlaylistParser(master, previous));
    }
}
