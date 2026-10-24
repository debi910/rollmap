import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { scoreColor } from '../core/comfort';
import type { RoutableGraph } from '../geo/graph';
import type { RouteResult } from '../geo/router';
import { segmentScore, type SegmentMap } from '../geo/segments';
import type { Issue } from '../store';
import type { WindowResult } from '../core/analyzer';
import { issueSeverity, issueTitle } from '../core/issues';

export type Focus = { lat: number; lon: number; zoom?: number; nonce: number } | { bounds: [number, number][]; nonce: number };

type Ring = [number, number][];
export interface Basemap {
  sea: Ring | null;
  islands: Ring[];
  green: Ring[];
  water: Ring[];
  buildings: Ring[];
  labels: { name: string; lat: number; lon: number }[];
  pois?: Poi[];
}
export interface Poi {
  kind: 'lift' | 'toilet';
  lat: number;
  lon: number;
  name?: string;
  wheelchair?: string;
}

interface Props {
  graph: RoutableGraph | null;
  basemap: Basemap | null;
  segments: SegmentMap;
  showSegments: boolean;
  smoothRoute: RouteResult | null;
  routeMuted?: boolean;
  shortRoute: RouteResult | null;
  from: [number, number] | null;
  to: [number, number] | null;
  trail: WindowResult[];
  position: [number, number] | null;
  issues: Issue[];
  selected?: [number, number][] | null;
  onMapClick?: (lat: number, lon: number) => void;
  focus?: Focus | null;
  padding?: { topLeft: [number, number]; bottomRight: [number, number] };
}

const MAJOR = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
const MINOR = new Set(['residential', 'unclassified', 'service', 'living_street']);

// Canvas can't read CSS variables, so pull the palette from :root and redraw on theme change.
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    land: v('--map-land'),
    sea: v('--map-sea'),
    green: v('--map-green'),
    building: v('--map-building'),
    buildingEdge: v('--map-building-edge'),
    road: v('--map-road'),
    roadCasing: v('--map-road-casing'),
    path: v('--map-path'),
    steps: v('--map-steps'),
  };
}

// Line widths follow zoom so streets read as streets when zoomed in and stay tidy zoomed out.
const zoomScale = (z: number) => Math.max(0.35, Math.min(1.8, Math.pow(1.45, z - 17)));

export function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<Record<string, L.LayerGroup>>({});
  const renderers = useRef<Record<string, L.Canvas>>({});
  const clickRef = useRef(p.onMapClick);
  clickRef.current = p.onMapClick;
  const [zoom, setZoom] = useState(16);
  const [theme, setTheme] = useState(0);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.25, minZoom: 13, maxZoom: 19 });
    m.attributionControl.setPrefix(false).addAttribution('© OpenStreetMap contributors');
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.setView([43.7384, 7.4246], 16);
    const panes: [string, number][] = [
      ['base', 200],
      ['streets', 300],
      ['segments', 350],
      ['selected', 380],
      ['routes', 400],
      ['trail', 450],
      ['pois', 600],
      ['issues', 620],
      ['labels', 640],
      ['pins', 660],
    ];
    for (const [name, z] of panes) {
      const pane = m.createPane(name);
      pane.style.zIndex = String(z);
      if (name === 'labels') pane.style.pointerEvents = 'none';
      renderers.current[name] = L.canvas({ pane: name, padding: 0.5 });
      layers.current[name] = L.layerGroup([], { pane: name }).addTo(m);
    }
    m.on('click', (e: L.LeafletMouseEvent) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
    m.on('zoomend', () => setZoom(m.getZoom()));
    map.current = m;
    // Lets the demo recorder find streets on screen; dev builds only.
    if (import.meta.env.DEV) (window as unknown as { __rollmapMap: L.Map }).__rollmapMap = m;
    setZoom(m.getZoom());

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => setTheme((t) => t + 1);
    mq.addEventListener('change', onTheme);
    return () => {
      mq.removeEventListener('change', onTheme);
      m.remove();
      map.current = null;
    };
  }, []);

  // Land, sea, parks and buildings: drawn once per theme.
  useEffect(() => {
    const b = p.basemap;
    const layer = layers.current.base;
    if (!b || !layer) return;
    layer.clearLayers();
    const c = palette();
    const r = renderers.current.base;
    if (b.sea) L.polygon(b.sea, { renderer: r, stroke: false, fillColor: c.sea, fillOpacity: 1, interactive: false }).addTo(layer);
    for (const i of b.islands) L.polygon(i, { renderer: r, stroke: false, fillColor: c.land, fillOpacity: 1, interactive: false }).addTo(layer);
    for (const g of b.green) L.polygon(g, { renderer: r, stroke: false, fillColor: c.green, fillOpacity: 1, interactive: false }).addTo(layer);
    for (const w of b.water) L.polygon(w, { renderer: r, stroke: false, fillColor: c.sea, fillOpacity: 1, interactive: false }).addTo(layer);
    for (const bl of b.buildings) {
      L.polygon(bl, { renderer: r, color: c.buildingEdge, weight: 0.6, fillColor: c.building, fillOpacity: 1, interactive: false }).addTo(layer);
    }
    const labels = layers.current.labels;
    labels.clearLayers();
    for (const l of b.labels) {
      L.marker([l.lat, l.lon], {
        pane: 'labels',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'map-label', html: `<span>${l.name}</span>`, iconSize: [0, 0] }),
      }).addTo(labels);
    }
  }, [p.basemap, theme]);

  // Street network with casing, sized to the zoom level.
  useEffect(() => {
    const g = p.graph;
    const layer = layers.current.streets;
    if (!g || !layer) return;
    layer.clearLayers();
    const c = palette();
    const s = zoomScale(zoom);
    const r = renderers.current.streets;
    const draw = (pass: 'casing' | 'fill') => {
      for (const w of g.data.ways) {
        const coords = w.n.map((i) => g.data.nodes[i]);
        if (w.h === 'steps') {
          if (pass === 'fill') L.polyline(coords, { renderer: r, color: c.steps, weight: 3 * s + 1, dashArray: '1 5', lineCap: 'round', interactive: false }).addTo(layer);
          continue;
        }
        const major = MAJOR.has(w.h);
        const minor = MINOR.has(w.h);
        const width = (major ? 9 : minor ? 6.5 : 2.6) * s;
        if (pass === 'casing' && (major || minor)) {
          L.polyline(coords, { renderer: r, color: c.roadCasing, weight: width + 2, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
        }
        if (pass === 'fill') {
          L.polyline(coords, { renderer: r, color: major || minor ? c.road : c.path, weight: width, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
        }
      }
    };
    draw('casing');
    draw('fill');
  }, [p.graph, zoom, theme]);

  useEffect(() => {
    const g = p.graph;
    const layer = layers.current.segments;
    if (!g || !layer) return;
    layer.clearLayers();
    if (!p.showSegments) return;
    const s = zoomScale(zoom);
    const r = renderers.current.segments;
    for (const seg of p.segments.values()) {
      if (seg.n < 2) continue;
      const idx = g.edgeByKey.get(seg.key);
      if (idx == null) continue;
      L.polyline(g.edgeCoords(idx), { renderer: r, color: scoreColor(segmentScore(seg)), weight: Math.max(2, 4 * s), opacity: 0.95, lineCap: 'round', interactive: false }).addTo(layer);
    }
  }, [p.graph, p.segments, p.showSegments, zoom]);

  useEffect(() => {
    const layer = layers.current.routes;
    if (!layer) return;
    layer.clearLayers();
    const s = zoomScale(zoom);
    const opts = { pane: 'routes', lineCap: 'round' as const, lineJoin: 'round' as const, interactive: false };
    if (p.shortRoute) {
      L.polyline(p.shortRoute.coords, { ...opts, color: '#ffffff', weight: 7 * s + 2, opacity: 0.9 }).addTo(layer);
      L.polyline(p.shortRoute.coords, { ...opts, color: '#64748b', weight: 4 * s + 1, dashArray: '2 10' }).addTo(layer);
    }
    if (p.smoothRoute && p.routeMuted) {
      L.polyline(p.smoothRoute.coords, { ...opts, color: '#2563eb', weight: 3, dashArray: '2 8', opacity: 0.8 }).addTo(layer);
    } else if (p.smoothRoute) {
      L.polyline(p.smoothRoute.coords, { ...opts, color: '#ffffff', weight: 10 * s + 4, opacity: 1 }).addTo(layer);
      L.polyline(p.smoothRoute.coords, { ...opts, color: '#2563eb', weight: 6 * s + 2, opacity: 1 }).addTo(layer);
    }
  }, [p.smoothRoute, p.shortRoute, p.routeMuted, zoom]);

  // Lifts and toilets: what a rider plans a trip around.
  useEffect(() => {
    const layer = layers.current.pois;
    if (!layer || !p.basemap?.pois) return;
    layer.clearLayers();
    if (zoom < 15) return;
    for (const poi of p.basemap.pois) {
      const lift = poi.kind === 'lift';
      const title = lift ? `Public lift${poi.name ? `: ${poi.name}` : ''}` : `Toilet${poi.wheelchair === 'yes' ? ' (wheelchair accessible)' : ''}${poi.name ? `: ${poi.name}` : ''}`;
      L.marker([poi.lat, poi.lon], {
        pane: 'pois',
        title,
        keyboard: false,
        icon: L.divIcon({
          className: `poi ${lift ? 'poi-lift' : 'poi-wc'}`,
          html: lift
            ? '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 2 2 6h6L5 2Zm6 12 3-4H8l3 4Z" fill="currentColor"/></svg>'
            : '<span>WC</span>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(layer);
    }
  }, [p.basemap, zoom]);

  // The street the rider tapped on, outlined so the info card clearly refers to it.
  useEffect(() => {
    const layer = layers.current.selected;
    if (!layer) return;
    layer.clearLayers();
    if (!p.selected?.length) return;
    L.polyline(p.selected, { pane: 'selected', color: '#0f172a', weight: 12, opacity: 0.28, lineCap: 'round', interactive: false }).addTo(layer);
  }, [p.selected]);

  useEffect(() => {
    const layer = layers.current.pins;
    if (!layer) return;
    layer.clearLayers();
    const pin = (ll: [number, number], label: string, cls: string) =>
      L.marker(ll, {
        pane: 'pins',
        icon: L.divIcon({ className: `pin ${cls}`, html: `<span>${label}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        keyboard: false,
      }).addTo(layer);
    if (p.from) pin(p.from, 'A', 'pin-from');
    if (p.to) pin(p.to, 'B', 'pin-to');
  }, [p.from, p.to]);

  // The rider marker moves every frame during a simulation, so update it in place.
  const rider = useRef<L.Marker | null>(null);
  useEffect(() => {
    const layer = layers.current.pins;
    if (!layer) return;
    if (!p.position) {
      if (rider.current) layer.removeLayer(rider.current);
      rider.current = null;
      return;
    }
    if (!rider.current) {
      rider.current = L.marker(p.position, {
        pane: 'pins',
        icon: L.divIcon({ className: 'rider', html: '<span class="rider-pulse"></span><span class="rider-dot"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        keyboard: false,
        interactive: false,
      }).addTo(layer);
    } else {
      rider.current.setLatLng(p.position);
    }
  }, [p.position]);

  // The trail grows window by window during a ride, so draw only what's new.
  const drawn = useRef(0);
  useEffect(() => {
    const layer = layers.current.trail;
    if (!layer) return;
    const pts = p.trail.filter((w) => w.lat != null && w.lon != null);
    if (pts.length < drawn.current) {
      layer.clearLayers();
      drawn.current = 0;
    }
    const r = renderers.current.trail;
    for (let i = Math.max(1, drawn.current); i < pts.length; i++) {
      L.polyline(
        [
          [pts[i - 1].lat!, pts[i - 1].lon!],
          [pts[i].lat!, pts[i].lon!],
        ],
        { renderer: r, color: scoreColor(pts[i].score), weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false },
      ).addTo(layer);
    }
    drawn.current = pts.length;
  }, [p.trail]);

  useEffect(() => {
    const layer = layers.current.issues;
    if (!layer) return;
    layer.clearLayers();
    for (const i of p.issues) {
      const sev = issueSeverity(i);
      L.marker([i.lat, i.lon], {
        pane: 'issues',
        icon: L.divIcon({
          className: `issue-pin ${i.kind === 'barrier' ? 'is-barrier' : i.kind === 'steep' ? 'is-steep' : `is-${sev}`}`,
          html: i.kind === 'barrier' ? '<span>✕</span>' : '<span>!</span>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        title: issueTitle(i),
      }).addTo(layer);
    }
  }, [p.issues]);

  useEffect(() => {
    const f = p.focus;
    if (!f || !map.current) return;
    if ('bounds' in f) {
      if (f.bounds.length)
        map.current.flyToBounds(L.latLngBounds(f.bounds), {
          paddingTopLeft: p.padding?.topLeft ?? [40, 40],
          paddingBottomRight: p.padding?.bottomRight ?? [40, 40],
          maxZoom: 18,
          duration: 0.6,
        });
    } else {
      map.current.flyTo([f.lat, f.lon], f.zoom ?? map.current.getZoom(), { duration: 0.6 });
    }
    // Padding is read at focus time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus]);

  return <div ref={el} className="map" role="application" aria-label="Sidewalk comfort map" />;
}
