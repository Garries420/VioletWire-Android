package io.github.garries420.violetwire;

import android.net.Uri;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.ByteArrayDataSource;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.TransferListener;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** Reuse only this viewing session's multivariant manifest when returning from
 * an ad proxy. Re-fetching Usher creates a fresh session and another preroll.
 * Media playlists, segments, keys and proxy responses are always fetched live. */
@androidx.annotation.OptIn(markerClass = UnstableApi.class)
final class TwitchPlaybackSession implements DataSource.Factory {
    private final String source;
    private byte[] master;
    private Uri masterUri;
    private int requests, reuses;
    TwitchPlaybackSession(String source) { this.source = source; }
    synchronized int requests() { return requests; }
    synchronized int reuses() { return reuses; }
    @Override public DataSource createDataSource() { return new Reader(); }
    private final class Reader implements DataSource {
        private final DataSource http = new DefaultHttpDataSource.Factory().createDataSource();
        private DataSource active;
        private ByteArrayOutputStream capture;
        @Override public void addTransferListener(TransferListener listener) { http.addTransferListener(listener); }
        @Override public long open(DataSpec spec) throws IOException {
            boolean original = spec.uri.toString().equals(source) && spec.position == 0 && spec.length == C.LENGTH_UNSET && spec.httpMethod == DataSpec.HTTP_METHOD_GET;
            DataSpec effective = spec;
            synchronized (TwitchPlaybackSession.this) {
                if (original && master != null) { active = new ByteArrayDataSource(master); effective = spec.withUri(masterUri); reuses++; }
                else { active = http; if (original) { capture = new ByteArrayOutputStream(); requests++; } }
            }
            return active.open(effective);
        }
        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = active.read(buffer, offset, length);
            if (capture != null) {
                if (count > 0 && capture.size() + count <= 1024 * 1024) capture.write(buffer, offset, count);
                else if (count == C.RESULT_END_OF_INPUT) {
                    byte[] bytes = capture.toByteArray();
                    String text = new String(bytes, StandardCharsets.UTF_8);
                    if (text.startsWith("#EXTM3U") && text.contains("#EXT-X-STREAM-INF:")) {
                        synchronized (TwitchPlaybackSession.this) { master = bytes; masterUri = active.getUri(); }
                    }
                    capture = null;
                } else if (count > 0) capture = null;
            }
            return count;
        }
        @Override public Uri getUri() { return active == null ? null : active.getUri(); }
        @Override public Map<String, List<String>> getResponseHeaders() { return active == null ? java.util.Collections.emptyMap() : active.getResponseHeaders(); }
        @Override public void close() throws IOException { try { if (active != null) active.close(); } finally { active = null; capture = null; } }
    }
}
