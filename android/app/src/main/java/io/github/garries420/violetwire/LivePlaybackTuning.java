package io.github.garries420.violetwire;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultLivePlaybackSpeedControl;
import androidx.media3.exoplayer.DefaultLoadControl;

@OptIn(markerClass = UnstableApi.class)
final class LivePlaybackTuning {
    private LivePlaybackTuning() {}
    static DefaultLivePlaybackSpeedControl speedControl() {
        return new DefaultLivePlaybackSpeedControl.Builder()
            .setTargetLiveOffsetIncrementOnRebufferMs(0)
            .setMinPossibleLiveOffsetSmoothingFactor(0.9f)
            .setMaxLiveOffsetErrorMsForUnitSpeed(100).build();
    }
    static DefaultLoadControl loadControl() {
        // Capacity is separate from live delay. Start/recover promptly while
        // retaining headroom for VODs and buffered live fragments.
        return new DefaultLoadControl.Builder()
            .setBufferDurationsMsForStreaming(15000, 30000, 500, 750).build();
    }
    static boolean shouldResync(int targetMs, long offsetMs, long sinceLastResyncMs) {
        return targetMs <= 3000 && offsetMs != androidx.media3.common.C.TIME_UNSET
            && offsetMs > targetMs + 2000L && sinceLastResyncMs >= 15000;
    }
    static long recoveryPositionMs(int targetMs, long offsetMs, long positionMs, long durationMs) {
        if (offsetMs == androidx.media3.common.C.TIME_UNSET || durationMs == androidx.media3.common.C.TIME_UNSET) return androidx.media3.common.C.TIME_UNSET;
        long position = positionMs + offsetMs - targetMs;
        // Wait for a fresh snapshot when its advertised edge is still old.
        // Leave enough media beyond the seek position for rebuffer recovery.
        return position >= 0 && position <= durationMs - 750 ? position : androidx.media3.common.C.TIME_UNSET;
    }
    static int kickTarget(int requestedMs, long segmentMs, int rebufferPenaltyMs) {
        // Step-down trials sustain 2.5s on 2s chunks; 2.25s starts stalling.
        // Longer complete chunks need more room for publication/download jitter.
        long marginMs = segmentMs <= 2500 ? 500 : 1000;
        return Math.max(requestedMs, (int) Math.min(10000, Math.max(2500, segmentMs + marginMs) + rebufferPenaltyMs));
    }
    static MediaItem.LiveConfiguration kickConfiguration(int targetMs) {
        return new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(targetMs)
            .setMinOffsetMs(Math.max(2000, targetMs - 1000)).setMaxOffsetMs(targetMs + 3000)
            .setMinPlaybackSpeed(0.97f).setMaxPlaybackSpeed(1.03f).build();
    }
    static MediaItem.LiveConfiguration configuration(int targetMs) {
        boolean low = targetMs <= 3000;
        return new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(targetMs)
            .setMinOffsetMs(low ? 1000 : 3000).setMaxOffsetMs(low ? 4000 : 10000)
            .setMinPlaybackSpeed(low ? 1f : 0.97f).setMaxPlaybackSpeed(low ? 1.05f : 1.03f).build();
    }
}
