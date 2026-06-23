import { useEffect, useRef, useState } from "react";

export type JarvisVoiceStatus = "off" | "idle" | "listening" | "thinking" | "speaking";

/** 웨이크워드 — "자비스"(STT 변형 재비스/자비쓰 허용, 공백 무시). */
const WAKE = /(자|재)비(스|쓰|즈)/;

/** 핸즈프리 자비스(Siri/Bixby식). enabled 동안 마이크를 상시 열고 VAD 로 발화구간을
 *  자동 감지 → 말이 끝나면(침묵) STT→처리. 대기 중엔 "자비스" 호출이 있어야 활성화하고,
 *  활성(대화) 중엔 호출 없이 이어서 처리하다 일정 침묵 후 대기로 복귀한다.
 *  자비스가 말하는 동안(speaking)과 직후 쿨다운엔 청취를 멈춰 자기 목소리 오인을 막는다.
 *  성능: 루프는 rAF 로 RMS 만 계산하고 React state 는 '상태 전이' 때만 갱신한다. */
export function useJarvisVoice(opts: {
  enabled: boolean;
  speaking: boolean;
  sttUpload: (b: Blob) => Promise<string>;
  send: (text: string) => Promise<void>;
}) {
  const { enabled, speaking } = opts;
  const [status, setStatus] = useState<JarvisVoiceStatus>("off");
  const [active, setActive] = useState(false);

  // 루프에서 최신값을 보도록 ref 동기화(stale closure 방지)
  const speakingRef = useRef(speaking); speakingRef.current = speaking;
  const sttRef = useRef(opts.sttUpload); sttRef.current = opts.sttUpload;
  const sendRef = useRef(opts.send); sendRef.current = opts.send;

  const statusRef = useRef<JarvisVoiceStatus>("off");
  const activeRef = useRef(false);
  const processingRef = useRef(false);
  const capturingRef = useRef(false);
  const lastVoiceRef = useRef(0);   // 마지막으로 음성 에너지가 임계 이상이던 시각
  const segStartRef = useRef(0);    // 현재 segment 시작 시각
  const lastUtterRef = useRef(0);   // 마지막 발화 처리 시각(대화 타임아웃 기준)
  const speakEndRef = useRef(0);    // 자비스 발화 종료 시각(쿨다운 기준)

  const stream = useRef<MediaStream | null>(null);
  const ac = useRef<AudioContext | null>(null);
  const an = useRef<AnalyserNode | null>(null);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const raf = useRef(0);
  const buf = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const setStat = (s: JarvisVoiceStatus) => { if (statusRef.current !== s) { statusRef.current = s; setStatus(s); } };
  const setAct = (v: boolean) => { if (activeRef.current !== v) { activeRef.current = v; setActive(v); } };

  // 자비스 발화 종료 시각 기록(쿨다운용)
  useEffect(() => { if (!speaking) speakEndRef.current = performance.now(); }, [speaking]);

  useEffect(() => {
    if (!enabled) { setStat("off"); return; }
    let stopped = false;
    // VAD 임계값 — 기기·마이크별로 후속 튜닝 가능
    const START = 0.045, END = 0.022, END_SIL = 850, MIN_SEG = 350, CONV_TIMEOUT = 20000, COOLDOWN = 450;

    function startSeg() {
      if (!stream.current) return;
      chunks.current = [];
      const rec = new MediaRecorder(stream.current);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.current = rec; rec.start();
      capturingRef.current = true;
      segStartRef.current = performance.now();
      setStat("listening");
    }

    function endSeg(process: boolean) {
      const rec = mr.current;
      capturingRef.current = false;
      if (!rec || rec.state === "inactive") return;
      rec.onstop = () => {
        const dur = performance.now() - segStartRef.current;
        const blob = chunks.current.length ? new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }) : null;
        if (process && blob && dur > MIN_SEG) void handle(blob);
        else setStat(speakingRef.current ? "speaking" : "idle");
      };
      try { rec.stop(); } catch { /* noop */ }
    }

    async function handle(blob: Blob) {
      processingRef.current = true;
      setStat("thinking");
      try {
        const text = (await sttRef.current(blob)).trim();
        const wake = WAKE.test(text.replace(/\s/g, ""));
        if (!text || (!activeRef.current && !wake)) return;  // 대기 중 호출 없음/빈 텍스트 → 무시
        setAct(true);
        lastUtterRef.current = performance.now();
        await sendRef.current(text);   // 자비스 응답 + TTS 트리거
      } catch { /* STT/전송 실패 → 조용히 계속 */ }
      finally { processingRef.current = false; lastUtterRef.current = performance.now(); }
    }

    function loop() {
      raf.current = requestAnimationFrame(loop);
      const a = an.current, b = buf.current;
      if (!a || !b) return;
      a.getByteTimeDomainData(b);
      let sum = 0; for (let i = 0; i < b.length; i++) { const v = (b[i]! - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / b.length);
      const now = performance.now();

      // 게이트: 자비스 발화 중 + 처리 중 + 발화 직후 쿨다운엔 청취 금지(자기음성 차단)
      const gated = speakingRef.current || processingRef.current || (now - speakEndRef.current < COOLDOWN);
      if (gated) {
        if (capturingRef.current) endSeg(false);
        setStat(speakingRef.current ? "speaking" : processingRef.current ? "thinking" : "idle");
        return;
      }

      // 대화 타임아웃 → 대기(웨이크워드 필요)로 복귀
      if (activeRef.current && !capturingRef.current && now - lastUtterRef.current > CONV_TIMEOUT) setAct(false);

      if (!capturingRef.current) {
        setStat("idle");
        if (rms > START) { startSeg(); lastVoiceRef.current = now; }
      } else {
        if (rms > END) lastVoiceRef.current = now;
        if (now - lastVoiceRef.current > END_SIL) endSeg(true);   // 침묵 → 발화 끝 → 처리
      }
    }

    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const ctx = new AudioContext(); ac.current = ctx;
        const a = ctx.createAnalyser(); a.fftSize = 1024; an.current = a;
        ctx.createMediaStreamSource(s).connect(a);
        buf.current = new Uint8Array(a.fftSize);
        speakEndRef.current = performance.now();
        setStat("idle");
        loop();
      } catch { setStat("off"); }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf.current);
      try { if (mr.current && mr.current.state !== "inactive") mr.current.stop(); } catch { /* noop */ }
      stream.current?.getTracks().forEach((t) => t.stop());
      ac.current?.close().catch(() => {});
      stream.current = null; ac.current = null; an.current = null; buf.current = null;
      capturingRef.current = false; processingRef.current = false;
      setAct(false); setStat("off");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status, active };
}
