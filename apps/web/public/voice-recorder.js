/* global AudioWorkletProcessor, registerProcessor */
class VoiceRecorder extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.buffer = new Int16Array(processorOptions.maxFrames);
    this.frames = 0;
    this.finished = false;
    this.port.onmessage = () => this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.port.postMessage({ buffer: this.buffer, frames: this.frames }, [this.buffer.buffer]);
  }

  process(inputs) {
    if (this.finished) return false;
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const count = Math.min(channel.length, this.buffer.length - this.frames);
    for (let index = 0; index < count; index++) {
      const sample = Math.max(-1, Math.min(1, channel[index]));
      this.buffer[this.frames++] = sample * (sample < 0 ? 32768 : 32767);
    }
    if (this.frames < this.buffer.length) return true;
    this.finish();
    return false;
  }
}

registerProcessor("voice-recorder", VoiceRecorder);
