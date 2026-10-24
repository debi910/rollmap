// Smoothest-route search. Cost = metres x discomfort factor, where discomfort blends what
// riders have measured on each segment with what OpenStreetMap tags say about it.

import type { Edge, RoutableGraph } from './graph';
import type { BarrierKind } from '../store';
import { joltsPerRide, segmentScore, topSurface, type SegmentMap } from './segments';

export type ProfileId = 'manual' | 'power' | 'stroller' | 'walking';

export interface Profile {
  id: ProfileId;
  label: string;
  stepsAllowed: boolean;
  roughSensitivity: number; // how much a bad segment costs relative to distance
  joltPenalty: number; // metres-equivalent added per measured jolt
  maxInclinePct: number;
}

export const PROFILES: Record<ProfileId, Profile> = {
  manual: { id: 'manual', label: 'Manual wheelchair', stepsAllowed: false, roughSensitivity: 3, joltPenalty: 60, maxInclinePct: 8 },
  power: { id: 'power', label: 'Power wheelchair', stepsAllowed: false, roughSensitivity: 1.5, joltPenalty: 40, maxInclinePct: 12 },
  stroller: { id: 'stroller', label: 'Stroller / pram', stepsAllowed: false, roughSensitivity: 1.2, joltPenalty: 20, maxInclinePct: 15 },
  walking: { id: 'walking', label: 'Shortest walking route', stepsAllowed: true, roughSensitivity: 0, joltPenalty: 0, maxInclinePct: 100 },
};

// Prior discomfort for surfaces, used when nobody has measured a segment yet.
const SURFACE_PRIOR: Record<string, number> = {
  asphalt: 0,
  concrete: 0.05,
  paved: 0.05,
  'concrete:plates': 0.2,
  paving_stones: 0.35,
  sett: 0.7,
  cobblestone: 0.9,
  unhewn_cobblestone: 1,
  compacted: 0.4,
  fine_gravel: 0.5,
  gravel: 0.9,
  pebblestone: 0.9,
  dirt: 0.7,
  grass: 1,
  sand: 1,
  wood: 0.3,
};
const MEASURED_SURFACE_PENALTY: Record<string, number> = { smooth: 0, pavers: 0.35, rough: 0.7, gravel: 0.9 };

export function inclinePct(tag: string | undefined): number | null {
  if (!tag) return null;
  const m = /(-?\d+(\.\d+)?)\s*%/.exec(tag);
  if (m) return Math.abs(Number(m[1]));
  if (tag === 'up' || tag === 'down') return 10; // OSM convention for "noticeably steep", value unknown
  return null;
}

export interface EdgeAssessment {
  passable: boolean;
  factor: number; // >= 1
  discomfort: number; // 0..1, for stats
  measured: boolean;
  reason?: string;
}

export function assessEdge(e: Edge, segments: SegmentMap, p: Profile, barriers?: Map<string, BarrierKind>): EdgeAssessment {
  const w = e.way;
  const barrier = barriers?.get(e.key);
  if (barrier && barrier !== 'hazard' && p.id !== 'walking') return { passable: false, factor: Infinity, discomfort: 1, measured: false, reason: 'reported barrier' };
  if (w.h === 'steps' && !p.stepsAllowed) return { passable: false, factor: Infinity, discomfort: 1, measured: false, reason: 'steps' };
  if (w.wc === 'no' && p.id !== 'walking') return { passable: false, factor: Infinity, discomfort: 1, measured: false, reason: 'tagged not wheelchair accessible' };
  const inc = inclinePct(w.inc);
  if (inc != null && inc > p.maxInclinePct) {
    return { passable: false, factor: Infinity, discomfort: 1, measured: false, reason: `incline ${inc}%` };
  }

  const seg = segments.get(e.key);
  let discomfort: number;
  let measured = false;
  if (seg && seg.n >= 2) {
    measured = true;
    discomfort = 1 - segmentScore(seg) / 100;
    const surf = topSurface(seg);
    if (surf) discomfort = Math.max(discomfort, MEASURED_SURFACE_PENALTY[surf] ?? 0);
  } else {
    discomfort = SURFACE_PRIOR[w.s ?? ''] ?? (w.h === 'path' || w.h === 'track' ? 0.5 : 0.15);
  }
  // Big roads without a mapped sidewalk are stressful and often lack curb ramps.
  const trafficPenalty = ['primary', 'secondary', 'primary_link', 'secondary_link'].includes(w.h) ? 0.3 : 0;
  const joltCost = seg ? (p.joltPenalty * joltsPerRide(seg)) / Math.max(1, e.length) : 0;
  const hazardCost = barrier === 'hazard' ? 2 : 0;
  const factor = 1 + p.roughSensitivity * (discomfort + trafficPenalty) + (inc != null ? inc / 10 : 0) + joltCost + hazardCost;
  return { passable: true, factor, discomfort, measured };
}

export interface RouteResult {
  nodes: number[];
  edges: number[];
  length: number;
  coords: [number, number][];
  stats: {
    steps: number;
    roughMetres: number;
    measuredMetres: number;
    jolts: number;
    comfort: number; // length-weighted 0..100
  };
}

export function findRoute(
  graph: RoutableGraph,
  segments: SegmentMap,
  from: number,
  to: number,
  profile: Profile,
  barriers?: Map<string, BarrierKind>,
): RouteResult | null {
  const n = graph.data.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevNode = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  // Binary heap of [cost, node]
  const heap: [number, number][] = [[0, from]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const cache = new Map<number, EdgeAssessment>();
  const assess = (idx: number) => {
    let a = cache.get(idx);
    if (!a) cache.set(idx, (a = assessEdge(graph.edges[idx], segments, profile, barriers)));
    return a;
  };

  while (heap.length) {
    const [d, u] = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    for (const { edge, to: v } of graph.adjacency[u]) {
      const a = assess(edge);
      if (!a.passable) continue;
      const nd = d + graph.edges[edge].length * (profile.id === 'walking' ? 1 : a.factor);
      if (nd < dist[v]) {
        dist[v] = nd;
        prevEdge[v] = edge;
        prevNode[v] = u;
        push([nd, v]);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;

  const nodes: number[] = [to];
  const edges: number[] = [];
  for (let v = to; v !== from; v = prevNode[v]) {
    edges.push(prevEdge[v]);
    nodes.push(prevNode[v]);
  }
  nodes.reverse();
  edges.reverse();

  let length = 0;
  const stepWays = new Set<number>();
  let rough = 0;
  let measured = 0;
  let jolts = 0;
  let comfortSum = 0;
  const manual = PROFILES.manual;
  for (const idx of edges) {
    const e = graph.edges[idx];
    length += e.length;
    if (e.way.h === 'steps') stepWays.add(e.way.id);
    const a = assessEdge(e, segments, { ...manual, stepsAllowed: true });
    if (a.discomfort >= 0.45) rough += e.length;
    if (a.measured) measured += e.length;
    comfortSum += (1 - a.discomfort) * 100 * e.length;
    const seg = segments.get(e.key);
    if (seg) jolts += joltsPerRide(seg);
  }
  return {
    nodes,
    edges,
    length,
    coords: nodes.map((i) => graph.data.nodes[i]),
    stats: {
      steps: stepWays.size,
      roughMetres: rough,
      measuredMetres: measured,
      jolts: Math.round(jolts),
      comfort: length > 0 ? Math.round(comfortSum / length) : 100,
    },
  };
}
