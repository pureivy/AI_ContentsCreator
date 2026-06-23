import { useEffect, useRef } from "react";

/** 코드 생성 JARVIS 오브 — 사이버틱 네온 HUD. 가운데 원에는 사이버펑크 자비스 얼굴
 *  (/avatars/jarvis_face.png — 크롬+골드 헬멧·시안 이어피스·네온)을 클립해 넣는다.
 *  이미지가 자체 헬멧/이어피스를 가지므로 코드 헤드셋은 두지 않고, 사이버 림·시안 틴트/
 *  스캔라인만 덧댄다. 둘레 HUD(헥사·틱·아크·레이더·막대·입자)와 림이 tts.analyser
 *  주파수/진폭에 반응. */
export function JarvisAvatar({ analyser, speaking }: { analyser: AnalyserNode | null; speaking: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const avImg = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const im = new Image();
    im.src = "/avatars/jarvis_face.png";   // 동일 오리진 → canvas 오염 없음
    avImg.current = im;
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, R = W / 2;
    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const time = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const PARTS = Array.from({ length: 26 }, (_, i) => ({
      ang: (i / 26) * Math.PI * 2, rad: 0.50 + (i % 5) * 0.025, spd: 0.003 + (i % 4) * 0.0013, ph: i,
    }));
    let raf = 0, t = 0;

    const CY = (a: number) => `rgba(0,229,255,${a})`;
    const MG = (a: number) => `rgba(180,90,255,${a})`;
    const HI = (a: number) => `rgba(150,210,255,${a})`;
    const ring = (r: number, w: number, col: string, a0 = 0, a1 = Math.PI * 2) => {
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
    };
    const ray = (a: number, r1: number, r2: number, col: string, w: number) => {
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
    };
    const poly = (r: number, n: number, rot: number, w: number, col: string) => {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const a = rot + (i / n) * Math.PI * 2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 0.016;
      let amp = 0;
      if (analyser && freq && time) {
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(time);
        let sum = 0; for (let i = 0; i < time.length; i++) { const v = (time[i]! - 128) / 128; sum += v * v; }
        amp = Math.sqrt(sum / time.length);
      }
      const act = speaking ? amp : 0;
      const cR = R * 0.40;   // 중앙 아바타 원 반경

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(0,229,255,0.9)";

      // 0) 배경 헤일로
      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.95);
      g.addColorStop(0, CY(0.08 + act * 0.12)); g.addColorStop(0.5, "rgba(40,120,255,0.04)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // 1) 회전 헥사 와이어프레임 2겹
      ctx.shadowBlur = 10;
      poly(R * 0.88, 6, t * 0.12, 1.2, CY(0.22 + act * 0.3));
      poly(R * 0.82, 6, -t * 0.17 + 0.5, 1, MG(0.16 + act * 0.28));

      // 2) 바깥 점선 회전 링
      ctx.setLineDash([4, 11]); ctx.lineDashOffset = -t * 14; ring(R * 0.93, 1.5, HI(0.3 + act * 0.45)); ctx.setLineDash([]);

      // 3) 틱 링(가속 회전)
      const tr = t * (0.18 + act * 0.8); ctx.shadowBlur = 7;
      for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2 + tr; ray(a, R * 0.885, R * 0.885 + (i % 6 === 0 ? R * 0.045 : R * 0.022), CY(0.26 + act * 0.5), 1.6); }

      // 4) 분절 HUD 아크(멀티컬러, 역회전)
      ctx.shadowBlur = 14;
      for (let k = 0; k < 3; k++) { const b = -t * 0.3 + k * 2.094; ring(R * 0.78, 3, CY(0.55 + act * 0.45), b + 0.2, b + 1.6); }
      for (let k = 0; k < 3; k++) { const b = t * 0.36 + k * 2.094; ring(R * 0.72, 2.5, MG(0.5 + act * 0.4), b + 0.3, b + 1.25); }

      // 5) 레이더 스윕(아바타 밖에서만)
      const sw = t * 1.05; ctx.shadowBlur = 6;
      for (let i = 0; i < 22; i++) { const a = sw - i * 0.055; ray(a, cR + R * 0.04, R * 0.66, CY((0.5 - i * 0.022) * (0.5 + act)), 2.2); }

      // 6) 미러 주파수 막대
      const N = 96, innerR = R * 0.60, maxBar = R * 0.15; ctx.shadowBlur = 9;
      for (let i = 0; i < N; i++) {
        const f = (speaking && freq) ? (freq[Math.floor((i / N) * freq.length * 0.55)]! / 255) : 0;
        const idle = speaking ? 0 : (Math.sin(t * 2.2 + i * 0.4) * 0.5 + 0.5) * 0.16;
        const len = f * f * maxBar + idle * maxBar;
        const a = (i / N) * Math.PI * 2 + t * 0.15;
        const it = speaking ? f : idle;
        const col = it > 0.6 ? MG(0.5 + it * 0.5) : CY(0.4 + it * 0.6);
        ray(a, innerR, innerR + R * 0.013 + len, col, 3);
      }

      // 7) 궤도 입자
      ctx.shadowBlur = 12;
      for (const p of PARTS) {
        p.ang += p.spd * (1 + act * 3.5);
        const pr = R * p.rad + Math.sin(t * 1.5 + p.ph) * R * 0.02;
        const x = cx + Math.cos(p.ang) * pr, y = cy + Math.sin(p.ang) * pr;
        const s = Math.max(0.6, 1.6 + act * 4 + Math.sin(t * 3 + p.ph) * 0.9);
        ctx.fillStyle = (p.ph % 3 === 0) ? MG(0.75) : CY(0.85);
        ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      }

      // ===== 8) 중앙: 자비스 아바타 + 사이버 장식 =====
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.clip();
      // 다크 사이버 배경
      const bg = ctx.createRadialGradient(cx, cy - cR * 0.2, cR * 0.2, cx, cy, cR);
      bg.addColorStop(0, "rgba(14,32,58,1)"); bg.addColorStop(1, "rgba(4,12,28,1)");
      ctx.fillStyle = bg; ctx.fillRect(cx - cR, cy - cR, cR * 2, cR * 2);
      // 아바타 이미지 — 이미 머리(이어피스+헬멧+얼굴) 중심으로 정사각(920²) 크롭된 자산이라
      // 전체를 원에 그대로 채운다(코너는 원 클립이 잘라냄).
      const im = avImg.current;
      if (im && im.complete && im.naturalWidth) {
        ctx.drawImage(im, cx - cR, cy - cR, cR * 2, cR * 2);
      }
      // 시안 틴트
      ctx.globalCompositeOperation = "lighter";
      const tg = ctx.createRadialGradient(cx, cy - cR * 0.3, cR * 0.15, cx, cy, cR);
      tg.addColorStop(0, "rgba(0,150,255,0.04)"); tg.addColorStop(0.7, "rgba(0,200,255,0.10)"); tg.addColorStop(1, "rgba(90,40,170,0.20)");
      ctx.fillStyle = tg; ctx.fillRect(cx - cR, cy - cR, cR * 2, cR * 2);
      // 스캔라인
      ctx.strokeStyle = CY(0.05); ctx.lineWidth = 1;
      for (let yy = cy - cR; yy < cy + cR; yy += 5) { ctx.beginPath(); ctx.moveTo(cx - cR, yy); ctx.lineTo(cx + cR, yy); ctx.stroke(); }
      ctx.restore();

      // 사이버 림(이중) — 음성 진폭(act)에 맥동. 코드 헤드셋은 이미지가 자체 헬멧을 가지므로 제거.
      ctx.globalCompositeOperation = "lighter"; ctx.shadowColor = "rgba(0,229,255,0.9)"; ctx.shadowBlur = 16;
      ring(cR, 3, CY(0.7 + act * 0.3));
      ring(cR + 5, 1.5, MG(0.4 + act * 0.3));
      // 말할 때 원 테두리가 더 밝게 반응(헤드셋 제거분 보완)
      if (act > 0.02) { ctx.shadowBlur = 22; ring(cR + 2, 2.5, CY(Math.min(0.9, 0.3 + act))); }

      // 10) 코너 타게팅 브래킷
      ctx.shadowBlur = 8; ctx.strokeStyle = HI(0.45 + act * 0.4); ctx.lineWidth = 2.4;
      const d = R * 0.66, bl = R * 0.07;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const bx = cx + sx * d, by = cy + sy * d;
        ctx.beginPath(); ctx.moveTo(bx - sx * bl, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by - sy * bl); ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, speaking]);

  return <canvas ref={ref} className="jarvis-orb-canvas" width={600} height={600} role="img" aria-label="자비스" />;
}
