import { useEffect, useRef } from 'react';
import NumberFlow from '@number-flow/react';
import clsx from 'clsx';
import { comfortBand, scoreColor } from '../core/comfort';

export function Gauge({ score, aw, size = 148 }: { score: number | null; aw: number | null; size?: number }) {
  const r = 58;
  const arc = 2 * Math.PI * r * 0.75;
  const pct = score == null ? 0 : score / 100;
  const color = score == null ? 'var(--gray-6)' : scoreColor(score);
  return (
    <div className="gauge" role="img" aria-label={score == null ? 'Comfort score: waiting for data' : `Comfort score ${score} out of 100`}>
      <svg viewBox="0 0 140 140" width={size} height={size}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--gray-3)" strokeWidth="10" strokeDasharray={`${arc} 999`} strokeLinecap="round" transform="rotate(135 70 70)" />
        <circle
          className="gauge-arc"
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${arc * pct} 999`}
          strokeLinecap="round"
          transform="rotate(135 70 70)"
        />
      </svg>
      <div className="gauge-center">
        <div className="gauge-num">{score == null ? '–' : <NumberFlow value={score} />}</div>
        <div className="gauge-sub">comfort</div>
      </div>
      <div className="gauge-label" style={{ color }}>
        {aw == null ? 'Waiting for movement' : comfortBand(aw).label}
      </div>
    </div>
  );
}

/** Live vertical-acceleration trace: the seismograph of the ride. */
export function Waveform({ trace }: { trace: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const styles = getComputedStyle(cv);
    ctx.strokeStyle = styles.getPropertyValue('--gray-4');
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const scale = h / 2 / 8; // ±8 m/s² full scale
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.25, styles.getPropertyValue('--accent'));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    trace.forEach((v, i) => {
      const x = (i / 240) * w;
      const y = h / 2 - Math.max(-8, Math.min(8, v)) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [trace]);
  return <canvas ref={ref} className="wave" aria-label="Live vibration trace" />;
}

export function Stat({ label, value, unit, hint, decimals = 0 }: { label: string; value: number | string | null; unit?: string; hint?: string; decimals?: number }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-v">
        {value == null ? '–' : typeof value === 'number' ? <NumberFlow value={value} format={{ maximumFractionDigits: decimals, minimumFractionDigits: decimals }} /> : value}
        {unit && value != null && <span className="stat-u">{unit}</span>}
      </div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

export function Legend({ showSegments, onToggle }: { showSegments: boolean; onToggle: () => void }) {
  return (
    <div className="legend">
      <button className={clsx('legend-toggle', !showSegments && 'is-off')} onClick={onToggle} aria-pressed={showSegments}>
        <span className="legend-title">Sidewalk comfort</span>
        <span className="legend-bar" aria-hidden />
        <span className="legend-ends">
          <span>Smooth</span>
          <span>Very rough</span>
        </span>
      </button>
      <div className="legend-keys">
        <span>
          <i className="k-steps" /> Steps
        </span>
        <span>
          <i className="k-route" /> Route
        </span>
        <span>
          <i className="k-lift" /> Lift
        </span>
      </div>
    </div>
  );
}
