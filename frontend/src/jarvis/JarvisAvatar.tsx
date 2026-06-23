import { useEffect, useRef } from "react";
import jarvisOrb from "../assets/jarvis.webp";

/** 중앙 자비스 오브. speaking 중에는 tts.analyser 진폭으로 scale·glow·회전 가속, 유휴 시 잔잔. */
export function JarvisAvatar({ analyser, speaking }: { analyser: AnalyserNode | null; speaking: boolean }) {
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const buf = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let spin = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      let amp = 0;
      if (speaking && analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i]! - 128) / 128; sum += v * v; }
        amp = Math.sqrt(sum / buf.length); // 0~1 RMS
      }
      spin += 0.2 + amp * 2.5;                       // 회전: 유휴 느림, 말할 때 가속
      const scale = 1 + amp * 0.18;                  // 맥동
      const glow = 8 + amp * 40;                     // 발광
      el.style.transform = `rotate(${spin}deg) scale(${scale})`;
      el.style.filter = `drop-shadow(0 0 ${glow}px rgba(90,170,255,${0.5 + amp * 0.5}))`;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, speaking]);

  return <img ref={ref} src={jarvisOrb} className="jarvis-orb" alt="자비스" />;
}
