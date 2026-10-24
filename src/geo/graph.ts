// Routable graph built from the compact street graph, plus a grid index for snapping
// GPS points from rides onto the street segments they belong to.

import { haversine } from '../core/analyzer';
import type { StreetGraph, StreetWay } from './osm';

export interface Edge {
  key: string; // `${wayId}:${segment}` — stable across rebuilds of the same OSM data
  a: number; // node index
  b: number;
  way: StreetWay;
  length: number; // metres
}

export class RoutableGraph {
  readonly edges: Edge[] = [];
  readonly adjacency: { edge: number; to: number }[][];
  readonly edgeByKey = new Map<string, number>();
  private grid = new Map<string, number[]>();
  private readonly cell = 0.0003; // ~30 m

  readonly data: StreetGraph;

  constructor(data: StreetGraph) {
    this.data = data;
    this.adjacency = data.nodes.map(() => []);
    for (const way of data.ways) {
      for (let i = 0; i < way.n.length - 1; i++) {
        const a = way.n[i];
        const b = way.n[i + 1];
        const [la, lo] = data.nodes[a];
        const [lb, lob] = data.nodes[b];
        const e: Edge = { key: `${way.id}:${i}`, a, b, way, length: haversine(la, lo, lb, lob) };
        const idx = this.edges.push(e) - 1;
        this.edgeByKey.set(e.key, idx);
        this.adjacency[a].push({ edge: idx, to: b });
        this.adjacency[b].push({ edge: idx, to: a });
        for (const k of this.cellsAlong(la, lo, lb, lob)) {
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(idx);
        }
      }
    }
  }

  private cellKey(lat: number, lon: number) {
    return `${Math.floor(lat / this.cell)}:${Math.floor(lon / this.cell)}`;
  }

  private cellsAlong(la: number, lo: number, lb: number, lob: number): Set<string> {
    const keys = new Set<string>();
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lb - la), Math.abs(lob - lo)) / (this.cell / 2)));
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      keys.add(this.cellKey(la + (lb - la) * u, lo + (lob - lo) * u));
    }
    return keys;
  }

  /** Nearest edge to a point, with the distance in metres, or null if nothing within maxDist. */
  nearestEdge(lat: number, lon: number, maxDist = 15, accept?: (e: Edge) => boolean): { edge: number; dist: number } | null {
    const ci = Math.floor(lat / this.cell);
    const cj = Math.floor(lon / this.cell);
    let best: { edge: number; dist: number } | null = null;
    const seen = new Set<number>();
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const idx of this.grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const e = this.edges[idx];
          if (accept && !accept(e)) continue;
          const d = this.pointSegmentDistance(lat, lon, e);
          if (d <= maxDist && (!best || d < best.dist)) best = { edge: idx, dist: d };
        }
      }
    }
    return best;
  }

  nearestNode(lat: number, lon: number, accept?: (e: Edge) => boolean): number | null {
    for (const radius of [25, 60, 150]) {
      const hit = this.nearestEdge(lat, lon, radius, accept);
      if (hit) {
        const e = this.edges[hit.edge];
        const [la, lo] = this.data.nodes[e.a];
        const [lb, lob] = this.data.nodes[e.b];
        return haversine(lat, lon, la, lo) <= haversine(lat, lon, lb, lob) ? e.a : e.b;
      }
    }
    return null;
  }

  pointSegmentDistance(lat: number, lon: number, e: Edge): number {
    // Equirectangular projection is plenty accurate at street scale.
    const k = Math.cos((lat * Math.PI) / 180);
    const [la, lo] = this.data.nodes[e.a];
    const [lb, lob] = this.data.nodes[e.b];
    const ax = (lo - lon) * k, ay = la - lat;
    const bx = (lob - lon) * k, by = lb - lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + dx * t, py = ay + dy * t;
    return Math.hypot(px, py) * 111320;
  }

  /** Project a noisy GPS point onto the nearest street, for drawing clean trails. */
  snap(lat: number, lon: number, maxDist = 20): [number, number] {
    const hit = this.nearestEdge(lat, lon, maxDist);
    if (!hit) return [lat, lon];
    const e = this.edges[hit.edge];
    const [la, lo] = this.data.nodes[e.a];
    const [lb, lob] = this.data.nodes[e.b];
    const k = Math.cos((lat * Math.PI) / 180);
    const dx = (lob - lo) * k;
    const dy = lb - la;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (((lon - lo) * k) * dx + (lat - la) * dy) / len2)) : 0;
    return [la + dy * t, lo + (lob - lo) * t];
  }

  edgeCoords(idx: number): [number, number][] {
    const e = this.edges[idx];
    return [this.data.nodes[e.a], this.data.nodes[e.b]];
  }
}
