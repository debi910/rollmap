// Generates the sensor stream a phone in a wheelchair bag would record along a route.
// Powers the "Simulated ride" demo and the simulated seed data. Clearly labelled in the UI.

import { haversine, type GeoFix } from '../core/analyzer';
import type { RawSample } from '../core/features';
import { mulberry32, randomRotation, synthesize, type Rng } from '../core/synth';
import type { RoutableGraph } from '../geo/graph';
import { crossingHasCurb, potholeAt, trueSurface } from './world';

export interface SimRide {
  samples: RawSample[];
  fixes: GeoFix[];
  durationMs: number;
  path: { t: number; lat: number; lon: number }[];
}

export function simulateRide(graph: RoutableGraph, nodes: number[], edges: number[], seed: number, startMs = 0): SimRide {
  const rng: Rng = mulberry32(seed);
  const rotation = randomRotation(rng);
  const baseSpeed = 0.8 + rng() * 0.5;
  const samples: RawSample[] = [];
  const path: { t: number; lat: number; lon: number }[] = [];
  let t = startMs;

  edges.forEach((idx, i) => {
    const e = graph.edges[idx];
    const [la, lo] = graph.data.nodes[nodes[i]];
    const [lb, lob] = graph.data.nodes[nodes[i + 1]];
    const surface = trueSurface(e.way, (la + lb) / 2, (lo + lob) / 2);
    const speed = baseSpeed * (surface === 'smooth' ? 1 : 0.8) * (0.9 + rng() * 0.2);
    const seconds = Math.max(0.2, e.length / speed);
    const jolts: number[] = [];
    // One curb per crossing (its first segment) and at most one pothole per street.
    const segIndex = Number(e.key.split(':')[1]);
    if (crossingHasCurb(e.way) && segIndex === 0) jolts.push(0.1);
    const pothole = potholeAt(e.way);
    if (pothole != null && segIndex === Math.floor(pothole * (e.way.n.length - 1))) jolts.push(seconds * 0.5);
    const tilt = e.way.inc ? 4 + rng() * 3 : rng() * 1.2;
    samples.push(...synthesize({ surface, seconds, speed, rng, deviceHz: 60, startMs: t, jolts, tiltDeg: tilt }, rotation));
    path.push({ t, lat: la, lon: lo });
    t += seconds * 1000;
    path.push({ t, lat: lb, lon: lob });
  });

  // GPS: one fix per second with a few metres of noise, like a phone outdoors.
  const fixes: GeoFix[] = [];
  let k = 0;
  for (let ft = startMs; ft <= t; ft += 1000) {
    while (k < path.length - 2 && path[k + 1].t < ft) k++;
    const a = path[k];
    const b = path[Math.min(k + 1, path.length - 1)];
    const u = b.t > a.t ? (ft - a.t) / (b.t - a.t) : 0;
    const lat = a.lat + (b.lat - a.lat) * u;
    const lon = a.lon + (b.lon - a.lon) * u;
    const noise = 3 / 111320;
    const seg = haversine(a.lat, a.lon, b.lat, b.lon);
    fixes.push({
      t: ft,
      lat: lat + (rng() - 0.5) * 2 * noise,
      lon: lon + ((rng() - 0.5) * 2 * noise) / Math.cos((lat * Math.PI) / 180),
      accuracy: 5,
      speed: b.t > a.t ? seg / ((b.t - a.t) / 1000) : null,
    });
  }
  return { samples, fixes, durationMs: t - startMs, path };
}
