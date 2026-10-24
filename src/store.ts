// Local persistence. Everything a rider records stays on their phone unless they export it.

import type { WindowResult } from './core/analyzer';
import type { SegmentStats } from './geo/segments';

export type BarrierKind = 'blocked' | 'no_ramp' | 'lift' | 'hazard';

export interface Issue {
  id: string;
  kind: 'jolt' | 'rough' | 'steep' | 'barrier';
  barrier?: BarrierKind; // set for problems a person reported by hand
  edgeKey?: string; // street segment the barrier sits on, so routing can avoid it
  lat: number;
  lon: number;
  t: number;
  peakG?: number;
  score?: number;
  tilt?: number;
  lengthM?: number;
  street?: string;
  rideId: string;
  simulated: boolean;
}

export interface RideRecord {
  id: string;
  started: number;
  ended: number;
  simulated: boolean;
  distanceM: number;
  score: number;
  aw: number;
  vdv: number;
  healthZone: 'below' | 'caution' | 'likely-risk';
  windows: Pick<WindowResult, 't' | 'lat' | 'lon' | 'score' | 'surface' | 'jolt' | 'tilt' | 'aw' | 'peak'>[];
  issues: Issue[];
}

const KEY_RIDES = 'rollmap.rides.v1';
const KEY_SEGMENTS = 'rollmap.segments.v1';
const KEY_TRAINING = 'rollmap.training.v1';
const KEY_BARRIERS = 'rollmap.barriers.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the app still works for this session.
  }
}

export const loadRides = () => read<RideRecord[]>(KEY_RIDES, []);
export const saveRides = (rides: RideRecord[]) => write(KEY_RIDES, rides.slice(-30));
export const loadMySegments = () => read<SegmentStats[]>(KEY_SEGMENTS, []);
export const saveMySegments = (s: SegmentStats[]) => write(KEY_SEGMENTS, s);

// Construction and broken lifts are temporary: they drop off after two weeks unless re-reported.
export const TEMPORARY_BARRIERS: BarrierKind[] = ['blocked', 'lift'];
export const BARRIER_TTL_MS = 14 * 24 * 3600 * 1000;
export const barrierExpired = (b: Issue, now = Date.now()) => !!b.barrier && TEMPORARY_BARRIERS.includes(b.barrier) && now - b.t > BARRIER_TTL_MS;
export const loadBarriers = () => read<Issue[]>(KEY_BARRIERS, []).filter((b) => !barrierExpired(b));
export const saveBarriers = (b: Issue[]) => write(KEY_BARRIERS, b);

export interface TrainingWindow {
  label: string;
  features: number[];
  t: number;
}
export const loadTraining = () => read<TrainingWindow[]>(KEY_TRAINING, []);
export const saveTraining = (w: TrainingWindow[]) => write(KEY_TRAINING, w.slice(-20000));

export function clearAll() {
  for (const k of [KEY_RIDES, KEY_SEGMENTS, KEY_TRAINING, KEY_BARRIERS]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

export function download(filename: string, data: unknown, type = 'application/json') {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
