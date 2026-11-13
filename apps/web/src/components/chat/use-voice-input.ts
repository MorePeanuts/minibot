"use client";

import { useEffect, useRef, useState } from "react";
import { encodeVoiceWav, voiceMaxFrames, voiceMaxSeconds, voiceSampleRate } from "@/lib/chat/voice";

type VoicePhase = "idle" | "starting" | "recording" | "transcribing";

interface Recording {
  context: AudioContext;
  stream?: MediaStream;
  node?: AudioWorkletNode;
  timer?: number;
  controller: AbortController;
}

function releaseMicrophone(recording: Recording) {
  recording.stream?.getTracks().forEach((track) => track.stop());
}

function closeRecorder(recording: Recording) {
  window.clearTimeout(recording.timer);
  releaseMicrophone(recording);
  recording.node?.disconnect();
  recording.node?.port.close();
  if (recording.context.state !== "closed") void recording.context.close().catch(() => {});
}

async function toVoiceWav(samples: Int16Array, sampleRate: number) {
  if (sampleRate === voiceSampleRate) return encodeVoiceWav(samples);
  const frames = Math.min(
    voiceMaxFrames,
    Math.round((samples.length * voiceSampleRate) / sampleRate),
  );
  if (!frames) return null;
  const converter = new OfflineAudioContext(1, frames, voiceSampleRate);
  const input = converter.createBuffer(1, samples.length, sampleRate);
  const channel = input.getChannelData(0);
  samples.forEach((sample, index) => {
    channel[index] = sample / 32768;
  });
  const source = converter.createBufferSource();
  source.buffer = input;
  source.connect(converter.destination);
  source.start();
  const output = (await converter.startRendering()).getChannelData(0);
  const pcm = Int16Array.from(output, (sample) =>
    Math.max(-32768, Math.min(32767, sample * 32768)),
  );
  return encodeVoiceWav(pcm);
}

export function useVoiceInput(onTranscript: (text: string) => void) {
  const current = useRef<Recording | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      const recording = current.current;
      current.current = null;
      if (!recording) return;
      closeRecorder(recording);
      recording.controller.abort();
    },
    [],
  );

  function cancel(message = "") {
    const recording = current.current;
    current.current = null;
    if (recording) {
      closeRecorder(recording);
      recording.controller.abort();
    }
    setPhase("idle");
    setError(message);
  }

  function stop() {
    const recording = current.current;
    if (!recording?.node) return;
    releaseMicrophone(recording);
    window.clearTimeout(recording.timer);
    recording.timer = window.setTimeout(
      () => cancel("Could not finish recording. Try again."),
      3_000,
    );
    setPhase("transcribing");
    recording.node.port.postMessage("stop");
  }

  async function transcribe(recording: Recording, buffer: Int16Array, frames: number) {
    if (current.current !== recording) return;
    closeRecorder(recording);
    if (!frames) {
      cancel("No audio was recorded. Try again.");
      return;
    }
    setPhase("transcribing");
    try {
      const body = await toVoiceWav(buffer.subarray(0, frames), recording.context.sampleRate);
      if (current.current !== recording) return;
      if (!body) {
        setError("No audio was recorded. Try again.");
        return;
      }
      const response = await fetch("/api/asr", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body,
        signal: recording.controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (current.current !== recording) return;
      if (!response.ok || typeof result?.text !== "string") {
        setError(
          typeof result?.error === "string"
            ? result.error
            : "Could not transcribe the audio. Try again.",
        );
        return;
      }
      const text = result.text.trim();
      if (text) onTranscript(text);
      else setError("No speech was recognized. Try again.");
    } catch {
      if (current.current === recording) {
        setError("Could not transcribe the audio. Check your connection and try again.");
      }
    } finally {
      if (current.current === recording) {
        current.current = null;
        setPhase("idle");
      }
    }
  }

  async function start() {
    if (current.current) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
      setError("Microphone recording requires a supported browser and a secure connection.");
      return;
    }
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      setError("This browser could not start audio recording.");
      return;
    }
    const recording: Recording = { context, controller: new AbortController() };
    current.current = recording;
    setPhase("starting");
    try {
      const resumed = context.resume().catch(() => false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current.current !== recording) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      recording.stream = stream;
      if (!context.audioWorklet) {
        cancel("This browser does not support the required recording format.");
        return;
      }
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => {
          if (current.current === recording) cancel("The microphone disconnected. Try again.");
        });
      }

      await context.audioWorklet.addModule("/voice-recorder.js");
      if ((await resumed) === false) throw new Error("Audio context could not start");
      if (current.current !== recording) return;
      const node = new AudioWorkletNode(context, "voice-recorder", {
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { maxFrames: Math.floor(context.sampleRate * voiceMaxSeconds) },
      });
      recording.node = node;
      node.port.onmessage = ({ data }: MessageEvent<{ buffer: Int16Array; frames: number }>) => {
        node.port.onmessage = null;
        void transcribe(recording, data.buffer, data.frames);
      };
      node.onprocessorerror = () => {
        if (current.current === recording) cancel("Recording stopped unexpectedly. Try again.");
      };
      context.createMediaStreamSource(stream).connect(node).connect(context.destination);
      recording.timer = window.setTimeout(stop, voiceMaxSeconds * 1_000);
      setPhase("recording");
    } catch (error) {
      if (current.current !== recording) return;
      const name = error instanceof Error ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        cancel("Microphone permission was denied. Allow microphone access and try again.");
      } else if (name === "NotFoundError" || name === "NotReadableError") {
        cancel("No microphone is available. Check that it is connected and try again.");
      } else {
        cancel("Could not start recording. Try again.");
      }
    }
  }

  return { phase, error, start, stop, cancel, active: () => current.current !== null };
}
