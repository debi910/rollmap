// Generates the simulated "community" layer for the Monaco demo by running simulated rides
// through the real analysis pipeline (same code the phone runs).
//
//   npx tsx scripts/build-seed.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RideAnalyzer, type WindowResult } from '../src/core/analyzer';
import { mulberry32 } from '../src/core/synth';
import { RoutableGraph } from '../src/geo/graph';
import type { StreetGraph } from '../src/geo/osm';
import { findRoute, PROFILES } from '../src/geo/router';
import { addRide, serializeSegments, topSurface, type SegmentMap } from '../src/geo/segments';
import { trueSurface } from '../src/sim/world';
import type { MlpModel } from '../src/ml/mlp';
import { simulateRide } from '../src/sim/rideSim';

const root = join(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(join(root, 'public/data/monaco.json'), 'utf8')) as StreetGraph;
const model = JSON.parse(readFileSync(join(root, 'src/ml/model.json'), 'utf8')) as MlpModel;
const graph = new RoutableGraph(data);
const rng = mulberry32(7);
const segments: SegmentMap = new Map();
const RIDES = Number(process.argv[2] ?? 60);

let made = 0;
let attempts = 0;
let windowsTotal = 0;
while (made < RIDES && attempts < RIDES * 10) {
  attempts++;
  const a = Math.floor(rng() * data.nodes.length);
  const b = Math.floor(rng() * data.nodes.length);
  // Riders take a mix of routes; a "walking" route that has no steps is still rideable.
  const profile = rng() < 0.5 ? PROFILES.walking : PROFILES.stroller;
  const route = findRoute(graph, new Map(), a, b, profile);
  if (!route || route.length < 300 || route.length > 2500 || route.stats.steps > 0) continue;
  const sim = simulateRide(graph, route.nodes, route.edges, 1000 + made);
  const analyzer = new RideAnalyzer(model);
  const windows: WindowResult[] = [];
  let f = 0;
  for (const s of sim.samples) {
    while (f < sim.fixes.length && sim.fixes[f].t <= s.t) analyzer.addFix(sim.fixes[f++]);
    windows.push(...analyzer.addSample(s));
  }
  addRide(segments, graph, `sim-${made}`, windows);
  windowsTotal += windows.length;
  made++;
}

// Validation against the simulator's ground truth: per-window and per-segment surface accuracy.
let segOk = 0;
let segTotal = 0;
for (const seg of segments.values()) {
  if (seg.n < 3) continue;
  const e = graph.edges[graph.edgeByKey.get(seg.key)!];
  const [la, lo] = data.nodes[e.a];
  const [lb, lob] = data.nodes[e.b];
  segTotal++;
  if (topSurface(seg) === trueSurface(e.way, (la + lb) / 2, (lo + lob) / 2)) segOk++;
}
console.log(`segment-level surface accuracy (>=3 windows): ${((100 * segOk) / segTotal).toFixed(1)}% of ${segTotal}`);

const round = (x: number) => Math.round(x * 1000) / 1000;
const compact = serializeSegments(segments).map((s) => ({
  ...s,
  awSq: round(s.awSq),
  maxPeak: round(s.maxPeak),
  maxTilt: round(s.maxTilt),
  surfaces: Object.fromEntries(Object.entries(s.surfaces).map(([k, v]) => [k, round(v)])),
}));
const out = { simulated: true, generated: new Date().toISOString().slice(0, 10), rides: made, segments: compact };
// Drop per-window detail that the app doesn't need, keep the file small.
writeFileSync(join(root, 'public/data/monaco-seed.json'), JSON.stringify(out));
console.log(`${made} simulated rides, ${windowsTotal} windows, ${segments.size} segments`);
