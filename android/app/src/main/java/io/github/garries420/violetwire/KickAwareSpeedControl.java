package io.github.garries420.violetwire;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.LivePlaybackSpeedControl;
import java.util.function.BooleanSupplier;
import java.util.function.IntSupplier;

/** Update the Kick offset without replacing/repreparing the current media item. */
@androidx.annotation.OptIn(markerClass = UnstableApi.class)
final class KickAwareSpeedControl implements LivePlaybackSpeedControl {
    private final LivePlaybackSpeedControl delegate = LivePlaybackTuning.speedControl();
    private final BooleanSupplier kick;
    private final IntSupplier target;
    private int applied = -1;
    KickAwareSpeedControl(BooleanSupplier kick, IntSupplier target) { this.kick = kick; this.target = target; }
    private void configureKick() {
        if (kick.getAsBoolean() && applied != target.getAsInt()) {
            applied = target.getAsInt(); delegate.setLiveConfiguration(LivePlaybackTuning.kickConfiguration(applied));
            delegate.setTargetLiveOffsetOverrideUs(C.TIME_UNSET);
        }
    }
    @Override public void setLiveConfiguration(MediaItem.LiveConfiguration configuration) {
        applied = -1;
        if (kick.getAsBoolean()) configureKick(); else delegate.setLiveConfiguration(configuration);
    }
    @Override public void setTargetLiveOffsetOverrideUs(long offsetUs) {
        if (kick.getAsBoolean()) { configureKick(); delegate.setTargetLiveOffsetOverrideUs(C.TIME_UNSET); }
        else delegate.setTargetLiveOffsetOverrideUs(offsetUs);
    }
    @Override public void notifyRebuffer() { delegate.notifyRebuffer(); }
    @Override public float getAdjustedPlaybackSpeed(long liveOffsetUs, long bufferedDurationUs) {
        configureKick(); return delegate.getAdjustedPlaybackSpeed(liveOffsetUs, bufferedDurationUs);
    }
    @Override public long getTargetLiveOffsetUs() { configureKick(); return delegate.getTargetLiveOffsetUs(); }
}
