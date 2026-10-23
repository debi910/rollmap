// Local persistence. Everything a rider records stays on their phone unless they export it.

import type { WindowResult } from './core/analyzer';
import type { SegmentStats } from './geo/segments';

export interface Issue {
  id: string;
  kind: 'jolt' | 'rough' | 'steep';
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

export interface TrainingWindow {
  label: string;
  features: number[];
  t: number;
}
export const loadTraining = () => read<TrainingWindow[]>(KEY_TRAINING, []);
export const saveTraining = (w: TrainingWindow[]) => write(KEY_TRAINING, w.slice(-20000));

export function clearAll() {
  for (const k of [KEY_RIDES, KEY_SEGMENTS, KEY_TRAINING]) {
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
