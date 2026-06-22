import { useRef, useState } from "react";
import { ttsFetch } from "../api";
import { useStore } from "../store";

/** TTS 재생(브라우저). /voice/tts→Blob→<audio> + MediaElementSource→AnalyserNode(카드 파형). */
export function useTts() {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [speakingSeq, setLocalSeq] = useState<number | null>(null);
  const setSpeaking = useStore((s) => s.setSpeaking);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const urlRef = useRef<string | null>(null);

  function stop(): void {
    audioRef.current?.pause();
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setLocalSeq(null); setSpeaking(null); setAnalyser(null);
  }

  async function speak(text: string, seq?: number): Promise<void> {
    stop();
    const blob = await ttsFetch(text);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const el = new Audio(url);
    audioRef.current = el;
    const ctx = acRef.current ?? new AudioContext();
    acRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaElementSource(el).connect(an);
    an.connect(ctx.destination);
    setAnalyser(an);
    const id = seq ?? null;
    setLocalSeq(id); setSpeaking(id);
    el.onended = () => stop();
    el.onerror = () => stop();
    await el.play().catch(() => stop());
  }

  return { speak, stop, speakingSeq, analyser };
}
