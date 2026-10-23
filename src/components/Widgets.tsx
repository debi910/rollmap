import { useEffect, useRef } from 'react';
import { comfortBand, scoreColor } from '../core/comfort';

export function Gauge({ score, aw }: { score: number | null; aw: number | null }) {
  const r = 52;
  const c = 2 * Math.PI * r * 0.75;
  const pct = score == null ? 0 : score / 100;
  const color = score == null ? 'var(--muted)' : scoreColor(score);
  return (
    <div className="gauge" role="img" aria-label={score == null ? 'Comfort score: waiting for data' : `Comfort score ${score} out of 100`}>
      <svg viewBox="0 0 128 128" width="128" height="128">
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--track)" strokeWidth="12" strokeDasharray={`${c} 999`} strokeLinecap="round" transform="rotate(135 64 64)" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={`${c * pct} 999`}
          strokeLinecap="round"
          transform="rotate(135 64 64)"
          style={{ transition: 'stroke-dasharray 0.3s, stroke 0.3s' }}
        />
        <text x="64" y="68" textAnchor="middle" className="gauge-num">
          {score ?? '–'}
        </text>
        <text x="64" y="90" textAnchor="middle" className="gauge-sub">
          comfort
        </text>
      </svg>
      <div className="gauge-label" style={{ color }}>
        {aw == null ? 'Waiting for movement' : comfortBand(aw).label}
      </div>
    </div>
  );
}

/** Live vertical-acceleration trace, the "seismograph" of the ride. */
export function Waveform({ trace }: { trace: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== w * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const styles = getComputedStyle(cv);
    ctx.strokeStyle = styles.getPropertyValue('--track');
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    const scale = h / 2 / 15; // ±15 m/s² full scale
    ctx.strokeStyle = styles.getPropertyValue('--accent');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trace.forEach((v, i) => {
      const x = (i / 240) * w;
      const y = h / 2 - Math.max(-15, Math.min(15, v)) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [trace]);
  return <canvas ref={ref} className="wave" aria-label="Live vibration trace" />;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-v">{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

export function Legend() {
  const items: [number, string][] = [
    [95, 'Smooth'],
    [65, 'OK'],
    [45, 'Bumpy'],
    [25, 'Rough'],
    [5, 'Very rough'],
  ];
  return (
    <div className="legend" aria-label="Map legend">
      {items.map(([s, l]) => (
        <span key={l}>
          <i style={{ background: scoreColor(s) }} />
          {l}
        </span>
      ))}
      <span>
        <i className="legend-steps" />
        Steps
      </span>
    </div>
  );
}
