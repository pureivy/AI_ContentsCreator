import { useEffect, useRef } from "react";

/** Web Audio AnalyserNode 의 시간영역 데이터를 canvas 에 실시간 파형으로 그린다.
 *  variant=strip(입력 하단 바) / card(읽는 메시지 인라인). active=false면 정지·클리어. */
export function Waveform({ analyser, variant, active }: {
  analyser: AnalyserNode | null;
  variant: "strip" | "card";
  active: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !analyser || !active) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = variant === "strip" ? "#7c9cff" : "#9b8cff";
      ctx.beginPath();
      const slice = w / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const y = (buf[i]! / 128) * (h / 2);
        const x = i * slice;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, variant, active]);

  return (
    <canvas
      ref={ref}
      className={variant === "strip" ? "waveform-strip" : "waveform-card"}
      width={variant === "strip" ? 320 : 120}
      height={variant === "strip" ? 36 : 20}
      aria-hidden
    />
  );
}
