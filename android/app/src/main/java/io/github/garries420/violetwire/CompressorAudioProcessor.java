package io.github.garries420.violetwire;

import java.nio.ByteBuffer;
import androidx.media3.common.C;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.audio.AudioProcessor.AudioFormat;
import androidx.media3.common.audio.AudioProcessor.UnhandledAudioFormatException;
import androidx.media3.common.util.UnstableApi;

@UnstableApi
final class CompressorAudioProcessor extends BaseAudioProcessor {
    private final StreamCompressor compressor;
    CompressorAudioProcessor(StreamCompressor compressor) { this.compressor = compressor; }
    @Override protected AudioFormat onConfigure(AudioFormat format) throws UnhandledAudioFormatException {
        if (format.encoding != C.ENCODING_PCM_16BIT && format.encoding != C.ENCODING_PCM_FLOAT)
            throw new UnhandledAudioFormatException(format);
        compressor.configure(format.sampleRate, format.channelCount);
        return format;
    }
    @Override public void queueInput(ByteBuffer input) {
        if (!input.hasRemaining()) return;
        ByteBuffer output = replaceOutputBuffer(input.remaining()).order(input.order());
        compressor.process(input, output, inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT);
        output.flip();
    }
    @Override protected void onFlush() { compressor.reset(); }
}
