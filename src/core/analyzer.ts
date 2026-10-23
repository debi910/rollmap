// Streaming analysis: raw motion samples + GPS fixes in, one scored window every 0.64 s out.

import { comfortScore, isJolt } from './comfort';
import {
  comfortMetrics,
  extractFeatures,
  resample,
  splitAxes,
  tiltDegrees,
  WINDOW_MS,
  type RawSample,
} from './features';
import { predict, type MlpModel } from '../ml/mlp';

export interface GeoFix {
  t: number;
  lat: number;
  lon: number;
  accuracy: number; // metres
  speed: number | null; // m/s
}

export interface WindowResult {
  t: number; // window end, ms
  lat: number | null;
  lon: number | null;
  speed: number | null;
  aw: number;
  vdvRate: number;
  peak: number;
  score: number;
  surface: string;
  surfaceConfidence: number;
  jolt: boolean;
  tilt: number; // degrees vs. calibrated level
  label?: string; // ground-truth label when recording training data
  features: number[];
}

export const HOP_MS = WINDOW_MS / 2;

export class RideAnalyzer {
  private samples: RawSample[] = [];
  private fixes: GeoFix[] = [];
  private nextWindowEnd: number | null = null;
  private level: [number, number, number] | null = null;
  private tiltHistory: number[] = [];
  label: string | undefined;

  private model: MlpModel;

  constructor(model: MlpModel) {
    this.model = model;
  }

  addSample(s: RawSample): WindowResult[] {
    this.samples.push(s);
    if (this.nextWindowEnd == null) this.nextWindowEnd = s.t + WINDOW_MS;
    const out: WindowResult[] = [];
    while (s.t >= this.nextWindowEnd) {
      const r = this.analyze(this.nextWindowEnd);
      if (r) out.push(r);
      this.nextWindowEnd += HOP_MS;
    }
    const keepFrom = this.nextWindowEnd - WINDOW_MS - 500;
    while (this.samples.length && this.samples[0].t < keepFrom) this.samples.shift();
    return out;
  }

  addFix(f: GeoFix) {
    this.fixes.push(f);
    if (this.fixes.length > 50) this.fixes.shift();
  }

  /** Treat the current orientation as "flat ground" for tilt measurements. */
  calibrateLevel() {
    if (!this.samples.length) return;
    const recent = this.samples.slice(-50);
    const g: [number, number, number] = [0, 0, 0];
    for (const s of recent) {
      g[0] += s.ax / recent.length;
      g[1] += s.ay / recent.length;
      g[2] += s.az / recent.length;
    }
    this.level = g;
  }

  private locate(t: number): { lat: number; lon: number; speed: number | null } | null {
    if (!this.fixes.length) return null;
    // Interpolate between the fixes around t; GPS updates about once a second.
    let before = this.fixes[0];
    let after = this.fixes[this.fixes.length - 1];
    for (const f of this.fixes) {
      if (f.t <= t) before = f;
      if (f.t >= t) {
        after = f;
        break;
      }
    }
    if (Math.abs(before.t - t) > 10000 && Math.abs(after.t - t) > 10000) return null;
    const span = after.t - before.t;
    const u = span > 0 ? Math.min(1, Math.max(0, (t - before.t) / span)) : 0;
    let speed = after.speed ?? before.speed;
    if (speed == null && span > 0) {
      speed = haversine(before.lat, before.lon, after.lat, after.lon) / (span / 1000);
    }
    return {
      lat: before.lat + (after.lat - before.lat) * u,
      lon: before.lon + (after.lon - before.lon) * u,
      speed,
    };
  }

  private analyze(tEnd: number): WindowResult | null {
    const win = resample(this.samples, tEnd);
    if (!win) return null;
    const sig = splitAxes(win);
    if (!this.level) this.level = sig.gravity;
    const loc = this.locate(tEnd - WINDOW_MS / 2);
    const features = extractFeatures(sig, loc?.speed ?? null);
    const metrics = comfortMetrics(sig.vertical);
    const pred = predict(this.model, features);
    const crest = features[2];

    this.tiltHistory.push(tiltDegrees(sig.gravity, this.level));
    if (this.tiltHistory.length > 5) this.tiltHistory.shift();
    const tilt = [...this.tiltHistory].sort((a, b) => a - b)[Math.floor(this.tiltHistory.length / 2)];

    return {
      t: tEnd,
      lat: loc?.lat ?? null,
      lon: loc?.lon ?? null,
      speed: loc?.speed ?? null,
      ...metrics,
      score: comfortScore(metrics.aw),
      surface: pred.label,
      surfaceConfidence: Math.max(...pred.probs),
      jolt: isJolt(metrics.peak, crest),
      tilt,
      label: this.label,
      features,
    };
  }
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
