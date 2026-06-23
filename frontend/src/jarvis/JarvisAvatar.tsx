import { useEffect, useRef } from "react";
import jarvisOrb from "../assets/jarvis.webp";

/** 중앙 자비스 오브 + 원형 오디오 비주얼라이저 링.
 *  이미지는 회전하지 않고 은은한 호흡·발광만 한다. 둘레의 막대 링이 tts.analyser 의
 *  주파수에 반응해 말할 때 출렁이고(음성대역), 유휴 시 잔잔한 물결로 살아있게 보인다. */
export function JarvisAvatar({ analyser, speaking }: { analyser: AnalyserNode | null; speaking: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    const N = 104;                  // 막대 수
    const innerR = W * 0.355;       // 오브 가장자리 바로 바깥
    const maxBar = W * 0.125;       // 최대 막대 길이
    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const time = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let raf = 0, t = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 0.016;
      let amp = 0;
      if (analyser && freq && time) {
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(time);
        let sum = 0;
        for (let i = 0; i < time.length; i++) { const v = (time[i]! - 128) / 128; sum += v * v; }
        amp = Math.sqrt(sum / time.length);     // 0~1 RMS
      }
      ctx.clearRect(0, 0, W, H);
      const rot = t * 0.22;                       // 막대 패턴만 천천히 회전(이미지 아님)
      const bins = freq ? Math.floor(freq.length * 0.55) : 0; // 음성대역 하위 55%
      ctx.lineCap = "round";
      ctx.lineWidth = W * 0.008;
      for (let i = 0; i < N; i++) {
        const f = (speaking && freq && bins) ? (freq[Math.floor((i / N) * bins)]! / 255) : 0;
        const idle = speaking ? 0 : (Math.sin(t * 2.2 + i * 0.34) * 0.5 + 0.5) * 0.16; // 유휴 물결
        const len = (f * f) * maxBar + idle * maxBar;
        const a = (i / N) * Math.PI * 2 + rot;
        const r1 = innerR, r2 = innerR + W * 0.012 + len;
        const intensity = speaking ? f : idle;
        ctx.strokeStyle = `rgba(${110 + intensity * 60}, ${190 + intensity * 40}, 255, ${0.28 + intensity * 0.72})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
      const img = imgRef.current;
      if (img) {
        const breathe = Math.sin(t * 1.4) * 0.012;                 // 은은한 호흡
        img.style.transform = `scale(${1 + breathe + amp * 0.06})`; // 회전 없음
        img.style.filter = `drop-shadow(0 0 ${10 + amp * 48}px rgba(90,170,255,${0.45 + amp * 0.55}))`;
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, speaking]);

  return (
    <div className="jarvis-avatar">
      <canvas ref={canvasRef} className="jarvis-viz" width={520} height={520} aria-hidden />
      <img ref={imgRef} src={jarvisOrb} className="jarvis-orb" alt="자비스" />
    </div>
  );
}
