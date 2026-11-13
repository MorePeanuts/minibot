"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MiniBotUIMessage } from "@/lib/chat/types";

type Playback = {
  messageId: string;
  controller: AbortController;
  audio?: HTMLAudioElement;
  url?: string;
};

export function useReplySpeech(conversationId: string, messages: MiniBotUIMessage[]) {
  const current = useRef<Playback | null>(null);
  const [status, setStatus] = useState<{ messageId: string; phase: "loading" | "playing" } | null>(
    null,
  );

  const release = useCallback(() => {
    const playback = current.current;
    if (!playback) return;
    current.current = null;
    playback.controller.abort();
    if (playback.audio) {
      playback.audio.onended = null;
      playback.audio.onerror = null;
      playback.audio.pause();
      playback.audio.removeAttribute("src");
      playback.audio.load();
    }
    if (playback.url) URL.revokeObjectURL(playback.url);
  }, []);

  const stop = useCallback(() => {
    release();
    setStatus(null);
  }, [release]);

  useEffect(() => release, [conversationId, release]);

  useEffect(() => {
    const active = current.current;
    if (active && !messages.some((message) => message.id === active.messageId)) release();
  }, [messages, release]);

  async function toggle(messageId: string) {
    if (current.current?.messageId === messageId) {
      stop();
      return;
    }
    release();
    const controller = new AbortController();
    const playback: Playback = { messageId, controller };
    current.current = playback;
    setStatus({ messageId, phase: "loading" });
    let error = "Could not play this reply. Try again.";
    const fail = () => {
      if (current.current !== playback) return;
      stop();
      toast.error(error);
    };

    try {
      const params = new URLSearchParams({ conversationId, messageId });
      const response = await fetch(`/api/tts?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        if (typeof result?.error === "string") error = result.error;
        fail();
        return;
      }
      const wav = await response.blob();
      if (current.current !== playback) return;
      playback.url = URL.createObjectURL(wav);
      const audio = new Audio(playback.url);
      playback.audio = audio;
      audio.onended = stop;
      audio.onerror = fail;
      await audio.play();
      if (current.current === playback) setStatus({ messageId, phase: "playing" });
    } catch {
      fail();
    }
  }

  return { status, toggle };
}
