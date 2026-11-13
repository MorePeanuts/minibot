export const voiceSampleRate = 16_000;
export const voiceMaxSeconds = 120;
export const voiceHeaderSize = 44;
export const voiceMaxFrames = voiceSampleRate * voiceMaxSeconds;
export const voiceMaxBytes = voiceHeaderSize + 2 * voiceMaxFrames;

function writeVoiceHeader(view: DataView, frames: number) {
  view.setUint32(0, 0x52494646); // RIFF
  view.setUint32(4, voiceHeaderSize + 2 * frames - 8, true);
  view.setUint32(8, 0x57415645); // WAVE
  view.setUint32(12, 0x666d7420); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true);
  view.setUint32(24, voiceSampleRate, true);
  view.setUint32(28, voiceSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461); // data
  view.setUint32(40, frames * 2, true);
}

export function encodeVoiceWav(samples: Int16Array) {
  const bytes = new ArrayBuffer(voiceHeaderSize + 2 * samples.length);
  const view = new DataView(bytes);
  writeVoiceHeader(view, samples.length);
  samples.forEach((sample, index) => view.setInt16(voiceHeaderSize + 2 * index, sample, true));
  return bytes;
}

export function isVoiceWav(bytes: Uint8Array) {
  if (bytes.byteLength <= voiceHeaderSize || bytes.byteLength > voiceMaxBytes) return false;
  const frames = (bytes.byteLength - voiceHeaderSize) / 2;
  if (!Number.isInteger(frames)) return false;
  const expected = new Uint8Array(voiceHeaderSize);
  writeVoiceHeader(new DataView(expected.buffer), frames);
  return expected.every((byte, index) => bytes[index] === byte);
}
