package io.github.garries420.violetwire;

import android.os.Handler;
import android.os.Looper;
import java.net.URI;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

/** One bounded monitor per ad break. The direct media feed remains the source
 * of truth while temporary proxy playback uses only a public channel name. */
final class AdFallbackController {
    interface Listener { void proxy(String url); void direct(); }
    interface Transport { String fetch(String url) throws Exception; }
    static final String[] HOSTS = { "eu.luminous.dev", "eu2.luminous.dev", "eu3.luminous.dev", "lb-eu.cdn-perfprod.com", "lb-eu2.cdn-perfprod.com", "lb-eu3.cdn-perfprod.com" };
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final ExecutorService proxies = Executors.newSingleThreadExecutor();
    private final Listener listener;
    private final TwitchAdFilter filter = new TwitchAdFilter();
    private final AdFallbackState state = new AdFallbackState();
    private final String channel;
    private final Transport transport;
    private final long interval;
    private volatile String mediaUrl;
    private volatile boolean closed;
    private boolean begun;
    private int nextProxy;
    private long beganAt;
    AdFallbackController(String channel, Listener listener) { this(channel, listener, AdFallbackController::fetch, 2000); }
    AdFallbackController(String channel, Listener listener, Transport transport, long interval) { this.channel = channel; this.listener = listener; this.transport = transport; this.interval = interval; }
    void begin(String url, String playlist) {
        if (closed) return;
        if (begun) { mediaUrl = url; return; }
        if (!filter.filter(playlist).blocked) return;
        mediaUrl = url;
        begun = true;
        beganAt = System.nanoTime();
        state.observe(playlist, true);
        // Monitoring continues even if every proxy is unavailable, so an
        // ended ad cannot leave the direct stream permanently blocked.
        worker.scheduleWithFixedDelay(this::monitor, interval, interval, TimeUnit.MILLISECONDS);
        proxies.execute(this::nextProxy);
    }
    void retry() {
        if (closed || !begun) return;
        try { proxies.execute(this::nextProxy); }
        catch (RejectedExecutionException stopped) { if (!closed) throw stopped; }
    }
    private void nextProxy() {
        while (!closed && nextProxy < HOSTS.length) {
            String url = "https://" + HOSTS[nextProxy++] + "/live/" + channel + "?allow_source=true&allow_audio_only=true&fast_bread=true&supported_codecs=h264,h265,av1";
            try {
                String playlist = transport.fetch(url);
                if (!playlist.startsWith("#EXTM3U") || (!playlist.contains("#EXT-X-STREAM-INF:") && !playlist.contains("#EXTINF:")) || new TwitchAdFilter().filter(playlist).blocked) continue;
                main.post(() -> { if (!closed) listener.proxy(url); }); return;
            } catch (Exception ignored) { /* Try the next known provider. */ }
        }
    }
    private void monitor() {
        if (closed) return;
        if (System.nanoTime() - beganAt > TimeUnit.MINUTES.toNanos(5)) {
            main.post(() -> { if (!closed) { close(); listener.direct(); } }); return;
        }
        try {
            String playlist = transport.fetch(mediaUrl);
            if (!playlist.startsWith("#EXTM3U")) return;
            if (state.observe(playlist, filter.filter(playlist).blocked)) {
                main.post(() -> { if (!closed) { close(); listener.direct(); } });
            }
        } catch (Exception ignored) { /* A failed probe does not mean the ad ended. */ }
    }
    static String fetch(String address) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects <= 4; redirects++) {
            if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null) throw new java.io.IOException("Invalid playlist URL");
            HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
            connection.setConnectTimeout(4000); connection.setReadTimeout(4000); connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false); connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept", "application/vnd.apple.mpegurl");
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { String location = connection.getHeaderField("Location"); if (location == null) throw new java.io.IOException("No redirect"); url = new URI(url.toString()).resolve(location).toURL(); continue; }
                if (status != 200) throw new java.io.IOException("Playlist unavailable");
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] bytes = new byte[8192]; int count;
                    while ((count = input.read(bytes)) != -1) { if (output.size() + count > 1024 * 1024) throw new java.io.IOException("Playlist too large"); output.write(bytes, 0, count); }
                    return output.toString(StandardCharsets.UTF_8.name());
                }
            } finally { connection.disconnect(); }
        }
        throw new java.io.IOException("Too many redirects");
    }
    void close() { closed = true; worker.shutdownNow(); proxies.shutdownNow(); main.removeCallbacksAndMessages(null); }
}
