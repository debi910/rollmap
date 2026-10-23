// Aggregating ride windows into per-street-segment knowledge: the shared RollMap layer.

import { comfortScore } from '../core/comfort';
import type { WindowResult } from '../core/analyzer';
import type { RoutableGraph } from './graph';

export interface SegmentStats {
  key: string;
  awSq: number; // sum of aw² (energy average keeps one terrible stretch from being hidden)
  n: number;
  jolts: number;
  maxPeak: number;
  maxTilt: number;
  surfaces: Record<string, number>;
  rides: string[];
  lastSeen: number;
}

export type SegmentMap = Map<string, SegmentStats>;

export function segmentScore(s: SegmentStats): number {
  const base = comfortScore(Math.sqrt(s.awSq / s.n));
  // Each jolt on a segment knocks the score down: a single curb drop can tip a chair.
  return Math.max(0, base - Math.min(40, joltsPerRide(s) * 15));
}

/** Jolts are counted per pass so a busy segment isn't punished for being popular. */
export function joltsPerRide(s: SegmentStats): number {
  return s.jolts / Math.max(1, s.rides.length);
}

export function topSurface(s: SegmentStats): string | null {
  let best: string | null = null;
  for (const [k, v] of Object.entries(s.surfaces)) if (!best || v > s.surfaces[best]) best = k;
  return best;
}

export function addRide(map: SegmentMap, graph: RoutableGraph, rideId: string, windows: WindowResult[]) {
  for (const w of windows) {
    if (w.lat == null || w.lon == null) continue;
    const hit = graph.nearestEdge(w.lat, w.lon, 12);
    if (!hit) continue;
    const key = graph.edges[hit.edge].key;
    let s = map.get(key);
    if (!s) {
      s = { key, awSq: 0, n: 0, jolts: 0, maxPeak: 0, maxTilt: 0, surfaces: {}, rides: [], lastSeen: 0 };
      map.set(key, s);
    }
    s.awSq += w.aw * w.aw;
    s.n++;
    if (w.jolt) s.jolts++;
    s.maxPeak = Math.max(s.maxPeak, w.peak);
    s.maxTilt = Math.max(s.maxTilt, w.tilt);
    s.surfaces[w.surface] = (s.surfaces[w.surface] ?? 0) + w.surfaceConfidence;
    if (!s.rides.includes(rideId)) s.rides.push(rideId);
    s.lastSeen = Math.max(s.lastSeen, w.t);
  }
}

export function mergeSegments(...maps: SegmentMap[]): SegmentMap {
  const out: SegmentMap = new Map();
  for (const m of maps) {
    for (const s of m.values()) {
      const o = out.get(s.key);
      if (!o) {
        out.set(s.key, { ...s, surfaces: { ...s.surfaces }, rides: [...s.rides] });
        continue;
      }
      o.awSq += s.awSq;
      o.n += s.n;
      o.jolts += s.jolts;
      o.maxPeak = Math.max(o.maxPeak, s.maxPeak);
      o.maxTilt = Math.max(o.maxTilt, s.maxTilt);
      for (const [k, v] of Object.entries(s.surfaces)) o.surfaces[k] = (o.surfaces[k] ?? 0) + v;
      for (const r of s.rides) if (!o.rides.includes(r)) o.rides.push(r);
      o.lastSeen = Math.max(o.lastSeen, s.lastSeen);
    }
  }
  return out;
}

export const serializeSegments = (m: SegmentMap) => [...m.values()];
export const deserializeSegments = (list: SegmentStats[]): SegmentMap => new Map(list.map((s) => [s.key, s]));
