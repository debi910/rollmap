// Ground truth for the simulated demo: which surface each street "really" has.
// Only used to generate clearly-labelled demo rides; the app never reads it when scoring.

import type { StreetWay } from '../geo/osm';
import type { Surface } from '../core/synth';

function hash01(n: number, salt: number): number {
  let x = (n ^ (salt * 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// Monaco-Ville, the old town on the Rock, is paved with setts and stone.
const OLD_TOWN = { s: 43.7295, n: 43.7325, w: 7.4185, e: 7.4245 };

export function trueSurface(way: StreetWay, midLat: number, midLon: number): Surface {
  switch (way.s) {
    case 'asphalt':
    case 'concrete':
      return 'smooth';
    case 'paving_stones':
    case 'sett':
    case 'cobblestone':
      return 'pavers';
    case 'gravel':
    case 'fine_gravel':
    case 'dirt':
    case 'grass':
      return 'gravel';
  }
  const inOldTown = midLat > OLD_TOWN.s && midLat < OLD_TOWN.n && midLon > OLD_TOWN.w && midLon < OLD_TOWN.e;
  if (inOldTown && ['pedestrian', 'footway', 'living_street', 'residential'].includes(way.h)) return 'pavers';
  const r = hash01(way.id, 7);
  if (way.h === 'path' || way.h === 'track') return r < 0.5 ? 'gravel' : 'rough';
  if (way.h === 'pedestrian') return r < 0.6 ? 'pavers' : 'smooth';
  if (way.h === 'footway') return r < 0.62 ? 'smooth' : r < 0.85 ? 'rough' : 'pavers';
  if (way.h === 'service') return r < 0.6 ? 'smooth' : r < 0.9 ? 'rough' : 'gravel';
  return r < 0.75 ? 'smooth' : r < 0.95 ? 'rough' : 'pavers';
}

/** Crossings without a dropped curb give a jolt as the wheels go over the edge. */
export function crossingHasCurb(way: StreetWay): boolean {
  return way.fw === 'crossing' && hash01(way.id, 13) < 0.5;
}

/** Some streets have a broken slab or pothole somewhere along them. */
export function potholeAt(way: StreetWay): number | null {
  const r = hash01(way.id, 29);
  return r < 0.12 ? hash01(way.id, 31) : null; // fraction along the way
}
