// OpenStreetMap parsing shared by the build script (XML extract) and the app (Overpass JSON).

export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}
export interface OsmWay {
  id: number;
  nodes: number[];
  tags: Record<string, string>;
}
export interface OsmData {
  nodes: Map<number, OsmNode>;
  ways: OsmWay[];
}

/** Compact graph shipped to the browser. Node coordinates are rounded to ~1 m. */
export interface StreetGraph {
  bbox: [number, number, number, number]; // south, west, north, east
  nodes: [number, number][];
  elevators: number[]; // node indices tagged highway=elevator
  ways: StreetWay[];
}
export interface StreetWay {
  id: number;
  n: number[]; // node indices
  h: string; // highway=*
  s?: string; // surface=*
  sm?: string; // smoothness=*
  inc?: string; // incline=*
  wc?: string; // wheelchair=*
  fw?: string; // footway=* (sidewalk, crossing)
  name?: string;
}

export const WALKABLE = new Set([
  'footway',
  'pedestrian',
  'path',
  'steps',
  'living_street',
  'residential',
  'service',
  'unclassified',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
  'primary',
  'primary_link',
  'cycleway',
  'track',
  'corridor',
]);

const attr = (s: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(s);
  return m ? m[1] : undefined;
};

const unescape = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseOsmXml(xml: string): OsmData {
  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  const re = /<(node|way)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const [, kind, attrs, , body = ''] = m;
    const tags: Record<string, string> = {};
    for (const t of body.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"/g)) tags[unescape(t[1])] = unescape(t[2]);
    const id = Number(attr(attrs, 'id'));
    if (kind === 'node') {
      nodes.set(id, { id, lat: Number(attr(attrs, 'lat')), lon: Number(attr(attrs, 'lon')), tags });
    } else {
      const refs = [...body.matchAll(/<nd\s+ref="(\d+)"/g)].map((r) => Number(r[1]));
      ways.push({ id, nodes: refs, tags });
    }
  }
  return { nodes, ways };
}

interface OverpassElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export function parseOverpassJson(doc: { elements: OverpassElement[] }): OsmData {
  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  for (const e of doc.elements) {
    if (e.type === 'node' && e.lat != null && e.lon != null) {
      nodes.set(e.id, { id: e.id, lat: e.lat, lon: e.lon, tags: e.tags ?? {} });
    } else if (e.type === 'way' && e.nodes) {
      ways.push({ id: e.id, nodes: e.nodes, tags: e.tags ?? {} });
    }
  }
  return { nodes, ways };
}

export function overpassQuery(bbox: [number, number, number, number]): string {
  const b = bbox.join(',');
  return `[out:json][timeout:25];(way["highway"~"^(${[...WALKABLE].join('|')})$"](${b});node["highway"="elevator"](${b}););(._;>;);out body;`;
}

export function compactGraph(data: OsmData): StreetGraph {
  const index = new Map<number, number>();
  const nodes: [number, number][] = [];
  const idx = (id: number) => {
    let i = index.get(id);
    if (i == null) {
      const n = data.nodes.get(id);
      if (!n) return -1;
      i = nodes.length;
      index.set(id, i);
      nodes.push([Math.round(n.lat * 1e5) / 1e5, Math.round(n.lon * 1e5) / 1e5]);
    }
    return i;
  };

  const ways: StreetWay[] = [];
  for (const w of data.ways) {
    const h = w.tags.highway;
    if (!h || !WALKABLE.has(h)) continue;
    if (w.tags.access === 'private' || w.tags.foot === 'no') continue;
    const n = w.nodes.map(idx).filter((i) => i >= 0);
    if (n.length < 2) continue;
    const way: StreetWay = { id: w.id, n, h };
    if (w.tags.surface) way.s = w.tags.surface;
    if (w.tags.smoothness) way.sm = w.tags.smoothness;
    if (w.tags.incline) way.inc = w.tags.incline;
    if (w.tags.wheelchair) way.wc = w.tags.wheelchair;
    if (w.tags.footway) way.fw = w.tags.footway;
    if (w.tags.name) way.name = w.tags.name;
    ways.push(way);
  }

  const elevators: number[] = [];
  for (const n of data.nodes.values()) {
    if (n.tags.highway === 'elevator') {
      const i = index.get(n.id);
      if (i != null) elevators.push(i);
    }
  }

  let [s, w, nn, e] = [90, 180, -90, -180];
  for (const [lat, lon] of nodes) {
    s = Math.min(s, lat);
    nn = Math.max(nn, lat);
    w = Math.min(w, lon);
    e = Math.max(e, lon);
  }
  return { bbox: [s, w, nn, e], nodes, elevators, ways };
}
