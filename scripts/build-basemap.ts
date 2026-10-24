// Builds RollMap's own basemap (sea, land, parks, buildings, place labels) from the OSM extract,
// so the map renders the same everywhere: on phones, offline, and in the demo recording.
//
//   npx tsx scripts/build-basemap.ts data/monaco.osm.gz public/data/monaco-basemap.json

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseOsmXml, type OsmData, type OsmWay } from '../src/geo/osm';

type Ring = [number, number][];

const [input, output] = process.argv.slice(2);
const raw = readFileSync(input);
const data = parseOsmXml((input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const ring = (w: OsmWay, d: OsmData): Ring | null => {
  const pts = w.nodes.map((id) => d.nodes.get(id)).filter((n) => !!n);
  if (pts.length < 3) return null;
  return pts.map((n) => [r5(n!.lat), r5(n!.lon)]);
};
const closed = (w: OsmWay) => w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];

// Coastline: OSM draws it with land on the left, so chaining the open pieces gives the shore
// with the sea on the right. We close that chain around the seaward side to get a sea polygon.
function coastline(d: OsmData): { sea: Ring | null; islands: Ring[] } {
  const pieces = d.ways.filter((w) => w.tags.natural === 'coastline');
  const islands = pieces.filter(closed).map((w) => ring(w, d)).filter((r): r is Ring => !!r);
  const open = pieces.filter((w) => !closed(w));
  const byStart = new Map(open.map((w) => [w.nodes[0], w]));
  const ends = new Set(open.map((w) => w.nodes[w.nodes.length - 1]));
  const head = open.find((w) => !ends.has(w.nodes[0]));
  if (!head) return { sea: null, islands };
  const chain: number[] = [];
  for (let w: OsmWay | undefined = head; w; w = byStart.get(w.nodes[w.nodes.length - 1])) {
    chain.push(...(chain.length ? w.nodes.slice(1) : w.nodes));
    if (chain.length > 100000) break;
  }
  const shore = chain.map((id) => d.nodes.get(id)).filter((n) => !!n).map((n) => [r5(n!.lat), r5(n!.lon)] as [number, number]);
  const first = shore[0];
  const last = shore[shore.length - 1];
  // Monaco faces south-east onto the Mediterranean: close the polygon far out to sea.
  const sea: Ring = [...shore, [last[0], last[1] + 0.05], [first[0] - 0.08, last[1] + 0.05], [first[0] - 0.08, first[1] - 0.05], [first[0], first[1] - 0.05]];
  return { sea, islands };
}

const polys = (pred: (w: OsmWay) => boolean) =>
  data.ways.filter((w) => closed(w) && pred(w)).map((w) => ring(w, data)).filter((r): r is Ring => !!r);

const { sea, islands } = coastline(data);
const green = polys(
  (w) =>
    ['park', 'garden', 'pitch', 'playground'].includes(w.tags.leisure ?? '') ||
    ['grass', 'cemetery', 'recreation_ground', 'forest', 'meadow'].includes(w.tags.landuse ?? '') ||
    ['wood', 'scrub', 'grassland'].includes(w.tags.natural ?? ''),
);
const water = polys((w) => w.tags.natural === 'water' || w.tags.leisure === 'swimming_pool');
const buildings = polys((w) => !!w.tags.building);
const labels = [...data.nodes.values()]
  .filter((n) => ['suburb', 'quarter', 'neighbourhood'].includes(n.tags.place ?? '') && n.tags.name)
  .map((n) => ({ name: n.tags.name, lat: r5(n.lat), lon: r5(n.lon) }));

// Things a wheelchair rider plans around: public lifts and toilets.
const centroid = (w: OsmWay) => {
  const pts = w.nodes.map((id) => data.nodes.get(id)).filter((n) => !!n);
  return pts.length ? { lat: pts.reduce((a, n) => a + n!.lat, 0) / pts.length, lon: pts.reduce((a, n) => a + n!.lon, 0) / pts.length } : null;
};
const pois: { kind: 'lift' | 'toilet'; lat: number; lon: number; name?: string; wheelchair?: string }[] = [];
const poiKind = (t: Record<string, string>) => (t.highway === 'elevator' ? 'lift' : t.amenity === 'toilets' ? 'toilet' : null);
for (const n of data.nodes.values()) {
  const kind = poiKind(n.tags);
  if (kind) pois.push({ kind, lat: r5(n.lat), lon: r5(n.lon), name: n.tags.name, wheelchair: n.tags.wheelchair });
}
for (const w of data.ways) {
  const kind = poiKind(w.tags);
  const c = kind && centroid(w);
  if (kind && c) pois.push({ kind, lat: r5(c.lat), lon: r5(c.lon), name: w.tags.name, wheelchair: w.tags.wheelchair });
}

writeFileSync(output, JSON.stringify({ sea, islands, green, water, buildings, labels, pois }));
console.log(`${pois.length} pois`);
console.log(`sea ${sea?.length ?? 0} pts, ${islands.length} islands, ${green.length} green, ${water.length} water, ${buildings.length} buildings, ${labels.length} labels`);
