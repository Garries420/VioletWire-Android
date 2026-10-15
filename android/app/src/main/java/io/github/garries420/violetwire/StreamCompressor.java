package io.github.garries420.violetwire;

import java.nio.ByteBuffer;

/** Stereo-linked, soft-knee compression using VioletWire desktop's settings.
 * Runs on decoded PCM before AudioTrack, so it works on every supported Android version.
 * It adds no look-ahead buffer, gain boost, or playback delay.
 */
final class StreamCompressor {
    private static final double THRESHOLD_DB = -18, KNEE_DB = 12, RATIO = 4;
    private static final double ATTACK_SECONDS = .02, RELEASE_SECONDS = .25;
    private volatile boolean enabled;
    private boolean previouslyEnabled;
    private int channels;
    private double attack, release, gainDb;
    private volatile long processedFrames;

    void configure(int sampleRate, int channelCount) {
        channels = channelCount;
        attack = Math.exp(-1.0 / (sampleRate * ATTACK_SECONDS));
        release = Math.exp(-1.0 / (sampleRate * RELEASE_SECONDS));
        reset();
    }
    void enabled(boolean value) { enabled = value; }
    boolean enabled() { return enabled; }
    long processedFrames() { return processedFrames; }
    void reset() { gainDb = 0; previouslyEnabled = false; processedFrames = 0; }

    static double reductionDb(double inputDb) {
        double over = inputDb - THRESHOLD_DB;
        if (over <= -KNEE_DB / 2) return 0;
        if (over >= KNEE_DB / 2) return (1 / RATIO - 1) * over;
        return (1 / RATIO - 1) * Math.pow(over + KNEE_DB / 2, 2) / (2 * KNEE_DB);
    }

    void process(ByteBuffer input, ByteBuffer output, boolean floatingPoint) {
        boolean active = enabled;
        if (active != previouslyEnabled) gainDb = 0;
        previouslyEnabled = active;
        if (!active) { output.put(input); return; }
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
            double coefficient = targetDb < gainDb ? attack : release;
            gainDb = coefficient * gainDb + (1 - coefficient) * targetDb;
            double gain = Math.pow(10, gainDb / 20);
            for (int channel = 0; channel < channels; channel++) {
                if (floatingPoint) {
                    float value = input.getFloat();
                    output.putFloat(Float.isFinite(value) ? (float) Math.max(-1, Math.min(1, value * gain)) : 0);
                } else {
                    int value = (int) Math.round(input.getShort() * gain);
                    output.putShort((short) Math.max(-32768, Math.min(32767, value)));
                }
            }
            processedFrames++;
        }
        // AudioSink provides complete interleaved frames. Retain any unexpected tail.
        output.put(input);
    }
}
