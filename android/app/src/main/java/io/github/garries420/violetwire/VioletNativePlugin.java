package io.github.garries420.violetwire;

import android.app.UiModeManager;
import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.content.Context;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import androidx.annotation.OptIn;
import androidx.annotation.RequiresApi;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.TreeMap;
import android.app.KeyguardManager;
import android.os.PowerManager;
import android.view.MotionEvent;
import android.app.AlertDialog;
import android.app.Dialog;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.ImageButton;
import android.graphics.drawable.GradientDrawable;
import androidx.media3.ui.AspectRatioFrameLayout;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import androidx.media3.common.Format;
import androidx.media3.common.TrackSelectionOverride;

@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "VioletNative")
public class VioletNativePlugin extends Plugin {
    private SecureTokenStore tokenStore;
    private AccountBrowser accountBrowser;
    private ReplayBrowser replayBrowser;
    private ExoPlayer player;
    private StreamControls controls;
    private boolean miniSurface;
    private boolean fullscreenActive;
    private int resizeMode;
    private Dialog volumeDialog;
    private TextView adNotice;
    private boolean adBlocked;
    private boolean pendingAdResume;
    private int sourceGeneration;
    private boolean adProxyFallback = true;
    private String playbackChannel;
    private String activeProxy;
    private AdFallbackController adFallback;
    private String channelName = "Stream";
    private long viewerCount;
    private long streamStartedAt;
    private boolean followed, subscribed, followPending;
    private boolean pipActive;
    private boolean enteredPip;
    private boolean stopped;
    private PlayerView view;
    private String source;
    private boolean vodPlayback;
    private String downloadId;
    EmoteImageCache.Image savedArtwork(String address) throws Exception { return downloadId == null ? null : VodDownloads.get(getContext()).savedImage(downloadId, address); }
    private String selectedQuality = "best";
    private String requestedQuality = "best";
    private float volume = 1f;
    private boolean muted;
    private boolean userPaused;
    private boolean television;
    private boolean surfaceVisible;
    private String playbackError;
    private int targetOffsetMs = 2500;
    private int controlsHideDelay = 5000;
    private PlayerDiagnostics diagnostics;
    private long droppedFrames, stalls, liveResyncs, lastLiveResyncMs;
    private int previousPlaybackState = Player.STATE_IDLE;
    private boolean pendingLiveResync;
    private boolean playedOnce;
    private final Handler statsHandler = new Handler(Looper.getMainLooper());
    private final Runnable statsTick = new Runnable() {
        public void run() { if (player == null) return; if (controls != null) { controls.latency(latencyLabel()); controls.timeline(vodPlayback, player.getCurrentPosition(), player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration()); } statsHandler.postDelayed(this, 1000); }
    };
    private float surfaceX, surfaceY, surfaceWidth = 1f, surfaceHeight = 1f, viewportWidth = 1f;

    @Override public void load() {
        tokenStore = new SecureTokenStore(getContext());
        accountBrowser = new AccountBrowser(getActivity());
        replayBrowser = new ReplayBrowser(getActivity());
        VodDownloads.get(getContext());
        UiModeManager mode = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
        television = mode != null && mode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        resizeMode = getContext().getSharedPreferences("player", Context.MODE_PRIVATE).getInt("resizeMode", 0);
        if (resizeMode < 0 || resizeMode > 2) resizeMode = 0;
    }

    @PluginMethod public void deviceInfo(PluginCall call) {
        JSObject result = new JSObject(); result.put("television", television); call.resolve(result);
    }

    @PluginMethod public void configure(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            controlsHideDelay = Math.max(1000, Math.min(10000, call.getInt("controlsHideDelay", 5000)));
            int nextOffset = Math.max(2000, Math.min(10000, call.getInt("targetOffsetMs", 2500)));
            if (controls != null) controls.hideDelay(controlsHideDelay);
            if (view != null) view.setControllerShowTimeoutMs(controlsHideDelay);
            PlaybackService.compression(call.getBoolean("audioCompression", false));
            if (controls != null) controls.compression(PlaybackService.compression());
            report();
            adProxyFallback = call.getBoolean("adProxyFallback", true);
            if (!adProxyFallback && adFallback != null) { stopAdFallback(); activeProxy = null; if (player != null && source != null) { player.setMediaSource(mediaSource()); applyQuality(); player.prepare(); player.setPlayWhenReady(!userPaused); } }
            if (!vodPlayback && nextOffset != targetOffsetMs && player != null && source != null && playbackError == null) {
                targetOffsetMs = nextOffset;
                // HlsMediaSource cannot update a changed live configuration in
                // place. Rebuild with our parser factory so local ad filtering
                // survives this reconnect instead of using ExoPlayer's default.
                player.setMediaSource(mediaSource());
                applyQuality(); player.prepare(); player.setPlayWhenReady(!userPaused);
            }
            targetOffsetMs = nextOffset;
            boolean dataSaver = call.getBoolean("dataSaver", false);
            ((MainActivity) getActivity()).emoteCache().dataSaver(dataSaver);
            getContext().getSharedPreferences("image-cache", Context.MODE_PRIVATE).edit().putBoolean("dataSaver", dataSaver).apply();
            call.resolve();
        });
    }
    void keyboardVisibilityChanged(boolean visible) {
        // Keep visibility independent of WebView focus: Android Back hides the
        // IME while leaving the editable focused.
        notifyListeners("keyboardVisibility", new JSObject().put("visible", visible), true);
    }
    @PluginMethod public void keyboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            var web = getBridge().getWebView();
            var insets = WindowCompat.getInsetsController(getActivity().getWindow(), web);
            if (call.getBoolean("visible", false)) {
                web.requestFocus();
                // JS has focused the editable before this bridge call. Post the
                // IME request so WebView can establish that input connection.
                web.post(() -> { insets.show(WindowInsetsCompat.Type.ime()); call.resolve(); });
            } else { insets.hide(WindowInsetsCompat.Type.ime()); call.resolve(); }
        });
    }
    @PluginMethod public void emoteCacheUsage(PluginCall call) {
        getBridge().execute(() -> {
            try {
                long[] usage = ((MainActivity) getActivity()).emoteCache().usage();
                call.resolve(new JSObject().put("bytes", usage[0]).put("emotes", usage[1]));
            } catch (Exception error) { call.reject("Emote storage could not be measured."); }
        });
    }
    @PluginMethod public void clearEmoteCache(PluginCall call) {
        getBridge().execute(() -> {
            try {
                ((MainActivity) getActivity()).emoteCache().clear();
                getActivity().runOnUiThread(() -> { getBridge().getWebView().clearCache(true); call.resolve(); });
            } catch (Exception error) { call.reject("Emote storage could not be emptied."); }
        });
    }

    @PluginMethod public void openExternal(PluginCall call) {
        String address = call.getString("url", "");
        Uri url = Uri.parse(address);
        if (!"https".equals(url.getScheme()) || url.getHost() == null || url.getAuthority().contains("@")) {
            call.reject("A secure browser address is required."); return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                if (call.getBoolean("browser", false)) {
                    Intent generic = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.example.com/"));
                    generic.addCategory(Intent.CATEGORY_BROWSABLE);
                    android.content.pm.ResolveInfo resolved = getContext().getPackageManager().resolveActivity(generic, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
                    String browserPackage = resolved != null && resolved.activityInfo != null && !"android".equals(resolved.activityInfo.packageName)
                        ? resolved.activityInfo.packageName : CustomTabsClient.getPackageName(getContext(), null);
                    if (browserPackage == null) throw new ActivityNotFoundException();
                    Intent browserIntent = new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(browserPackage);
                    getActivity().startActivity(browserIntent);
                    call.resolve(); return;
                }
                // Launch from MainActivity directly. No blank intermediate controller
                // activity can remain above VioletWire when the authorization tab returns.
                CustomTabsIntent tab = new CustomTabsIntent.Builder().setShowTitle(true).build();
                String browser = CustomTabsClient.getPackageName(getContext(), null);
                if (browser != null) tab.intent.setPackage(browser);
                if (browser != null) tab.launchUrl(getActivity(), url);
                else getActivity().startActivity(new Intent(Intent.ACTION_VIEW, url));
                call.resolve();
            } catch (ActivityNotFoundException error) {
                call.reject("Install or enable a browser to open this page.");
            }
        });
    }

    @PluginMethod public void copyText(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.length() > 4096) { call.reject("Invalid clipboard text."); return; }
        getActivity().runOnUiThread(() -> {
            android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard == null) { call.reject("Android clipboard is unavailable."); return; }
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("VioletWire", text)); call.resolve();
        });
    }

    @PluginMethod public void secureGet(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("value", tokenStore.read(record(call))); call.resolve(result); }
        catch (Exception error) { call.reject("Android protected storage could not read the saved session. Sign out to clear it."); }
    }
    @PluginMethod public void secureSet(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > 32768) { call.reject("Invalid token record"); return; }
        try { tokenStore.write(record(call), value); call.resolve(); }
        catch (Exception error) { call.reject("Android protected storage could not save the session."); }
    }
    @PluginMethod public void secureRemove(PluginCall call) {
        try { tokenStore.remove(record(call)); call.resolve(); }
        catch (Exception error) { call.reject("Android protected storage could not remove the session."); }
    }

    private String record(PluginCall call) {
        String name = call.getString("record", "token");
        if (!name.equals("token") && !name.equals("kick") && !name.equals("twitch-playback")) throw new IllegalArgumentException("Invalid protected record");
        return name;
    }
    @PluginMethod public void authentication(PluginCall call) {
        String provider = call.getString("provider", "twitch"), url = call.getString("url", "");
        if ((!provider.equals("kick") && !provider.equals("twitch")) || !AccountBrowser.allowed(url, provider)) { call.reject("Invalid provider sign-in address."); return; }
        boolean capture = call.getBoolean("capture", false);
        getActivity().runOnUiThread(() -> {
            accountBrowser.open(provider, url, capture, token -> {
                if (capture) call.resolve(new JSObject().put("token", token));
                else notifyListeners("authenticationClosed", new JSObject());
            });
            if (!capture) call.resolve(new JSObject());
        });
    }
    @PluginMethod public void closeAuthentication(PluginCall call) {
        getActivity().runOnUiThread(() -> { accountBrowser.close(); call.resolve(); });
    }
    @PluginMethod public void clearWebsiteSession(PluginCall call) {
        String provider = call.getString("provider", "");
        if (!provider.equals("kick") && !provider.equals("twitch")) { call.reject("Invalid provider."); return; }
        getActivity().runOnUiThread(() -> { accountBrowser.clear(provider); if (provider.equals("twitch")) { replayBrowser.close(); tokenStore.remove("twitch-replay"); } call.resolve(); });
    }
    @PluginMethod public void kickRequest(PluginCall call) {
        String path = call.getString("path", ""), method = call.getString("method", "GET"), token = call.getString("token", "");
        // Only the authenticated account routes used by this app can run in
        // the provider page. No arbitrary addresses or scripts are accepted.
        boolean publicRead = method.equals("GET") && !path.matches("/api/v2/channels/followed(?:\\?.*)?") && path.matches("/api/(v1/(livestreams|subcategories)|search|v2/channels/[A-Za-z0-9_-]+(?:/(livestream|videos))?)(?:\\?[A-Za-z0-9_%=&.-]+)?");
        boolean accountRoute = !token.isEmpty() && path.matches("/api/(v1/user|v2/channels/followed(?:\\?cursor=[A-Za-z0-9_%.-]+)?|v2/channels/[A-Za-z0-9_-]+(?:/follow)?|v2/messages/send/[0-9]+|v2/channels/[A-Za-z0-9_-]+/me)");
        if ((!publicRead && !accountRoute)
            || !(method.equals("GET") || method.equals("POST") || method.equals("DELETE")) || token.length() > 8192) {
            call.reject("Invalid Kick account request."); return;
        }
        String body = call.getString("body");
        if (body != null && body.length() > 8192) { call.reject("Kick message is too large."); return; }
        getActivity().runOnUiThread(() -> accountBrowser.kickRequest(path, method, body, token, new AccountBrowser.Response() {
            public void complete(JSObject response) { call.resolve(response); }
            public void fail(String message) { call.reject(message); }
        }));
    }

    private void createPlayer() {
        if (player != null) return;
        player = PlaybackService.getPlayer(getContext());
        getContext().startService(new Intent(getContext(), PlaybackService.class));
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        player.setVolume(muted ? 0 : volume);
        droppedFrames = 0; stalls = 0; liveResyncs = 0; lastLiveResyncMs = 0; playedOnce = false; previousPlaybackState = Player.STATE_IDLE; pendingLiveResync = false;
        player.addAnalyticsListener(new androidx.media3.exoplayer.analytics.AnalyticsListener() {
            @Override public void onDroppedVideoFrames(EventTime time, int count, long elapsed) { droppedFrames += count; }
        });
        statsHandler.removeCallbacks(statsTick); statsTick.run();
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int value) {
                boolean recovered = previousPlaybackState == Player.STATE_BUFFERING && playedOnce;
                previousPlaybackState = value;
                if (value == Player.STATE_BUFFERING && playedOnce) stalls++;
                if (value == Player.STATE_READY) {
                    playedOnce = true;
                    long now = android.os.SystemClock.elapsedRealtime();
                    // A genuine underrun can leave old fragments playing behind
                    // chat. Rejoin live once data returns, with a cooldown. User
                    // pauses, VODs and ad/proxy transitions keep their own state.
                    if (recovered && playbackChannel != null && (playbackChannel.matches("[a-z0-9_]{1,25}") || playbackChannel.startsWith("kick:"))
                        && !vodPlayback && !userPaused && !adBlocked && adFallback == null
                        && activeProxy == null && !"chat_only".equals(selectedQuality)
                        && LivePlaybackTuning.shouldResync(targetOffsetMs, player.getCurrentLiveOffset(), now - lastLiveResyncMs)) {
                        pendingLiveResync = true;
                    }
                    tryLiveResync();
                }
            }
            @Override public void onEvents(Player current, Player.Events events) { report(); }
            @Override public void onTimelineChanged(androidx.media3.common.Timeline timeline, int reason) {
                if (pendingAdResume && !userPaused) { pendingAdResume = false; pendingLiveResync = false; player.seekToDefaultPosition(); }
                // Completed-segment Kick feeds can start on an old CDN snapshot.
                // Once a fresh snapshot exposes enough media, recover the chosen
                // live target without reconnecting or disturbing user pauses.
                if (playbackChannel != null && playbackChannel.startsWith("kick:") && !vodPlayback && !userPaused
                    && LivePlaybackTuning.shouldResync(targetOffsetMs, player.getCurrentLiveOffset(),
                        android.os.SystemClock.elapsedRealtime() - lastLiveResyncMs)) pendingLiveResync = true;
                tryLiveResync();
            }
            @Override public void onTracksChanged(Tracks tracks) { applyQuality(); }
            @Override public void onPlayerError(PlaybackException error) {
                if (activeProxy != null && adFallback != null) {
                    activeProxy = null; adBlocked = true;
                    // Keep direct playback filtering active while trying the
                    // next proxy. The independent monitor will return to live.
                    player.setMediaSource(mediaSource()); applyQuality(); player.prepare(); player.setPlayWhenReady(!userPaused);
                    adFallback.retry(); layoutPlayer(); report(); return;
                }
                if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && !userPaused) {
                    player.seekToDefaultPosition(); player.prepare(); return;
                }
                // Do not expose signed playlist URLs, query parameters, or nested network exceptions.
                playbackError = "Media3 playback failed (" + error.getErrorCodeName() + "). Retry the stream.";
                Throwable cause = error.getCause();
                while (cause != null) {
                    if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
                        int code = ((HttpDataSource.InvalidResponseCodeException) cause).responseCode;
                        playbackError = code == 404 ? "Stream is unavailable or offline (HTTP 404)." : "The stream provider refused playback (HTTP " + code + "). Retry or choose another channel.";
                        break;
                    }
                    cause = cause.getCause();
                }
                if (view != null) view.setVisibility(View.GONE);
                report();
            }
            @Override public void onPlayWhenReadyChanged(boolean ready, int reason) {
                if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) userPaused = !ready;
            }
        });
        if (view == null) {
            view = new PlayerView(getContext()) {
                @Override public boolean performClick() {
                    super.performClick();
                    if (!miniSurface && !pipActive && controls != null) {
                        controls.toggle();
                        notifyListeners("playerInteraction", new JSObject());
                    }
                    return true;
                }
            };
            view.setBackgroundColor(Color.BLACK);
            view.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
            view.setKeepScreenOn(true);
            view.setControllerAutoShow(true);
            // The WebView toolbar owns live controls and quality. Media3's
            // generic speed/audio settings menu is inappropriate here.
            view.setUseController(false);
            view.setFocusable(true);
            view.setContentDescription("VioletWire video player");
            view.setFullscreenButtonClickListener(fullscreen -> notifyListeners("fullscreenRequest", new JSObject().put("value", fullscreen)));
            getActivity().addContentView(view, new FrameLayout.LayoutParams(1, 1));
            view.setVisibility(View.GONE);
            adNotice = new TextView(getActivity());
            adNotice.setText("Ad blocked\nWaiting for Twitch to resume the stream");
            adNotice.setTextColor(Color.WHITE); adNotice.setTextSize(14); adNotice.setGravity(Gravity.CENTER);
            adNotice.setBackgroundColor(Color.BLACK); adNotice.setVisibility(View.GONE);
            adNotice.setOnClickListener(v -> { if (controls != null && !miniSurface && !pipActive) { controls.toggle(); notifyListeners("playerInteraction", new JSObject()); } });
            getActivity().addContentView(adNotice, new FrameLayout.LayoutParams(1, 1));
            controls = new StreamControls(getActivity(), new StreamControls.Actions() {
                public void action(String action) {
                    switch (action) {
                        case "pause": userPaused = player.getPlayWhenReady(); player.setPlayWhenReady(!userPaused); break;
                        case "mute": muted = !muted; player.setVolume(muted ? 0 : volume); break;
                        case "volume": showVolumeSheet(); return;
                        case "refresh": refreshLive(); return;
                        case "sizing":
                            resizeMode = (resizeMode + 1) % 3;
                            getContext().getSharedPreferences("player", Context.MODE_PRIVATE).edit().putInt("resizeMode", resizeMode).apply();
                            applySizing();
                            android.widget.Toast.makeText(getContext(), "Video size: " + sizeLabel(), android.widget.Toast.LENGTH_SHORT).show();
                            return;
                        case "settings": showQualityMenu(); return;
                        case "stats": if (diagnostics != null) diagnostics.close(); diagnostics = new PlayerDiagnostics(getActivity(), () -> diagnosticValues()); return;
                        case "fullscreen": notifyListeners("fullscreenRequest", new JSObject().put("value", !fullscreenActive)); return;
                        default: notifyListeners("streamAction", new JSObject().put("action", action)); return;
                    }
                    report();
                }
                public void volume(int value) { volume = value / 100f; muted = value == 0; player.setVolume(volume); report(); }
                public void seek(long position) { if (vodPlayback && player != null) { player.seekTo(position); notifyListeners("vodSeek", new JSObject()); } }
            });
            getActivity().addContentView(controls, new FrameLayout.LayoutParams(1, 1));
            view.setOnTouchListener((v, event) -> {
                if (pipActive) return false;
                if (miniSurface) {
                    float scale = getBridge().getWebView().getWidth() / Math.max(1f, viewportWidth);
                    int[] origin = new int[2]; getBridge().getWebView().getLocationOnScreen(origin);
                    String phase = event.getActionMasked() == MotionEvent.ACTION_DOWN ? "start" :
                        event.getActionMasked() == MotionEvent.ACTION_MOVE ? "move" :
                        event.getActionMasked() == MotionEvent.ACTION_UP ? "end" : "cancel";
                    notifyListeners("surfaceGesture", new JSObject().put("phase", phase)
                        .put("x", (event.getRawX() - origin[0]) / scale).put("y", (event.getRawY() - origin[1]) / scale));
                } else if (event.getActionMasked() == MotionEvent.ACTION_UP) v.performClick();
                return true;
            });
        }
        view.setPlayer(player);
        applySizing();
        layoutPlayer();
        applyQuality();
    }

    @PluginMethod public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !"https".equals(Uri.parse(url).getScheme())) { call.reject("A secure playback URL is required."); return; }
        getActivity().runOnUiThread(() -> {
            stopAdFallback(); activeProxy = null;
            playbackChannel = call.getString("channel", "");
            vodPlayback = call.getBoolean("vod", false); downloadId = call.getString("downloadId");
            source = url; playbackError = null; userPaused = false;
            volume = Math.max(0, Math.min(100, call.getInt("volume", 100))) / 100f;
            selectedQuality = call.getString("quality", "best");
            if(vodPlayback && "best".equals(selectedQuality))selectedQuality="source";
            requestedQuality = selectedQuality;
            targetOffsetMs = Math.max(2000, Math.min(10000, call.getInt("targetOffsetMs", 2500)));
            controlsHideDelay = Math.max(1000, Math.min(10000, call.getInt("controlsHideDelay", 5000)));
            createPlayer();
            controls.hideDelay(controlsHideDelay);
            view.setControllerShowTimeoutMs(controlsHideDelay);
            player.setVolume(muted ? 0 : volume);
            try { player.setMediaSource(mediaSource()); }
            catch (Exception error) { source = null; call.reject(error.getMessage()); return; }
            applyQuality(); player.prepare(); player.play();
            view.setVisibility(surfaceVisible ? View.VISIBLE : View.GONE);
            call.resolve(); report();
        });
    }

    private void tryLiveResync() {
        if (!pendingLiveResync) return;
        if (player == null || vodPlayback || userPaused || !player.getPlayWhenReady() || adBlocked || adFallback != null
            || activeProxy != null || "chat_only".equals(selectedQuality) || targetOffsetMs > 3000) {
            pendingLiveResync = false; return;
        }
        if (player.getPlaybackState() != Player.STATE_READY) return;
        long now = android.os.SystemClock.elapsedRealtime();
        long offset = player.getCurrentLiveOffset();
        if (!LivePlaybackTuning.shouldResync(targetOffsetMs, offset, now - lastLiveResyncMs)) { pendingLiveResync = false; return; }
        long position = LivePlaybackTuning.recoveryPositionMs(targetOffsetMs, offset, player.getCurrentPosition(), player.getDuration());
        if (position == C.TIME_UNSET) return;
        pendingLiveResync = false; lastLiveResyncMs = now; liveResyncs++;
        // Keep the session. A master reload may start a new preroll, and the
        // default live position may still belong to a stale playlist snapshot.
        player.seekTo(position);
    }

    private void refreshLive() {
        if (player == null || source == null || vodPlayback) return;
        // A fresh source discards stale buffered segments and fetches the live
        // playlist again. Keep the player, selected quality, volume and chat.
        playbackError = null;
        userPaused = false;
        player.setMediaSource(mediaSource(), true);
        applyQuality();
        player.seekToDefaultPosition();
        player.prepare();
        player.play();
        report();
    }

    private androidx.media3.exoplayer.source.MediaSource mediaSource() {
        int generation = ++sourceGeneration;
        pendingLiveResync = false;
        if (vodPlayback) {
            adBlocked = false; pendingAdResume = false;
            if (downloadId != null) {
                try { androidx.media3.exoplayer.offline.Download saved = VodDownloads.get(getContext()).completed(downloadId);
                    androidx.media3.exoplayer.source.MediaSource hls = new HlsMediaSource.Factory(VodDownloads.get(getContext()).offlineFactory()).createMediaSource(saved.request.toMediaItem());
                    org.json.JSONObject record = VodDownloads.get(getContext()).read(downloadId);
                    if(record!=null)requestedQuality=record.optString("quality","source").equals("Audio only")?"audio_only":record.optString("quality","source");
                    return record != null && record.has("clipStart") ? new androidx.media3.exoplayer.source.ClippingMediaSource(hls, (long)(record.optDouble("clipStart")*1000000), (long)(record.optDouble("clipEnd")*1000000)) : hls;
                } catch (Exception error) { throw new IllegalStateException(error.getMessage()); }
            }
            return new HlsMediaSource.Factory(new DefaultHttpDataSource.Factory()).createMediaSource(new MediaItem.Builder().setUri(source).setMimeType(MimeTypes.APPLICATION_M3U8).build());
        }
        adBlocked = activeProxy != null; pendingAdResume = false;
        MediaItem item = new MediaItem.Builder().setUri(activeProxy == null ? source : activeProxy).setMimeType(MimeTypes.APPLICATION_M3U8)
            .setLiveConfiguration(LivePlaybackTuning.configuration(targetOffsetMs)).build();
        return new HlsMediaSource.Factory(new DefaultHttpDataSource.Factory())
            .setPlaylistParserFactory(new TwitchPlaylistParserFactory(blocked -> getActivity().runOnUiThread(() -> {
                if (generation != sourceGeneration || player == null || source == null) return;
                if (activeProxy != null) {
                    if (blocked && adFallback != null) {
                        activeProxy = null;
                        player.setMediaSource(mediaSource()); applyQuality(); player.prepare(); player.setPlayWhenReady(!userPaused);
                        adFallback.retry(); layoutPlayer(); report();
                    }
                    return;
                }
                boolean resume = adBlocked && !blocked;
                adBlocked = blocked;
                // Return to the same live offset instead of accumulating the
                // duration of a suppressed break behind chat.
                if (resume && !userPaused) pendingAdResume = true;
                if (resume) stopAdFallback();
                layoutPlayer();
            }), (uri, text, blocked) -> getActivity().runOnUiThread(() -> {
                if (generation != sourceGeneration || !blocked || !adProxyFallback || "chat_only".equals(selectedQuality) || activeProxy != null || player == null || source == null || playbackChannel == null || !playbackChannel.matches("[a-z0-9_]{1,25}")) return;
                if (adFallback == null) adFallback = new AdFallbackController(playbackChannel, new AdFallbackController.Listener() {
                    public void proxy(String url) {
                        if (adFallback == null || player == null || source == null || "chat_only".equals(selectedQuality)) return;
                        activeProxy = url; playbackError = null;
                        player.setMediaSource(mediaSource()); applyQuality(); player.prepare(); player.setPlayWhenReady(!userPaused);
                        android.widget.Toast.makeText(getContext(), "Ad fallback · temporary proxy playback", android.widget.Toast.LENGTH_SHORT).show();
                        layoutPlayer(); report();
                    }
                    public void direct() {
                        if (player == null || source == null) return;
                        adFallback = null; activeProxy = null; playbackError = null;
                        player.setMediaSource(mediaSource()); applyQuality(); player.prepare(); player.setPlayWhenReady(!userPaused);
                        layoutPlayer(); report();
                    }
                });
                adFallback.begin(uri.toString(), text);
            }), targetOffsetMs <= 3000)).createMediaSource(item);
    }
    private void stopAdFallback() { if (adFallback != null) adFallback.close(); adFallback = null; }

    @PluginMethod public void bounds(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            surfaceVisible = call.getBoolean("visible", false);
            miniSurface = call.getBoolean("mini", false);
            surfaceX = call.getFloat("x", 0f);
            surfaceY = call.getFloat("y", 0f);
            surfaceWidth = call.getFloat("width", 1f);
            surfaceHeight = call.getFloat("height", 1f);
            viewportWidth = call.getFloat("viewportWidth", 1f);
            layoutPlayer();
            call.resolve();
        });
    }

    private void layoutPlayer() {
            if (view != null) {
                if (pipActive) {
                    view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
                    FrameLayout.LayoutParams fill = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
                    view.setLayoutParams(fill);
                    view.setVisibility(View.VISIBLE);
                    if (adNotice != null) { adNotice.setLayoutParams(new FrameLayout.LayoutParams(fill)); adNotice.setVisibility(adBlocked && activeProxy == null ? View.VISIBLE : View.GONE); }
                    if (controls != null) controls.dismiss();
                    return;
                }
                applySizing();
                // Bounds may arrive while the provider resolves, before PlayerView exists.
                // Reapply the saved geometry when creating or restoring the native surface.
                float scale = getBridge().getWebView().getWidth() / Math.max(1f, viewportWidth);
                int[] location = new int[2]; getBridge().getWebView().getLocationInWindow(location);
                int[] parentLocation = new int[2]; ((View) view.getParent()).getLocationInWindow(parentLocation);
                FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                    Math.max(1, Math.round(surfaceWidth * scale)),
                    Math.max(1, Math.round(surfaceHeight * scale)));
                params.leftMargin = location[0] - parentLocation[0] + Math.round(surfaceX * scale);
                params.topMargin = location[1] - parentLocation[1] + Math.round(surfaceY * scale);
                view.setLayoutParams(params);
                if (adNotice != null) {
                    adNotice.setLayoutParams(new FrameLayout.LayoutParams(params));
                    adNotice.setVisibility(adBlocked && activeProxy == null && surfaceVisible && playbackError == null && !"chat_only".equals(selectedQuality) ? View.VISIBLE : View.GONE);
                }
                if (controls != null) {
                    controls.setLayoutParams(new FrameLayout.LayoutParams(params));
                    androidx.core.graphics.Insets safe = getActivity() instanceof MainActivity ? ((MainActivity) getActivity()).playerSafeInsets() : androidx.core.graphics.Insets.NONE;
                    View parent = (View) view.getParent();
                    controls.setPadding(Math.max(0, safe.left - params.leftMargin), Math.max(0, safe.top - params.topMargin),
                        Math.max(0, safe.right - (parent.getWidth() - params.leftMargin - params.width)),
                        Math.max(0, safe.bottom - (parent.getHeight() - params.topMargin - params.height)));
                    if (!surfaceVisible || miniSurface || source == null || playbackError != null) {
                        controls.dismiss();
                        if (volumeDialog != null) volumeDialog.dismiss();
                    }
                    else if ("chat_only".equals(selectedQuality)) controls.reveal();
                }
                view.setVisibility(surfaceVisible && source != null && playbackError == null ? View.VISIBLE : View.GONE);
                updatePictureInPicture();
            }
    }

    @PluginMethod public void focusPlayer(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (view != null && view.getVisibility() == View.VISIBLE) { view.requestFocus(); view.showController(); } call.resolve(); });
    }
    void windowInsetsChanged() { layoutPlayer(); }

    @PluginMethod public void fullscreen(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean value = call.getBoolean("value", false);
            fullscreenActive = value;
            if (controls != null) controls.fullscreen(value);
            if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).setPlayerFullscreen(value);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getActivity().getWindow(), getBridge().getWebView());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (value) controller.hide(WindowInsetsCompat.Type.systemBars()); else controller.show(WindowInsetsCompat.Type.systemBars());
            call.resolve();
        });
    }

    private String sizeLabel() { return new String[]{"Fit", "Fill", "Stretch"}[resizeMode]; }
    private void applySizing() {
        if (view != null) view.setResizeMode(miniSurface || pipActive ? AspectRatioFrameLayout.RESIZE_MODE_FIT :
            resizeMode == 1 ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM :
            resizeMode == 2 ? AspectRatioFrameLayout.RESIZE_MODE_FILL : AspectRatioFrameLayout.RESIZE_MODE_FIT);
        if (controls != null) controls.sizing(sizeLabel());
    }
    private int dp(int value) { return Math.round(value * getContext().getResources().getDisplayMetrics().density); }
    private void showVolumeSheet() {
        if (volumeDialog != null || player == null) return;
        Dialog dialog = new Dialog(getActivity());
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        LinearLayout row = new LinearLayout(getActivity()); row.setGravity(Gravity.CENTER_VERTICAL); row.setPadding(dp(12), dp(12), dp(12), dp(12));
        GradientDrawable background = new GradientDrawable(); background.setColor(0xff241e2a); background.setCornerRadii(new float[]{dp(24), dp(24), dp(24), dp(24), 0, 0, 0, 0}); row.setBackground(background);
        ImageButton muteButton = new ImageButton(getActivity()); muteButton.setBackgroundColor(Color.TRANSPARENT); muteButton.setPadding(dp(10), dp(10), dp(10), dp(10));
        row.addView(muteButton, new LinearLayout.LayoutParams(dp(48), dp(48)));
        SeekBar slider = new SeekBar(getActivity()); slider.setMax(100); slider.setContentDescription("Stream volume");
        slider.setProgressDrawable(androidx.appcompat.content.res.AppCompatResources.getDrawable(getContext(), R.drawable.player_volume_track));
        slider.setThumb(androidx.appcompat.content.res.AppCompatResources.getDrawable(getContext(), R.drawable.player_volume_thumb));
        slider.setProgress(muted ? 0 : Math.round(volume * 100));
        slider.setProgressTintList(android.content.res.ColorStateList.valueOf(0xffc4b5fd)); slider.setThumbTintList(android.content.res.ColorStateList.valueOf(0xffc4b5fd));
        row.addView(slider, new LinearLayout.LayoutParams(0, dp(56), 1));
        TextView number = new TextView(getActivity()); number.setTextColor(Color.WHITE); number.setTextSize(20); number.setGravity(Gravity.CENTER);
        row.addView(number, new LinearLayout.LayoutParams(dp(54), dp(48)));
        Runnable update = () -> {
            number.setText(String.valueOf(muted ? 0 : Math.round(volume * 100)));
            muteButton.setImageResource(muted ? R.drawable.player_muted : R.drawable.player_volume);
            muteButton.setContentDescription(muted ? "Unmute stream" : "Mute stream");
        };
        update.run();
        muteButton.setOnClickListener(v -> {
            muted = !muted;
            if (!muted && volume == 0) volume = 1f;
            player.setVolume(muted ? 0 : volume); slider.setProgress(muted ? 0 : Math.round(volume * 100)); update.run(); report();
        });
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar bar, int value, boolean fromUser) {
                if (!fromUser) return;
                volume = value / 100f; muted = value == 0; player.setVolume(volume); update.run(); report();
            }
            public void onStartTrackingTouch(SeekBar bar) {}
            public void onStopTrackingTouch(SeekBar bar) {}
        });
        dialog.setContentView(row); row.setContentDescription("Stream volume");
        android.view.Window window = dialog.getWindow();
        if (window != null) { window.setBackgroundDrawableResource(android.R.color.transparent); window.setDimAmount(0.15f); window.setGravity(Gravity.BOTTOM); }
        volumeDialog = dialog;
        dialog.setOnDismissListener(d -> { volumeDialog = null; if (controls != null && surfaceVisible && !pipActive && !miniSurface) controls.reveal(); });
        dialog.show();
        if (window != null && fullscreenActive) WindowCompat.getInsetsController(window, row).hide(WindowInsetsCompat.Type.systemBars());
        if (window != null) window.setLayout(Math.min(getBridge().getWebView().getWidth(), dp(900)), ViewGroup.LayoutParams.WRAP_CONTENT);
        controls.dismiss();
    }

    @PluginMethod public void control(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player == null) { call.resolve(); return; }
            switch (call.getString("command", "")) {
                case "toggle-pause": userPaused = player.getPlayWhenReady(); player.setPlayWhenReady(!userPaused); break;
                case "toggle-mute": muted = !muted; player.setVolume(muted ? 0 : volume); break;
                case "set-muted": muted = call.getBoolean("muted", false); player.setVolume(muted ? 0 : volume); break;
                case "set-volume": volume = Math.max(0, Math.min(100, call.getInt("value", 100))) / 100f; player.setVolume(muted ? 0 : volume); break;
                case "go-live": player.seekToDefaultPosition(); userPaused = false; player.play(); break;
                case "set-compressor": PlaybackService.compression(call.getBoolean("enabled", false)); if (controls != null) controls.compression(PlaybackService.compression()); break;
                default: call.reject("Unknown player command"); return;
            }
            report(); call.resolve();
        });
    }

    private String qualityName(Format format) {
        return format.height + "p" + (format.frameRate > 0 ? Math.round(format.frameRate) : "");
    }
    private TreeMap<String, String> availableQualities() {
        TreeMap<String, String> items = new TreeMap<>((a, b) -> {
            String[] x = a.split("p"), y = b.split("p");
            int height = Integer.compare(Integer.parseInt(y[0]), Integer.parseInt(x[0]));
            return height != 0 ? height : Integer.compare(y.length > 1 ? Integer.parseInt(y[1]) : 0, x.length > 1 ? Integer.parseInt(x[1]) : 0);
        });
        if (player != null) for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() == C.TRACK_TYPE_VIDEO) for (int index = 0; index < group.length; index++) {
                Format format = group.getTrackFormat(index);
                if (group.isTrackSupported(index) && format.height > 0) items.put(qualityName(format), qualityName(format));
            }
        }
        return items;
    }
    private void applyQuality() {
        if (player == null) return;
        TreeMap<String, String> qualities = availableQualities();
        selectedQuality = SavedVodQuality.resolve(requestedQuality, vodPlayback && downloadId != null, qualities);
        selectedQuality = StreamQuality.resolve(selectedQuality, qualities);
        if(vodPlayback && ("source".equals(selectedQuality)||"best".equals(selectedQuality)) && !qualities.isEmpty()) selectedQuality=qualities.firstKey();
        TrackSelectionParameters.Builder builder = player.getTrackSelectionParameters().buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, "audio_only".equals(selectedQuality) || "chat_only".equals(selectedQuality))
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, "chat_only".equals(selectedQuality))
            .setMaxVideoSize(Integer.MAX_VALUE, Integer.MAX_VALUE).setMaxVideoFrameRate(Integer.MAX_VALUE)
            .setForceHighestSupportedBitrate(false).setForceLowestBitrate(false);
        if ("source".equals(selectedQuality)) builder.setForceHighestSupportedBitrate(true);
        else if ("worst".equals(selectedQuality)) builder.setForceLowestBitrate(true);
        else if (selectedQuality.matches("\\d{2,4}p(?:\\d{2,3})?")) {
            String[] parts = selectedQuality.split("p");
            builder.setMaxVideoSize(Integer.MAX_VALUE, Integer.parseInt(parts[0]));
            if (parts.length > 1) builder.setMaxVideoFrameRate(Integer.parseInt(parts[1]));
            Tracks.Group chosen = null; int track = -1, bitrate = -1;
            for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
                if (group.getType() != C.TRACK_TYPE_VIDEO) continue;
                for (int i = 0; i < group.length; i++) {
                    Format format = group.getTrackFormat(i);
                    if (group.isTrackSupported(i) && qualityName(format).equals(selectedQuality) && (chosen == null || format.bitrate > bitrate)) {
                        chosen = group; track = i; bitrate = format.bitrate;
                    }
                }
            }
            if (chosen != null) builder.setOverrideForType(new TrackSelectionOverride(chosen.getMediaTrackGroup(), track));
        }
        player.setTrackSelectionParameters(builder.build());
    }
    private void chooseQuality(String value) {
        if(vodPlayback && "best".equals(value))value=availableQualities().isEmpty()?"source":availableQualities().firstKey();
        selectedQuality = value;
        requestedQuality = value;
        if ("chat_only".equals(value) && adFallback != null) {
            stopAdFallback(); boolean proxyWasActive = activeProxy != null; activeProxy = null;
            if (proxyWasActive && player != null && source != null) { player.setMediaSource(mediaSource()); player.prepare(); player.setPlayWhenReady(!userPaused); }
        }
        applyQuality(); report();
        notifyListeners("viewMode", new JSObject().put("chatOnly", "chat_only".equals(value)));
    }
    @PluginMethod public void quality(PluginCall call) {
        String value = call.getString("value", "best");
        if (!value.matches("best|source|worst|audio_only|chat_only|\\d{2,4}p(?:\\d{2,3})?")) { call.reject("Unsupported quality"); return; }
        getActivity().runOnUiThread(() -> { chooseQuality(value); call.resolve(); });
    }
    @PluginMethod public void qualities(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSArray items = new JSArray(); if(!vodPlayback)items.put(new JSObject().put("value", "best").put("label", "Auto"));
            for (String value : availableQualities().keySet()) items.put(new JSObject().put("value", value).put("label", value));
            items.put(new JSObject().put("value", "audio_only").put("label", "Audio only"));
            items.put(new JSObject().put("value", "chat_only").put("label", "Chat only"));
            call.resolve(new JSObject().put("items", items));
        });
    }
    private void showQualityMenu() {
        java.util.ArrayList<String> values = new java.util.ArrayList<>(); if(!vodPlayback)values.add("best");
        values.addAll(availableQualities().keySet()); values.add("audio_only"); values.add("chat_only");
        java.util.ArrayList<String> labels = new java.util.ArrayList<>(); if(!vodPlayback)labels.add("Auto");
        labels.addAll(availableQualities().values()); labels.add("Audio only"); labels.add("Chat only");
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(getActivity(), android.R.layout.simple_list_item_single_choice, labels) {
            @Override public View getView(int position, View convertView, ViewGroup parent) {
                TextView text = (TextView) super.getView(position, convertView, parent); text.setTextColor(Color.WHITE); return text;
            }
        };
        AlertDialog dialog = new AlertDialog.Builder(getActivity(), android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Stream settings")
            .setSingleChoiceItems(adapter, values.indexOf(selectedQuality), (d, which) -> { chooseQuality(values.get(which)); d.dismiss(); controls.reveal(); })
            .setNeutralButton("Picture-in-picture", (d, which) -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && canEnterPip()) getActivity().enterPictureInPictureMode(pipParams());
            }).setNegativeButton("Close", null).create();
        dialog.show(); controls.dismiss();
        dialog.setOnDismissListener(d -> { if (surfaceVisible && !miniSurface && !pipActive) controls.reveal(); });
    }
    @PluginMethod public void metadata(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            streamStartedAt = call.getLong("startedAt", 0L);
            channelName = call.getString("channel", "Stream"); viewerCount = call.getInt("viewers", 0);
            followed = call.getBoolean("followed", false); subscribed = call.getBoolean("subscribed", false); followPending = call.getBoolean("pending", false);
            if (controls != null) { controls.chatVisible(call.getBoolean("chatVisible", true)); controls.metadata(channelName, viewerCount, followed, subscribed, followPending); controls.startedAt(vodPlayback ? 0 : streamStartedAt); }
            call.resolve();
        });
    }

    @PluginMethod public void stats(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject().put("engine", "AndroidX Media3")
                .put("playing", String.valueOf(player != null && player.isPlaying()))
                .put("positionMs", String.valueOf(player == null ? 0 : player.getCurrentPosition()))
                .put("quality", selectedQuality)
                .put("adPlayback", activeProxy == null ? adBlocked ? "blocked" : "direct" : "proxy")
                .put("controlsHideDelayMs", String.valueOf(controlsHideDelay))
                .put("targetLiveOffsetMs", String.valueOf(targetOffsetMs))
                .put("mediaTargetLiveOffsetMs", String.valueOf(player == null || player.getCurrentMediaItem() == null ? 0 : player.getCurrentMediaItem().liveConfiguration.targetOffsetMs));
            Format format = player == null ? null : player.getVideoFormat();
            if (format != null) result.put("video", qualityName(format));
            result.put("durationMs", String.valueOf(player == null || player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration()));
            for (java.util.Map.Entry<String, String> row : diagnosticValues().entrySet()) result.put(row.getKey(), row.getValue());
            call.resolve(result);
        });
    }
    private String latencyLabel() { if (vodPlayback) return "VOD"; long offset = player == null ? C.TIME_UNSET : player.getCurrentLiveOffset(); return offset == C.TIME_UNSET ? "—" : String.format(java.util.Locale.ROOT, "%.2fs", offset / 1000d); }
    private java.util.Map<String, String> diagnosticValues() {
        java.util.Map<String, String> values = new java.util.LinkedHashMap<>();
        Format video = player == null ? null : player.getVideoFormat();
        values.put("Latency", latencyLabel()); values.put("Latency mode", vodPlayback ? "VOD" : targetOffsetMs <= 3000 ? "Low latency" : "Normal latency");
        values.put("Resolution", video != null && video.width > 0 ? video.width + " × " + video.height : "—");
        values.put("Framerate", video != null && video.frameRate > 0 ? String.format(java.util.Locale.ROOT, "%.0f", video.frameRate) : "—");
        values.put("Bitrate", video != null && video.bitrate > 0 ? video.bitrate / 1000 + " kbps" : "—");
        values.put("Dropped frames", String.valueOf(droppedFrames));
        values.put("Playback rate", String.format(java.util.Locale.ROOT, "%.2f×", player == null ? 1 : player.getPlaybackParameters().speed));
        values.put("Buffer size", String.format(java.util.Locale.ROOT, "%.2fs", player == null ? 0 : player.getTotalBufferedDuration() / 1000d));
        values.put("Rebuffers", String.valueOf(stalls));
        values.put("Live recoveries", String.valueOf(liveResyncs));
        long liveTarget = PlaybackService.liveTargetOffsetMs();
        values.put("Live target", vodPlayback ? "VOD" : liveTarget == C.TIME_UNSET ? "—" : String.format(java.util.Locale.ROOT, "%.2fs", liveTarget / 1000d));
        values.put("Media transport", downloadId != null ? "Saved on device" : activeProxy != null ? "Temporary ad proxy" : playbackChannel != null && playbackChannel.startsWith("kick:") ? "Direct Kick CDN" : "Direct Twitch CDN");
        values.put("Audio compressor", PlaybackService.compression() ? "Enabled" : "Disabled");
        values.put("Compressor route", PlaybackService.compressorRoute());
        values.put("Compressor gain", PlaybackService.nativeCompressionActive() ? "Managed by Android multiband effect" : String.format(java.util.Locale.ROOT, "%.1f dB", PlaybackService.compressorGainDb()));
        values.put("PCM fallback frames", String.valueOf(PlaybackService.compressedFrames()));
        values.put("Playback engine", "AndroidX Media3 / ExoPlayer"); return values;
    }
    private void report() {
        if (controls != null) controls.compression(PlaybackService.compression());
        JSObject state = new JSObject();
        String status = playbackError != null ? "error" : player == null ? "idle" :
            player.getPlaybackState() == Player.STATE_READY ? "playing" : player.getPlaybackState() == Player.STATE_ENDED ? "stopped" : "starting";
        state.put("status", status); state.put("paused", userPaused); state.put("muted", muted);
        state.put("vod", vodPlayback);
        state.put("volume", Math.round(volume * 100)); state.put("quality", selectedQuality); state.put("compressorEnabled", PlaybackService.compression());
        state.put("behindLive", !vodPlayback && player != null && player.getCurrentLiveOffset() != C.TIME_UNSET && player.getCurrentLiveOffset() > 10000);
        if (playbackError != null) state.put("error", playbackError);
        if (controls != null) { controls.state(userPaused, muted, Math.round(volume * 100), "chat_only".equals(selectedQuality)); controls.metadata(channelName, viewerCount, followed, subscribed, followPending); controls.startedAt(vodPlayback ? 0 : streamStartedAt); controls.fullscreen(fullscreenActive); }
        notifyListeners("playerState", state);
        updatePictureInPicture();
    }

    private boolean pipSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private boolean canEnterPip() {
        return pipSupported() && source != null && player != null && playbackError == null && surfaceVisible
            && !"audio_only".equals(selectedQuality) && !"chat_only".equals(selectedQuality);
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private PictureInPictureParams pipParams() {
        PictureInPictureParams.Builder params = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9));
        if (view != null && !pipActive) {
            Rect hint = new Rect();
            if (view.getGlobalVisibleRect(hint) && !hint.isEmpty()) params.setSourceRectHint(hint);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) params.setAutoEnterEnabled(canEnterPip()).setSeamlessResizeEnabled(true);
        return params.build();
    }

    private void updatePictureInPicture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !pipSupported() || getActivity().isFinishing()) return;
        getActivity().setPictureInPictureParams(pipParams());
    }

    public void leaveForPictureInPicture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Build.VERSION.SDK_INT < Build.VERSION_CODES.S && canEnterPip()) getActivity().enterPictureInPictureMode(pipParams());
    }

    @PluginMethod public void pictureInPicture(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !canEnterPip()) { call.reject("Picture-in-picture is unavailable on this device or no stream is active."); return; }
            try {
                if (getActivity().enterPictureInPictureMode(pipParams())) call.resolve();
                else call.reject("Enable picture-in-picture for VioletWire in Android app settings.");
            } catch (IllegalStateException error) {
                call.reject("Return to VioletWire before starting picture-in-picture.");
            }
        });
    }

    public void pictureInPictureChanged(boolean active) {
        pipActive = active;
        if (active) enteredPip = true;
        getBridge().getWebView().setVisibility(active ? View.INVISIBLE : View.VISIBLE);
        layoutPlayer();
    }

    private void release() {
        statsHandler.removeCallbacks(statsTick); if (diagnostics != null) diagnostics.close(); diagnostics = null;
        stopAdFallback(); activeProxy = null;
        sourceGeneration++; adBlocked = false; pendingAdResume = false;
        if (adNotice != null) adNotice.setVisibility(View.GONE);
        if (volumeDialog != null) volumeDialog.dismiss();
        if (player != null) { if (view != null) view.setPlayer(null); player = null; PlaybackService.endPlayback(getContext()); }
        if (controls != null) controls.dismiss();
        if (view != null) view.setVisibility(View.GONE);
        getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { source = null; vodPlayback = false; downloadId = null; release(); playbackError = null; report(); call.resolve(); });
    }
    @PluginMethod public void seek(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (!vodPlayback || player == null) { call.reject("No VOD is playing."); return; } double value = call.getDouble("positionMs", 0d); if (!Double.isFinite(value)) { call.reject("Invalid VOD position."); return; } player.seekTo(Math.max(0, (long) value)); notifyListeners("vodSeek", new JSObject()); call.resolve(); });
    }
    @PluginMethod public void vodManifest(PluginCall call) {
        String url = call.getString("url", ""); if (!VodDownloads.mediaUrl(url)) { call.reject("Invalid VOD address."); return; }
        getBridge().execute(() -> { try { call.resolve(new JSObject().put("text", AdFallbackController.fetch(url))); } catch (Exception error) { call.reject("This VOD could not be loaded. It may be unavailable or require a linked Twitch website session."); } });
    }
    @PluginMethod public void prepareReplay(PluginCall call) {
        getActivity().runOnUiThread(() -> replayBrowser.open(call.getBoolean("refresh", false), error -> { if (error == null) call.resolve(); else call.reject(error); }));
    }
    @PluginMethod public void vodComments(PluginCall call) {
        String id = call.getString("id", ""), cursor = call.getString("cursor", ""); int offset = Math.max(0, call.getInt("offset", 0));
        if (!id.matches("[0-9]{1,20}") || cursor.length() > 4096) { call.reject("Invalid VOD replay request."); return; }
        getBridge().execute(() -> {
            try { call.resolve(new JSObject().put("comments", VodNetwork.comments(getContext(), id, cursor, offset))); }
            catch (Exception error) {
                if (error.getMessage() != null && (error.getMessage().toLowerCase(java.util.Locale.ROOT).contains("integrity") || error.getMessage().contains("website connection"))) {
                    getActivity().runOnUiThread(() -> replayBrowser.open(true, failure -> {
                        if (failure != null) { call.reject(failure); return; }
                        getBridge().execute(() -> { try { call.resolve(new JSObject().put("comments", VodNetwork.comments(getContext(), id, cursor, offset))); } catch (Exception retry) { call.reject(retry.getMessage()); } });
                    }));
                } else call.reject(error.getMessage());
            }
        });
    }
    @PluginMethod public void kickVodComments(PluginCall call) {
        JSObject video=call.getObject("video");int offset=call.getInt("offset",0);
        if(video==null||video.toString().length()>8192||offset<0){call.reject("Invalid Kick replay request.");return;}
        getBridge().execute(()->{try{call.resolve(new JSObject().put("comments",KickVodNetwork.comments(video,offset)));}catch(Exception error){call.reject(error.getMessage());}});
    }
    @PluginMethod public void downloadVod(PluginCall call) {
        JSObject video = call.getObject("video"); String url = call.getString("url", ""), quality = call.getString("quality", "source");
        if (video == null || video.toString().length() > 8192 || !VodDownloads.validId(video.optString("id")) || !VodDownloads.mediaUrl(url)) { call.reject("Invalid VOD download."); return; }
        JSObject assets = call.getObject("assets");
        JSObject range = call.getObject("range");
        VodDownloads downloads = VodDownloads.get(getContext());
        getBridge().execute(() -> {
            try {
                double start=range==null?0:range.optDouble("start"),end=range==null?video.optDouble("duration"):range.optDouble("end");
                if(!Double.isFinite(start)||!Double.isFinite(end)||start<0||end<=start||end>video.optDouble("duration"))throw new IllegalArgumentException("Invalid download time range.");
                VodClipPlaylist clip=start>0||end<video.optDouble("duration")?VodClipPlaylist.select(AdFallbackController.fetch(url),url,start,end):null;
                if(downloads.read(video.optString("id"))!=null)throw new IllegalArgumentException("This VOD is already in Downloads. Resume or delete it there.");
                if(clip!=null){downloads.cacheClip(video.optString("id"),clip);video.put("downloadStart",start);video.put("downloadEnd",end);video.put("duration",end-start);}
                getActivity().runOnUiThread(() -> { try { downloads.add(video.optString("id"),url,video,quality,call.getBoolean("chat",true),assets,clip);VodDownloadService.start(getContext());call.resolve(); }catch(Exception error){call.reject(error.getMessage());} });
            }catch(Exception error){call.reject(error.getMessage());}
        });
    }
    @PluginMethod public void vodDownloads(PluginCall call) { getBridge().execute(() -> { try { call.resolve(VodDownloads.get(getContext()).list()); } catch (Exception error) { call.reject("Saved downloads could not be read."); } }); }
    @PluginMethod public void vodDownloadControl(PluginCall call) {
        String id = call.getString("id", ""), action = call.getString("action", ""); if (!VodDownloads.validId(id)) { call.reject("Invalid VOD id."); return; }
        getActivity().runOnUiThread(() -> { try { if (id.equals(downloadId) && action.equals("delete")) { source = null; release(); report(); notifyListeners("pipClosed", new JSObject()); } VodDownloads.get(getContext()).control(id, action); if (!action.equals("pause")) VodDownloadService.start(getContext()); call.resolve(); } catch (Exception error) { call.reject(error.getMessage()); } });
    }
    @PluginMethod public void downloadedChat(PluginCall call) {
        String id = call.getString("id", ""); if (!VodDownloads.validId(id)) { call.reject("Invalid VOD id."); return; }
        double offset = call.getDouble("offset", 0d);
        getBridge().execute(() -> { try { call.resolve(VodDownloads.get(getContext()).chatWindow(id, Math.max(0, offset))); } catch (Exception error) { call.reject("Saved chat replay could not be read."); } });
    }
    @PluginMethod public void downloadedAssets(PluginCall call) {
        String id = call.getString("id", ""); if (!VodDownloads.validId(id)) { call.reject("Invalid VOD id."); return; }
        org.json.JSONObject saved = VodDownloads.get(getContext()).read(id); call.resolve(new JSObject().put("assets", saved == null ? null : saved.optJSONObject("assets")).put("chatState", saved == null ? "disabled" : saved.optString("chatState")));
    }
    @Override protected void handleOnStop() {
        // A visible PiP activity is paused, not stopped. Stop means its window
        // was dismissed or became invisible: retire playback without ghost audio.
        stopped = true;
        KeyguardManager keyguard = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if ((keyguard != null && keyguard.isKeyguardLocked()) || (power != null && !power.isInteractive())) return;
        if (enteredPip) {
            // Expanding a pinned task can briefly stop the activity. Give its
            // resume callback time to arrive before treating this as dismissal.
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (!stopped) return;
                source = null; enteredPip = false; pipActive = false;
                getBridge().getWebView().setVisibility(View.VISIBLE);
                release(); report();
                notifyListeners("pipClosed", new JSObject(), true);
            }, 350);
        } // The media service retains ordinary background/locked playback.
    }
    @Override protected void handleOnResume() {
        stopped = false;
        if (!pipActive) enteredPip = false;
        if (source != null && player == null && playbackError == null) {
            boolean paused = userPaused;
            createPlayer();
            player.setMediaSource(mediaSource());
            player.prepare(); player.setPlayWhenReady(!paused);
            view.setVisibility(surfaceVisible ? View.VISIBLE : View.GONE);
        }
    }
    @Override protected void handleOnDestroy() {
        if (accountBrowser != null) accountBrowser.destroy();
        if (replayBrowser != null) replayBrowser.close();
        source = null; release();
        if (view != null) { ((ViewGroup) view.getParent()).removeView(view); view = null; }
        if (adNotice != null) { ((ViewGroup) adNotice.getParent()).removeView(adNotice); adNotice = null; }
        if (controls != null) { ((ViewGroup) controls.getParent()).removeView(controls); controls = null; }
    }
}
