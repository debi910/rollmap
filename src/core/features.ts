import { fft } from './fft';
import { wkMagnitude } from './wk';

// Everything downstream works on fixed windows: 64 samples at 50 Hz (1.28 s).
export const FS = 50;
export const N = 64;
export const WINDOW_MS = (N / FS) * 1000;

export interface RawSample {
  t: number; // ms
  ax: number; // accelerationIncludingGravity, m/s²
  ay: number;
  az: number;
}

export interface WindowSignals {
  vertical: Float64Array; // dynamic acceleration along gravity, m/s²
  horizontal: Float64Array; // magnitude of dynamic acceleration perpendicular to gravity
  gravity: [number, number, number]; // mean gravity vector in the phone frame
}

/** Linear-interpolate irregular sensor samples onto the fixed 50 Hz grid ending at tEnd. */
export function resample(samples: RawSample[], tEnd: number): RawSample[] | null {
  const tStart = tEnd - WINDOW_MS;
  if (samples.length < 8 || samples[0].t > tStart + 100 || samples[samples.length - 1].t < tEnd - 100) {
    return null;
  }
  const out: RawSample[] = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const t = tStart + (i * 1000) / FS;
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[j + 1];
    const span = b.t - a.t || 1;
    const u = Math.min(1, Math.max(0, (t - a.t) / span));
    out.push({
      t,
      ax: a.ax + (b.ax - a.ax) * u,
      ay: a.ay + (b.ay - a.ay) * u,
      az: a.az + (b.az - a.az) * u,
    });
  }
  return out;
}

/**
 * The phone can sit in any orientation in a bag, so we never trust its axes.
 * Gravity (the window mean) tells us which way is down; vibration is projected onto it.
 */
export function splitAxes(win: RawSample[]): WindowSignals {
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (const s of win) {
    gx += s.ax;
    gy += s.ay;
    gz += s.az;
  }
  gx /= win.length;
  gy /= win.length;
  gz /= win.length;
  const gNorm = Math.hypot(gx, gy, gz) || 1;
  const ux = gx / gNorm;
  const uy = gy / gNorm;
  const uz = gz / gNorm;

  const vertical = new Float64Array(win.length);
  const horizontal = new Float64Array(win.length);
  win.forEach((s, i) => {
    const dx = s.ax - gx;
    const dy = s.ay - gy;
    const dz = s.az - gz;
    const v = dx * ux + dy * uy + dz * uz;
    vertical[i] = v;
    horizontal[i] = Math.hypot(dx - v * ux, dy - v * uy, dz - v * uz);
  });
  return { vertical, horizontal, gravity: [gx, gy, gz] };
}

export interface ComfortMetrics {
  aw: number; // ISO 2631 frequency-weighted RMS, m/s²
  vdvRate: number; // fourth-power dose of the weighted signal per second (VDV⁴ / s)
  peak: number; // max |vertical| unweighted, m/s²
}

export function comfortMetrics(vertical: Float64Array): ComfortMetrics {
  const re = Float64Array.from(vertical);
  const im = new Float64Array(N);
  const spec = fft(re, im);
  for (let k = 0; k < N; k++) {
    const f = (Math.min(k, N - k) * FS) / N;
    const g = wkMagnitude(f);
    spec.re[k] *= g;
    spec.im[k] *= g;
  }
  const weighted = fft(spec.re, spec.im, true).re;
  let sq = 0;
  let quad = 0;
  let peak = 0;
  for (let i = 0; i < N; i++) {
    sq += weighted[i] ** 2;
    quad += weighted[i] ** 4;
    peak = Math.max(peak, Math.abs(vertical[i]));
  }
  return { aw: Math.sqrt(sq / N), vdvRate: quad / N, peak };
}

export const BANDS: [number, number][] = [
  [0, 2],
  [2, 5],
  [5, 10],
  [10, 15],
  [15, 25.1],
];

export const FEATURE_NAMES = [
  'logRms',
  'logP2p',
  'crest',
  'logKurtosis',
  'zeroCrossRate',
  'band0_2',
  'band2_5',
  'band5_10',
  'band10_15',
  'band15_25',
  'spectralPeakiness',
  'autocorrPeak',
  'logJerkRms',
  'logHorizRms',
  'speed',
];

/** Feature vector for the surface classifier. Must stay identical between training and the app. */
export function extractFeatures(sig: WindowSignals, speed: number | null): number[] {
  const v = sig.vertical;
  let mean = 0;
  for (const x of v) mean += x;
  mean /= N;
  let m2 = 0;
  let m4 = 0;
  let min = Infinity;
  let max = -Infinity;
  let zc = 0;
  for (let i = 0; i < N; i++) {
    const d = v[i] - mean;
    m2 += d * d;
    m4 += d ** 4;
    min = Math.min(min, v[i]);
    max = Math.max(max, v[i]);
    if (i > 0 && (v[i - 1] - mean) * d < 0) zc++;
  }
  m2 /= N;
  m4 /= N;
  const rms = Math.sqrt(m2) + 1e-6;
  const kurt = m4 / (m2 * m2 + 1e-12);

  const spec = fft(
    v.map((x) => x - mean),
    new Float64Array(N),
  );
  const power: number[] = [];
  for (let k = 1; k <= N / 2; k++) power.push(spec.re[k] ** 2 + spec.im[k] ** 2);
  const total = power.reduce((a, b) => a + b, 0) + 1e-12;
  const bands = BANDS.map(([lo, hi]) => {
    let e = 0;
    power.forEach((p, idx) => {
      const f = ((idx + 1) * FS) / N;
      if (f >= lo && f < hi) e += p;
    });
    return e / total;
  });
  const peakiness = Math.max(...power) / (total / power.length);

  // Brick/paver joints make a regular rhythm; autocorrelation picks that up.
  let ac0 = 0;
  for (let i = 0; i < N; i++) ac0 += (v[i] - mean) ** 2;
  let acPeak = 0;
  for (let lag = 3; lag <= 25; lag++) {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += (v[i] - mean) * (v[i + lag] - mean);
    acPeak = Math.max(acPeak, s / (ac0 + 1e-12));
  }

  let jerk = 0;
  for (let i = 1; i < N; i++) jerk += ((v[i] - v[i - 1]) * FS) ** 2;
  const jerkRms = Math.sqrt(jerk / (N - 1)) + 1e-6;

  let h = 0;
  for (const x of sig.horizontal) h += x * x;
  const hRms = Math.sqrt(h / N) + 1e-6;

  return [
    Math.log(rms),
    Math.log(max - min + 1e-6),
    (Math.max(Math.abs(max - mean), Math.abs(min - mean)) / rms),
    Math.log(kurt + 1e-6),
    zc / N,
    ...bands,
    Math.log(peakiness + 1e-6),
    acPeak,
    Math.log(jerkRms),
    Math.log(hRms),
    speed == null || !Number.isFinite(speed) ? 1 : Math.min(3, Math.max(0, speed)),
  ];
}

/** Angle in degrees between this window's gravity and the calibrated "level" gravity. */
export function tiltDegrees(g: [number, number, number], level: [number, number, number]): number {
  const dot = g[0] * level[0] + g[1] * level[1] + g[2] * level[2];
  const n = Math.hypot(...g) * Math.hypot(...level) || 1;
  return (Math.acos(Math.min(1, Math.max(-1, dot / n))) * 180) / Math.PI;
}
