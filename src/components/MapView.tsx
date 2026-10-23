import { useEffect, useRef } from 'react';
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

interface Props {
  graph: RoutableGraph | null;
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
  onMapClick?: (lat: number, lon: number) => void;
  focus?: Focus | null;
}

export function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<Record<string, L.LayerGroup>>({});
  const renderer = useRef(L.canvas({ padding: 0.5 }));
  const clickRef = useRef(p.onMapClick);
  clickRef.current = p.onMapClick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: true });
    m.setView([43.7384, 7.4246], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    for (const name of ['streets', 'segments', 'routes', 'trail', 'issues', 'markers']) {
      layers.current[name] = L.layerGroup().addTo(m);
    }
    m.on('click', (e: L.LeafletMouseEvent) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Base street network, drawn from our own graph so the map stays readable even offline.
  useEffect(() => {
    const g = p.graph;
    const layer = layers.current.streets;
    if (!g || !layer) return;
    layer.clearLayers();
    for (const w of g.data.ways) {
      const coords = w.n.map((i) => g.data.nodes[i]);
      const steps = w.h === 'steps';
      L.polyline(coords, {
        renderer: renderer.current,
        color: steps ? '#7c3aed' : '#8b97a8',
        weight: steps ? 3 : w.h === 'footway' || w.h === 'pedestrian' ? 2 : 3,
        dashArray: steps ? '2 4' : undefined,
        opacity: 0.9,
        interactive: false,
      }).addTo(layer);
    }
    if (!p.focus) {
      const [s, w, n, e] = g.data.bbox;
      map.current?.fitBounds([[s, w], [n, e]], { padding: [10, 10] });
    }
  }, [p.graph]);

  useEffect(() => {
    const g = p.graph;
    const layer = layers.current.segments;
    if (!g || !layer) return;
    layer.clearLayers();
    if (!p.showSegments) return;
    for (const s of p.segments.values()) {
      if (s.n < 2) continue;
      const idx = g.edgeByKey.get(s.key);
      if (idx == null) continue;
      L.polyline(g.edgeCoords(idx), {
        renderer: renderer.current,
        color: scoreColor(segmentScore(s)),
        weight: 5,
        opacity: 0.9,
        interactive: false,
      }).addTo(layer);
    }
  }, [p.graph, p.segments, p.showSegments]);

  useEffect(() => {
    const layer = layers.current.routes;
    if (!layer) return;
    layer.clearLayers();
    if (p.shortRoute) {
      L.polyline(p.shortRoute.coords, { color: '#475569', weight: 5, dashArray: '8 8', opacity: 0.85 }).addTo(layer);
    }
    if (p.smoothRoute && p.routeMuted) {
      L.polyline(p.smoothRoute.coords, { color: '#0f766e', weight: 3, dashArray: '4 6', opacity: 0.8 }).addTo(layer);
    } else if (p.smoothRoute) {
      L.polyline(p.smoothRoute.coords, { color: '#ffffff', weight: 10, opacity: 0.9 }).addTo(layer);
      L.polyline(p.smoothRoute.coords, { color: '#0f766e', weight: 6, opacity: 1 }).addTo(layer);
    }
  }, [p.smoothRoute, p.shortRoute, p.routeMuted]);

  useEffect(() => {
    const layer = layers.current.markers;
    if (!layer) return;
    layer.clearLayers();
    const pin = (ll: [number, number], label: string, cls: string) =>
      L.marker(ll, {
        icon: L.divIcon({ className: `pin ${cls}`, html: `<span>${label}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        keyboard: false,
      }).addTo(layer);
    if (p.from) pin(p.from, 'A', 'pin-from');
    if (p.to) pin(p.to, 'B', 'pin-to');
    if (p.position) {
      L.marker(p.position, {
        icon: L.divIcon({ className: 'pin pin-rider', html: '<span aria-label="rider">♿</span>', iconSize: [34, 34], iconAnchor: [17, 17] }),
      }).addTo(layer);
    }
  }, [p.from, p.to, p.position]);

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
    for (let i = Math.max(1, drawn.current); i < pts.length; i++) {
      L.polyline(
        [
          [pts[i - 1].lat!, pts[i - 1].lon!],
          [pts[i].lat!, pts[i].lon!],
        ],
        { renderer: renderer.current, color: scoreColor(pts[i].score), weight: 8, opacity: 1, interactive: false },
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
      L.circleMarker([i.lat, i.lon], {
        radius: sev === 'high' ? 9 : 7,
        color: '#fff',
        weight: 2,
        fillColor: i.kind === 'steep' ? '#2563eb' : sev === 'high' ? '#b30000' : '#f97316',
        fillOpacity: 1,
      })
        .bindTooltip(issueTitle(i))
        .addTo(layer);
    }
  }, [p.issues]);

  useEffect(() => {
    const f = p.focus;
    if (!f || !map.current) return;
    if ('bounds' in f) {
      if (f.bounds.length) map.current.fitBounds(L.latLngBounds(f.bounds), { paddingTopLeft: [60, 40], paddingBottomRight: [40, 120], maxZoom: 18 });
    } else {
      map.current.setView([f.lat, f.lon], f.zoom ?? map.current.getZoom(), { animate: true });
    }
  }, [p.focus]);

  return <div ref={el} className="map" role="application" aria-label="Sidewalk comfort map" />;
}
