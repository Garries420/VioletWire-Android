package io.github.garries420.violetwire;

import android.media.audiofx.AudioEffect;
import android.media.audiofx.DynamicsProcessing;
import android.os.Build;
import androidx.annotation.RequiresApi;

/** The output-session effect used by Android players; PCM remains a fallback. */
final class NativeAudioCompressor {
    private DynamicsProcessing effect;
    private int session;
    private boolean requested;
    private String failure = "";
    private final Runnable changed;
    NativeAudioCompressor(Runnable changed) { this.changed = changed; }
    void session(int id) {
        if (session == id && effect != null) return;
        release(); session = id;
        apply();
    }
    void enabled(boolean value) { requested = value; apply(); }
    private void apply() {
        if (Build.VERSION.SDK_INT < 28 || session <= 0) { changed.run(); return; }
        try {
            if (requested && effect == null) create();
            if (effect != null && effect.setEnabled(requested) != AudioEffect.SUCCESS)
                throw new IllegalStateException("Effect enable rejected");
            failure = "";
        } catch (RuntimeException error) {
            release(); failure = "Native effect unavailable; using PCM";
        }
        changed.run();
    }
    @RequiresApi(28)
    private void create() {
        effect = new DynamicsProcessing(0, session, null);
        // These are Android MBC values (time in milliseconds), matching Xtra's
        // mobile preset. Do not convert them from Web Audio's seconds.
        for (int channel = 0; channel < effect.getChannelCount(); channel++) {
            for (int index = 0; index < effect.getMbcByChannelIndex(channel).getBandCount(); index++) {
                DynamicsProcessing.MbcBand band = effect.getMbcBandByChannelIndex(channel, index);
                band.setAttackTime(0f); band.setReleaseTime(.25f);
                band.setRatio(1.6f); band.setThreshold(-50f); band.setKneeWidth(40f);
                band.setPreGain(0f); band.setPostGain(10f);
                effect.setMbcBandByChannelIndex(channel, index, band);
            }
        }
        effect.setControlStatusListener((audioEffect, control) -> changed.run());
    }
    boolean active() {
        if (Build.VERSION.SDK_INT < 28 || effect == null) return false;
        try { return requested && effect.hasControl() && effect.getEnabled(); }
        catch (RuntimeException error) { return false; }
    }
    String status() {
        if (!requested) return "Bypassed";
        return active() ? "Android DynamicsProcessing (session " + session + ")"
            : failure.isEmpty() ? "PCM fallback (session " + session + ")" : failure;
    }
    void release() {
        if (Build.VERSION.SDK_INT >= 28 && effect != null) {
            try { effect.release(); } catch (RuntimeException ignored) { }
            effect = null;
        }
    }
}
