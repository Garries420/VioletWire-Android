package io.github.garries420.violetwire;

import java.nio.ByteBuffer;

/** Stereo-linked soft-knee compressor for decoded PCM on all supported Android versions.
 * A low threshold and makeup gain bring quiet speech closer to loud effects. The
 * mobile preset follows Xtra's published control values, independently implemented
 * here rather than depending on device-specific AudioEffect availability. No queued
 * look-ahead is added to live playback.
 */
final class StreamCompressor {
    private static final double THRESHOLD_DB = -50, KNEE_DB = 40, RATIO = 1.6, MAKEUP_DB = 10;
    private static final double RELEASE_SECONDS = .25, SWITCH_SECONDS = .005;
    private volatile boolean enabled;
    private boolean previouslyEnabled;
    private int channels;
    private double release, switchStep, mix, gainDb;
    private volatile double appliedGainDb;
    private volatile long processedFrames;

    void configure(int sampleRate, int channelCount) {
        channels = channelCount;
        switchStep = 1.0 / (sampleRate * SWITCH_SECONDS);
        release = Math.exp(-1.0 / (sampleRate * RELEASE_SECONDS));
        reset();
    }
    void enabled(boolean value) { enabled = value; }
    boolean enabled() { return enabled; }
    long processedFrames() { return processedFrames; }
    double appliedGainDb() { return appliedGainDb; }
    void reset() { gainDb = 0; mix = 0; appliedGainDb = 0; previouslyEnabled = false; processedFrames = 0; }

    static double reductionDb(double inputDb) {
        double over = inputDb - THRESHOLD_DB;
        if (over <= -KNEE_DB / 2) return 0;
        if (over >= KNEE_DB / 2) return (1 / RATIO - 1) * over;
        return (1 / RATIO - 1) * Math.pow(over + KNEE_DB / 2, 2) / (2 * KNEE_DB);
    }

    void process(ByteBuffer input, ByteBuffer output, boolean floatingPoint) {
        boolean active = enabled;
        if (active && !previouslyEnabled) gainDb = 0;
        previouslyEnabled = active;
        if (!active && mix == 0) { appliedGainDb = 0; output.put(input); return; }
        double totalGain = 0;
        int frames = 0;
        int sampleBytes = floatingPoint ? 4 : 2;
        int frameBytes = channels * sampleBytes;
        while (input.remaining() >= frameBytes) {
            int start = input.position();
            double peak = 0;
            for (int channel = 0; channel < channels; channel++) {
                double value = floatingPoint ? input.getFloat(start + channel * sampleBytes)
                    : input.getShort(start + channel * sampleBytes) / 32768.0;
                if (Double.isFinite(value)) peak = Math.max(peak, Math.abs(value));
            }
            double targetDb = reductionDb(20 * Math.log10(Math.max(peak, 1e-12)));
            // Immediate peak attenuation, then a smooth release. Linked gain
            // preserves the stereo image and avoids zero-crossing distortion.
            gainDb = targetDb < gainDb ? targetDb : release * gainDb + (1 - release) * targetDb;
            mix = active ? Math.min(1, mix + switchStep) : Math.max(0, mix - switchStep);
            double gain = 1 + mix * (Math.pow(10, (gainDb + MAKEUP_DB) / 20) - 1);
            totalGain += gain; frames++;
            for (int channel = 0; channel < channels; channel++) {
                if (floatingPoint) {
                    float value = input.getFloat();
                    output.putFloat(Float.isFinite(value) ? (float) Math.max(-1, Math.min(1, value * gain)) : 0);
                } else {
                    int value = (int) Math.round(input.getShort() * gain);
                    output.putShort((short) Math.max(-32768, Math.min(32767, value)));
                }
            }
            if (active) processedFrames++;
        }
        if (frames > 0) appliedGainDb = 20 * Math.log10(Math.max(totalGain / frames, 1e-12));
        // AudioSink provides complete interleaved frames. Retain any unexpected tail.
        output.put(input);
    }
}
