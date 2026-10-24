import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { wkMagnitude } from '../src/core/wk';
import { comfortScore, exposure } from '../src/core/comfort';
import { comfortMetrics, extractFeatures, resample, splitAxes, WINDOW_MS, type RawSample } from '../src/core/features';
import { mulberry32, randomRotation, synthesize } from '../src/core/synth';
import { RideAnalyzer } from '../src/core/analyzer';
import { RoutableGraph } from '../src/geo/graph';
import { findRoute, PROFILES } from '../src/geo/router';
import type { MlpModel } from '../src/ml/mlp';
import type { StreetGraph } from '../src/geo/osm';

const model = JSON.parse(readFileSync('src/ml/model.json', 'utf8')) as MlpModel;

describe('ISO 2631-1 Wk weighting', () => {
  // Reference values from ISO 2631-1:1997 Table 3 (Wk, x1000).
  it.each([
    [1, 0.482],
    [2, 0.531],
    [5, 1.036],
    [8, 1.036],
    [16, 0.768],
  ])('at %f Hz is close to %f', (f, ref) => {
    expect(wkMagnitude(f)).toBeCloseTo(ref, 1);
  });
});

describe('comfort scoring', () => {
  it('is monotonic and bounded', () => {
    expect(comfortScore(0.1)).toBe(100);
    expect(comfortScore(3)).toBe(0);
    expect(comfortScore(0.5)).toBeGreaterThan(comfortScore(1));
  });
  it('weighted RMS of a 6 Hz, 1 m/s² RMS sine is about 1 m/s²', () => {
    const v = Float64Array.from({ length: 64 }, (_, i) => Math.SQRT2 * Math.sin((2 * Math.PI * 6.25 * i) / 50));
    expect(comfortMetrics(v).aw).toBeCloseTo(wkMagnitude(6.25), 1);
  });
  it('maps daily exposure onto ISO health zones', () => {
    expect(exposure([{ aw: 0.3, vdvRate: 0.01, seconds: 60 }]).healthZone).toBe('below');
    expect(exposure([{ aw: 1.2, vdvRate: 1, seconds: 60 }]).healthZone).toBe('likely-risk');
  });
});

describe('orientation independence', () => {
  it('gives the same vertical signal however the phone is held', () => {
    const rng = mulberry32(1);
    const a = synthesize({ surface: 'rough', seconds: 3, speed: 1, rng: mulberry32(5), deviceHz: 50 }, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const b = synthesize({ surface: 'rough', seconds: 3, speed: 1, rng: mulberry32(5), deviceHz: 50 }, randomRotation(rng));
    const fa = extractFeatures(splitAxes(resample(a, 2000)!), 1);
    const fb = extractFeatures(splitAxes(resample(b, 2000)!), 1);
    expect(fa[0]).toBeCloseTo(fb[0], 1); // log RMS of vertical vibration
  });
});

describe('analyzer', () => {
  it('scores smooth pavement better than gravel and catches a curb drop', () => {
    const run = (samples: RawSample[]) => {
      const an = new RideAnalyzer(model);
      return samples.flatMap((s) => an.addSample(s));
    };
    const smooth = run(synthesize({ surface: 'smooth', seconds: 10, speed: 1, rng: mulberry32(2) }));
    const gravel = run(synthesize({ surface: 'gravel', seconds: 10, speed: 1, rng: mulberry32(3) }));
    const curb = run(synthesize({ surface: 'smooth', seconds: 6, speed: 1, rng: mulberry32(4), jolts: [3] }));
    const mean = (w: { score: number }[]) => w.reduce((s, x) => s + x.score, 0) / w.length;
    expect(mean(smooth)).toBeGreaterThan(mean(gravel) + 30);
    expect(curb.some((w) => w.jolt)).toBe(true);
    expect(smooth.some((w) => w.jolt)).toBe(false);
    expect(smooth.length).toBeGreaterThan(10);
    expect(WINDOW_MS).toBe(1280);
  });
});

describe('router', () => {
  const data = JSON.parse(readFileSync('public/data/monaco.json', 'utf8')) as StreetGraph;
  const g = new RoutableGraph(data);
  it('never sends a wheelchair up steps, while the walking route may use them', () => {
    const noSteps = (e: { way: { h: string } }) => e.way.h !== 'steps';
    const a = g.nearestNode(43.73405, 7.42161, noSteps)!;
    const b = g.nearestNode(43.73845, 7.41924, noSteps)!;
    const walk = findRoute(g, new Map(), a, b, PROFILES.walking)!;
    const chair = findRoute(g, new Map(), a, b, PROFILES.manual)!;
    expect(walk.stats.steps).toBeGreaterThan(0);
    expect(chair.stats.steps).toBe(0);
    expect(chair.length).toBeGreaterThan(walk.length);
  });

  it('routes around a street someone reported as blocked', () => {
    const noSteps = (e: { way: { h: string } }) => e.way.h !== 'steps';
    const a = g.nearestNode(43.73405, 7.42161, noSteps)!;
    const b = g.nearestNode(43.73845, 7.41924, noSteps)!;
    const before = findRoute(g, new Map(), a, b, PROFILES.manual)!;
    const blockedEdge = g.edges[before.edges[Math.floor(before.edges.length / 2)]];
    const barriers = new Map([[blockedEdge.key, 'blocked' as const]]);
    const after = findRoute(g, new Map(), a, b, PROFILES.manual, barriers)!;
    expect(after.edges.map((i) => g.edges[i].key)).not.toContain(blockedEdge.key);
    expect(after.stats.steps).toBe(0);
  });
});
