// Physics-inspired generator for wheel-on-surface vibration as a phone would record it.
// Used for two things: bootstrapping the classifier before we have lots of real rides,
// and the clearly-labelled "Simulated ride" demo mode.

import type { RawSample } from './features';

export const SURFACES = ['smooth', 'rough', 'pavers', 'gravel'] as const;
export type Surface = (typeof SURFACES)[number];

export const SURFACE_LABELS: Record<Surface, string> = {
  smooth: 'Smooth pavement',
  rough: 'Cracked / broken',
  pavers: 'Bricks / pavers',
  gravel: 'Gravel / grass',
};

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniform = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
const gauss = (rng: Rng) => {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

interface SurfaceParams {
  noise: [number, number]; // input acceleration noise std, m/s²
  cutoff: [number, number]; // noise low-pass, Hz
  impulsesPerMeter: [number, number];
  impulseAmp: [number, number];
  periodic?: { spacing: [number, number]; amp: [number, number] };
}

const PARAMS: Record<Surface, SurfaceParams> = {
  smooth: { noise: [0.12, 0.35], cutoff: [8, 16], impulsesPerMeter: [0, 0.05], impulseAmp: [1, 2] },
  rough: { noise: [0.5, 1.1], cutoff: [10, 20], impulsesPerMeter: [0.6, 1.6], impulseAmp: [3, 8] },
  pavers: {
    noise: [0.25, 0.55],
    cutoff: [8, 16],
    impulsesPerMeter: [0, 0.1],
    impulseAmp: [2, 3],
    periodic: { spacing: [0.1, 0.3], amp: [1.5, 4] },
  },
  gravel: { noise: [1.1, 2.4], cutoff: [18, 24], impulsesPerMeter: [2, 5], impulseAmp: [1, 3] },
};

export interface SynthOptions {
  surface: Surface;
  seconds: number;
  speed: number; // m/s
  rng: Rng;
  deviceHz?: number; // sensor rate to emulate
  startMs?: number;
  jolts?: number[]; // seconds into the segment where a curb drop / pothole happens
  tiltDeg?: number; // ground slope during the segment
}

/** Random rotation so the generated phone is in an arbitrary orientation, like in a bag. */
function randomRotation(rng: Rng): number[][] {
  const [a, b, c] = [uniform(rng, 0, 2 * Math.PI), Math.acos(uniform(rng, -1, 1)), uniform(rng, 0, 2 * Math.PI)];
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [
    [ca * cc - sa * cb * sc, -ca * sc - sa * cb * cc, sa * sb],
    [sa * cc + ca * cb * sc, -sa * sc + ca * cb * cc, -ca * sb],
    [sb * sc, sb * cc, cb],
  ];
}

export function synthesize(opts: SynthOptions, rotation?: number[][]): RawSample[] {
  const { surface, seconds, speed, rng } = opts;
  const p = PARAMS[surface];
  const simHz = 400;
  const dt = 1 / simHz;
  const steps = Math.round(seconds * simHz);
  const speedGain = Math.pow(Math.max(0.3, speed), 0.8);

  const noiseStd = uniform(rng, ...p.noise) * speedGain;
  const cutoff = uniform(rng, ...p.cutoff);
  const lpA = Math.exp((-2 * Math.PI * cutoff) / simHz);
  const impulseRate = uniform(rng, ...p.impulsesPerMeter) * speed; // per second
  const period = p.periodic ? uniform(rng, ...p.periodic.spacing) / Math.max(0.3, speed) : 0;
  const periodicAmp = p.periodic ? uniform(rng, ...p.periodic.amp) * speedGain : 0;

  // Wheelchair + seat + bag behaves like a damped mass-spring excited at its base.
  const fn = uniform(rng, 4, 9);
  const zeta = uniform(rng, 0.2, 0.45);
  const wn = 2 * Math.PI * fn;
  const pickup = uniform(rng, 0.6, 1.4);
  const lateral = uniform(rng, 0.25, 0.6);
  const sensorNoise = uniform(rng, 0.02, 0.08);
  const R = rotation ?? randomRotation(rng);

  const tilt = ((opts.tiltDeg ?? 0) * Math.PI) / 180;
  const gWorld = [9.81 * Math.sin(tilt), 0, 9.81 * Math.cos(tilt)];
  const joltSteps = new Set((opts.jolts ?? []).map((s) => Math.round(s * simHz)));

  let colored = 0;
  let coloredLat = 0;
  let x = 0; // relative displacement of the phone mass
  let v = 0;
  let nextPeriodic = period ? uniform(rng, 0, period) : Infinity;
  let pulse = 0; // remaining pulse samples
  let pulseAmp = 0;

  const input = new Float64Array(steps);
  const out = new Float64Array(steps);
  const lat = new Float64Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    colored = lpA * colored + (1 - lpA) * gauss(rng) * noiseStd * 3;
    coloredLat = lpA * coloredLat + (1 - lpA) * gauss(rng) * noiseStd * 3;
    let u = colored;
    if (rng() < impulseRate * dt) {
      pulse = 8;
      pulseAmp = uniform(rng, ...p.impulseAmp) * speedGain * (rng() < 0.5 ? 1 : -1);
    }
    if (t >= nextPeriodic) {
      pulse = 6;
      pulseAmp = periodicAmp * uniform(rng, 0.8, 1.2);
      nextPeriodic += period * uniform(rng, 0.9, 1.1);
    }
    if (joltSteps.has(i)) {
      pulse = 10;
      pulseAmp = -uniform(rng, 45, 90);
    }
    if (pulse > 0) {
      u += pulseAmp * Math.sin((Math.PI * pulse) / 8);
      pulse--;
    }
    input[i] = u;
    // Base excitation: the bag is pulled along by the frame through a spring and damper.
    const acc = -2 * zeta * wn * v - wn * wn * x - u;
    v += acc * dt;
    x += v * dt;
    out[i] = (acc + u) * pickup;
    lat[i] = coloredLat * lateral * pickup;
  }

  const deviceHz = opts.deviceHz ?? 60;
  const startMs = opts.startMs ?? 0;
  const samples: RawSample[] = [];
  let tDev = 0;
  while (tDev < seconds) {
    const i = Math.min(steps - 1, Math.round(tDev * simHz));
    const world = [gWorld[0] + lat[i], gWorld[1] + lat[i] * 0.5, gWorld[2] + out[i]];
    const s = [0, 1, 2].map((r) => R[r][0] * world[0] + R[r][1] * world[1] + R[r][2] * world[2] + gauss(rng) * sensorNoise);
    samples.push({ t: startMs + tDev * 1000, ax: s[0], ay: s[1], az: s[2] });
    tDev += (1 / deviceHz) * uniform(rng, 0.9, 1.1);
  }
  return samples;
}

export { randomRotation };
