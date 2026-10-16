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
    private volatile LivePlaybackSpeedControl delegate = LivePlaybackTuning.speedControl();
    private volatile BooleanSupplier kick;
    private volatile IntSupplier target;
    volatile float speed = 1f;
    private volatile int applied = -1;
    private volatile int appliedTwitch = -1;
    private volatile MediaItem.LiveConfiguration twitchConfiguration;
    KickAwareSpeedControl(BooleanSupplier kick, IntSupplier target) { this.kick = kick; this.target = target; }
    void bind(BooleanSupplier kick, IntSupplier target) { this.kick = kick; this.target = target; applied = -1; }
    private void configureKick() {
        if (kick.getAsBoolean() && applied != target.getAsInt()) {
            applied = target.getAsInt(); delegate.setLiveConfiguration(LivePlaybackTuning.kickConfiguration(applied));
            delegate.setTargetLiveOffsetOverrideUs(C.TIME_UNSET);
        }
    }
    private void configureTwitch() {
        if (!kick.getAsBoolean() && twitchConfiguration != null && appliedTwitch != target.getAsInt()) {
            appliedTwitch = target.getAsInt();
            delegate.setLiveConfiguration(twitchConfiguration.buildUpon()
                .setTargetOffsetMs(Math.max(twitchConfiguration.targetOffsetMs, appliedTwitch))
                .setMaxOffsetMs(Math.max(twitchConfiguration.maxOffsetMs, appliedTwitch + 1000L)).build());
            delegate.setTargetLiveOffsetOverrideUs(C.TIME_UNSET);
        }
    }
    @Override public void setLiveConfiguration(MediaItem.LiveConfiguration configuration) {
        applied = -1;
        if (kick.getAsBoolean()) configureKick();
        else { twitchConfiguration = configuration; appliedTwitch = -1; configureTwitch(); }
    }
    @Override public void setTargetLiveOffsetOverrideUs(long offsetUs) {
        if (kick.getAsBoolean()) {
            // Media3 supplies a position override after a seek. Its previous
            // buffer estimate belongs to the old position and would otherwise
            // slow playback back towards that older, higher live delay.
            if (offsetUs != C.TIME_UNSET) { delegate = LivePlaybackTuning.speedControl(); applied = -1; }
            configureKick(); delegate.setTargetLiveOffsetOverrideUs(C.TIME_UNSET);
        }
        else { configureTwitch(); delegate.setTargetLiveOffsetOverrideUs(offsetUs == C.TIME_UNSET ? offsetUs : Math.max(offsetUs, target.getAsInt() * 1000L)); }
    }
    // Kick already adapts through its measured underrun penalty. Twitch uses
    // Media3's normal recovery margin instead of repeatedly starving at 2.5s.
    @Override public void notifyRebuffer() { if (!kick.getAsBoolean()) delegate.notifyRebuffer(); }
    @Override public float getAdjustedPlaybackSpeed(long liveOffsetUs, long bufferedDurationUs) {
        configureKick(); configureTwitch(); speed = delegate.getAdjustedPlaybackSpeed(liveOffsetUs, bufferedDurationUs); return speed;
    }
    @Override public long getTargetLiveOffsetUs() { configureKick(); configureTwitch(); return delegate.getTargetLiveOffsetUs(); }
}
