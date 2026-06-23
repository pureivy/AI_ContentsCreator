import { useEffect, useRef } from "react";

/** 코드로 그린 JARVIS 오브(업로드 이미지 미사용 — 그 디자인을 참고한 HUD 그래픽).
 *  동심 링·바깥 틱·분절 아크·주파수 막대·스윕 아크·중앙 발광 코어가 회전하며,
 *  tts.analyser 의 주파수/진폭에 반응한다(말할 때 활성·밝게, 유휴 시 잔잔히 회전). */
export function JarvisAvatar({ analyser, speaking }: { analyser: AnalyserNode | null; speaking: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const time = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let raf = 0, t = 0;

    const BLUE = (a: number) => `rgba(96,176,255,${a})`;
    const arc = (r: number, w: number, a0: number, a1: number, col: string) => {
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
    };
    const radial = (a: number, r1: number, r2: number, col: string, w: number) => {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 0.016;
      let amp = 0;
      if (analyser && freq && time) {
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(time);
        let sum = 0;
        for (let i = 0; i < time.length; i++) { const v = (time[i]! - 128) / 128; sum += v * v; }
        amp = Math.sqrt(sum / time.length);          // 0~1 RMS
      }
      const act = speaking ? amp : 0;                 // 활성 진폭(말할 때만)
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";

      // 1) 베이스 동심원
      for (const r of [110, 140, 172]) arc(r, 1, 0, Math.PI * 2, BLUE(0.10));

      // 2) 바깥 틱 링 (느린 회전, 활성 시 가속·발광)
      const tickRot = t * (0.18 + act * 0.7);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2 + tickRot;
        radial(a, 232, 232 + (i % 6 === 0 ? 12 : 6), BLUE(0.32 + act * 0.5), 2);
      }

      // 3) 분절 HUD 아크 (반대방향 회전)
      const segRot = -t * 0.3;
      for (let k = 0; k < 3; k++) {
        const base = segRot + (k * Math.PI * 2) / 3;
        arc(210, 3, base + 0.18, base + 1.7, BLUE(0.5 + act * 0.4));
      }

      // 4) 주파수 반응 막대 링
      const N = 96, innerR = 178, maxBar = 44;
      for (let i = 0; i < N; i++) {
        const f = (speaking && freq) ? (freq[Math.floor((i / N) * freq.length * 0.55)]! / 255) : 0;
        const idle = speaking ? 0 : (Math.sin(t * 2.2 + i * 0.4) * 0.5 + 0.5) * 0.18;
        const len = f * f * maxBar + idle * maxBar;
        const a = (i / N) * Math.PI * 2 + t * 0.2;
        const it = speaking ? f : idle;
        radial(a, innerR, innerR + 6 + len, `rgba(${120 + it * 70},${195 + it * 40},255,${0.3 + it * 0.7})`, 3);
      }

      // 5) 빠른 스윕 아크
      const sw = t * 1.3;
      arc(152, 3, sw, sw + 0.5, BLUE(0.9));
      arc(152, 3, sw + Math.PI, sw + Math.PI + 0.35, BLUE(0.55));

      // 6) 중앙 발광 코어 — 진폭 맥동
      const coreR = 86 * (1 + act * 0.22 + Math.sin(t * 1.6) * 0.02);
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, coreR);
      g.addColorStop(0, `rgba(195,232,255,${0.85 + act * 0.15})`);
      g.addColorStop(0.5, `rgba(70,150,255,${0.45 + act * 0.35})`);
      g.addColorStop(1, "rgba(20,60,140,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();

      // 7) 코어 링 + 회전 크로스
      arc(94, 2, 0, Math.PI * 2, BLUE(0.5 + act * 0.4));
      const cr = t * 0.5;
      for (let k = 0; k < 4; k++) radial(cr + (k * Math.PI) / 2, 30, 66, BLUE(0.5), 2);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, speaking]);

  return <canvas ref={ref} className="jarvis-orb-canvas" width={520} height={520} role="img" aria-label="자비스" />;
}
