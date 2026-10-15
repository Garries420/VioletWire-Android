package io.github.garries420.violetwire;

import android.content.Context;
import android.content.Intent;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/** Owns playback independently of the Activity, including while the screen is locked. */
@OptIn(markerClass = UnstableApi.class)
public final class PlaybackService extends MediaSessionService {
    private static ExoPlayer sharedPlayer;
    private static final StreamCompressor compressor = new StreamCompressor();
    private static PlaybackService activeService;
    private static androidx.media3.exoplayer.DefaultLivePlaybackSpeedControl liveSpeedControl;
    private MediaSession session;
    private ExoPlayer ownedPlayer;

    public static ExoPlayer getPlayer(Context context) {
        if (sharedPlayer == null) {
            liveSpeedControl = LivePlaybackTuning.speedControl();
            androidx.media3.exoplayer.DefaultRenderersFactory renderers = new androidx.media3.exoplayer.DefaultRenderersFactory(context.getApplicationContext()) {
                @Override protected androidx.media3.exoplayer.audio.AudioSink buildAudioSink(Context ctx, boolean floatOutput, boolean playbackParams) {
                    return new androidx.media3.exoplayer.audio.DefaultAudioSink.Builder(ctx)
                        .setAudioProcessors(new androidx.media3.common.audio.AudioProcessor[] { new CompressorAudioProcessor(compressor) })
                        // Media3's float-output shortcut skips custom PCM processors.
                        .setEnableFloatOutput(false).setEnableAudioTrackPlaybackParams(playbackParams)
                        .build();
                }
            };
            sharedPlayer = new ExoPlayer.Builder(context.getApplicationContext(), renderers)
                .setLivePlaybackSpeedControl(liveSpeedControl)
                .setLoadControl(LivePlaybackTuning.loadControl()).build();
            sharedPlayer.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
            sharedPlayer.setHandleAudioBecomingNoisy(true);
            sharedPlayer.setWakeMode(C.WAKE_MODE_NETWORK);
        }
        return sharedPlayer;
    }
    static void compression(boolean enabled) { compressor.enabled(enabled); }
    static boolean compression() { return compressor.enabled(); }
    static double compressorGainDb() { return compressor.appliedGainDb(); }
    static long compressedFrames() { return compressor.processedFrames(); }
    static long liveTargetOffsetMs() { return liveSpeedControl == null ? androidx.media3.common.C.TIME_UNSET : androidx.media3.common.util.Util.usToMs(liveSpeedControl.getTargetLiveOffsetUs()); }

    @Override public void onCreate() {
        super.onCreate();
        activeService = this;
        ownedPlayer = getPlayer(this);
        session = new MediaSession.Builder(this, ownedPlayer).build();
        addSession(session);
    }
    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }
    @Override public void onTaskRemoved(Intent rootIntent) { stopSelf(); }
    public static void endPlayback(Context context) {
        if (activeService != null) activeService.releasePlayback();
        else if (sharedPlayer != null) { sharedPlayer.release(); sharedPlayer = null; }
        context.stopService(new Intent(context, PlaybackService.class));
    }
    private void releasePlayback() {
        if (session != null) { session.release(); session = null; }
        if (ownedPlayer != null) {
            if (sharedPlayer == ownedPlayer) sharedPlayer = null;
            ownedPlayer.release(); ownedPlayer = null;
        }
    }
    @Override public void onDestroy() {
        releasePlayback();
        if (activeService == this) activeService = null;
        super.onDestroy();
    }
}
