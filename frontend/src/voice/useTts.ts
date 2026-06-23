import { useEffect, useRef, useState } from "react";
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
  const srcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const anRef = useRef<AnalyserNode | null>(null);

  // Important 1: AudioContext 언마운트 시 닫기 (브라우저 per-origin 한도 누수 방지)
  useEffect(() => () => { acRef.current?.close().catch(() => {}); }, []);

  function stop(): void {
    audioRef.current?.pause();
    // Important 2: 이전 Web Audio 노드 disconnect (그래프 누적 방지)
    srcRef.current?.disconnect();
    anRef.current?.disconnect();
    srcRef.current = null;
    anRef.current = null;
    audioRef.current = null;
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setLocalSeq(null); setSpeaking(null); setAnalyser(null);
  }

  /** 사용자 제스처(마이크 누름) 때 AudioContext 를 생성·resume 해 이후 자동재생을 언락. */
  async function prime(): Promise<void> {
    const ctx = acRef.current ?? new AudioContext();
    acRef.current = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
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
    const src = ctx.createMediaElementSource(el);
    src.connect(an);
    an.connect(ctx.destination);
    srcRef.current = src;
    anRef.current = an;
    setAnalyser(an);
    const id = seq ?? null;
    setLocalSeq(id); setSpeaking(id);
    el.onended = () => stop();
    el.onerror = () => stop();
    await el.play().catch(() => stop());
  }

  return { speak, stop, prime, speakingSeq, analyser };
}
