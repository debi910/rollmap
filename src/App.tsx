import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import modelJson from './ml/model.json';
import type { MlpModel } from './ml/mlp';
import { MapView, type Focus } from './components/MapView';
import { Legend } from './components/Widgets';
import { RidePanel } from './components/RidePanel';
import { RoutePanel } from './components/RoutePanel';
import { ReportsPanel } from './components/ReportsPanel';
import { AboutPanel } from './components/AboutPanel';
import { RoutableGraph } from './geo/graph';
import type { StreetGraph } from './geo/osm';
import { findRoute, PROFILES, type ProfileId, type RouteResult } from './geo/router';
import { addRide, deserializeSegments, mergeSegments, serializeSegments, type SegmentMap, type SegmentStats } from './geo/segments';
import { RideSession, type LiveState } from './ride/session';
import { simulateRide } from './sim/rideSim';
import { loadMySegments, loadRides, loadTraining, saveMySegments, saveRides, saveTraining, type RideRecord } from './store';
import type { WindowResult } from './core/analyzer';

const model = modelJson as MlpModel;
export type Tab = 'ride' | 'route' | 'reports' | 'about';

// A route through Monaco where the shortest path uses steps and rough paving.
const DEMO_FROM: [number, number] = [43.73405, 7.42161];
const DEMO_TO: [number, number] = [43.73845, 7.41924];

export default function App() {
  const [graph, setGraph] = useState<RoutableGraph | null>(null);
  const [seed, setSeed] = useState<SegmentMap>(new Map());
  const [seedRides, setSeedRides] = useState(0);
  const [mine, setMine] = useState<SegmentMap>(() => deserializeSegments(loadMySegments()));
  const [rides, setRides] = useState<RideRecord[]>(() => loadRides());
  const [tab, setTab] = useState<Tab>('route');
  const [showSegments, setShowSegments] = useState(true);

  const [from, setFrom] = useState<[number, number] | null>(DEMO_FROM);
  const [to, setTo] = useState<[number, number] | null>(DEMO_TO);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [profile, setProfile] = useState<ProfileId>('manual');

  const [session, setSession] = useState<RideSession | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [lastRide, setLastRide] = useState<RideRecord | null>(null);
  const [label, setLabel] = useState<string>('');
  const [focus, setFocus] = useState<Focus | null>({ bounds: [DEMO_FROM, DEMO_TO], nonce: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    Promise.all([fetch(`${base}data/monaco.json`).then((r) => r.json()), fetch(`${base}data/monaco-seed.json`).then((r) => r.json())])
      .then(([g, s]: [StreetGraph, { rides: number; segments: SegmentStats[] }]) => {
        setGraph(new RoutableGraph(g));
        setSeed(deserializeSegments(s.segments));
        setSeedRides(s.rides);
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const segments = useMemo(() => mergeSegments(seed, mine), [seed, mine]);

  const routes = useMemo(() => {
    if (!graph || !from || !to) return { smooth: null as RouteResult | null, short: null as RouteResult | null, error: null as string | null };
    const prof = PROFILES[profile];
    const accept = (e: { way: { h: string } }) => e.way.h !== 'steps';
    const a = graph.nearestNode(from[0], from[1], accept);
    const b = graph.nearestNode(to[0], to[1], accept);
    if (a == null || b == null) return { smooth: null, short: null, error: 'Pick points closer to a street.' };
    const smooth = findRoute(graph, segments, a, b, prof);
    const short = findRoute(graph, segments, a, b, PROFILES.walking);
    return { smooth, short, error: smooth ? null : 'No step-free route found between these points.' };
  }, [graph, from, to, profile, segments]);

  // Frame both routes whenever a new A→B pair is chosen (and on first load).
  const [fitRoutes, setFitRoutes] = useState(1);
  useEffect(() => {
    if (!fitRoutes || !routes.smooth) return;
    setFocus({ bounds: [...routes.smooth.coords, ...(routes.short?.coords ?? [])], nonce: Date.now() });
    setFitRoutes(0);
  }, [fitRoutes, routes]);

  const streetAt = useCallback(
    (lat: number, lon: number) => {
      if (!graph) return undefined;
      const hit = graph.nearestEdge(lat, lon, 30, (e) => !!e.way.name);
      return hit ? graph.edges[hit.edge].way.name : undefined;
    },
    [graph],
  );

  const onMapClick = useCallback(
    (lat: number, lon: number) => {
      if (picking === 'from') {
        setFrom([lat, lon]);
        setPicking('to');
      } else if (picking === 'to') {
        setTo([lat, lon]);
        setPicking(null);
        setFitRoutes(Date.now());
      }
    },
    [picking],
  );

  const lastPos = useRef(0);
  const startSession = useCallback(
    async (simulate: false | { speedup: number }) => {
      if (session || !graph) return;
      const s = new RideSession(model, !!simulate);
      s.label = label || undefined;
      setLastRide(null);
      setPosition(null);
      s.subscribe(setLive);
      setSession(s);
      setTab('ride');
      if (simulate) {
        const route = routes.smooth;
        if (!route) return;
        const sim = simulateRide(graph, route.nodes, route.edges, Date.now() % 100000, Date.now());
        s.startSimulation(sim, simulate.speedup, (lat, lon) => {
          const now = performance.now();
          if (now - lastPos.current > 80) {
            lastPos.current = now;
            setPosition([lat, lon]);
          }
        });
      } else {
        await s.startSensors();
      }
    },
    [session, graph, routes.smooth, label],
  );

  const stopSession = useCallback(() => {
    if (!session || !graph) return;
    const record = session.stop(streetAt);
    const windows = session.state.windows;
    const nextMine = new Map(mine);
    addRide(nextMine, graph, record.id, windows);
    setMine(nextMine);
    saveMySegments(serializeSegments(nextMine));
    const nextRides = [...rides, record];
    setRides(nextRides);
    saveRides(nextRides);
    const labelled = windows.filter((w): w is WindowResult & { label: string } => !!w.label);
    if (labelled.length) saveTraining([...loadTraining(), ...labelled.map((w) => ({ label: w.label, features: w.features, t: w.t }))]);
    setLastRide(record);
    setSession(null);
    setPosition(null);
    const pts = record.windows.filter((w) => w.lat != null).map((w) => [w.lat!, w.lon!] as [number, number]);
    if (pts.length) setFocus({ bounds: pts, nonce: Date.now() });
  }, [session, graph, mine, rides, streetAt]);

  // A simulated ride ends by itself when the stream runs out.
  useEffect(() => {
    if (session && session.simulated && live && !live.running && live.windows.length) stopSession();
  }, [session, live, stopSession]);

  useEffect(() => {
    if (session) session.label = label || undefined;
  }, [label, session]);

  const issues = useMemo(() => rides.flatMap((r) => r.issues), [rides]);
  const riding = !!session;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◐
          </span>
          <span>RollMap</span>
        </div>
        <div className="tagline">Sidewalks scored by how they feel on wheels</div>
      </header>

      <main className="layout">
        <section className="map-wrap">
          <MapView
            graph={graph}
            segments={segments}
            showSegments={showSegments}
            smoothRoute={tab === 'route' || riding ? routes.smooth : null}
            routeMuted={riding}
            shortRoute={tab === 'route' && !riding ? routes.short : null}
            from={tab === 'route' ? from : null}
            to={tab === 'route' ? to : null}
            trail={live?.windows ?? lastRide?.windows.map((w) => w as WindowResult) ?? []}
            position={position}
            issues={tab === 'reports' || lastRide ? issues : []}
            onMapClick={onMapClick}
            focus={focus}
          />
          <div className="map-overlay">
            <Legend />
            <label className="toggle">
              <input type="checkbox" checked={showSegments} onChange={(e) => setShowSegments(e.target.checked)} />
              Community layer
            </label>
          </div>
          {picking && <div className="pick-hint">Tap the map to set {picking === 'from' ? 'start (A)' : 'destination (B)'}</div>}
          {!graph && !loadError && <div className="pick-hint">Loading map…</div>}
          {loadError && <div className="pick-hint error">Could not load map data: {loadError}</div>}
        </section>

        <section className="panel">
          <nav className="tabs" role="tablist">
            {(
              [
                ['route', 'Route'],
                ['ride', 'Ride'],
                ['reports', `Reports${issues.length ? ` (${issues.length})` : ''}`],
                ['about', 'How it works'],
              ] as [Tab, string][]
            ).map(([id, name]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                {name}
              </button>
            ))}
          </nav>
          <div className="panel-body">
            {tab === 'route' && (
              <RoutePanel
                profile={profile}
                setProfile={setProfile}
                smooth={routes.smooth}
                short={routes.short}
                error={routes.error}
                picking={picking}
                setPicking={setPicking}
                onDemo={() => {
                  setFrom(DEMO_FROM);
                  setTo(DEMO_TO);
                  setFitRoutes(Date.now());
                }}
                onSimulate={(speedup) => startSession({ speedup })}
                seedRides={seedRides}
                mySegments={mine.size}
                riding={riding}
              />
            )}
            {tab === 'ride' && (
              <RidePanel
                live={live}
                riding={riding}
                lastRide={lastRide}
                label={label}
                setLabel={setLabel}
                onStart={() => startSession(false)}
                onSimulate={(speedup) => startSession({ speedup })}
                onStop={stopSession}
                onReports={() => setTab('reports')}
                canSimulate={!!routes.smooth}
              />
            )}
            {tab === 'reports' && (
              <ReportsPanel
                issues={issues}
                rides={rides}
                mySegments={mine}
                onFocus={(lat, lon) => setFocus({ lat, lon, zoom: 19, nonce: Date.now() })}
                onCleared={() => {
                  setRides([]);
                  setMine(new Map());
                  setLastRide(null);
                }}
              />
            )}
            {tab === 'about' && <AboutPanel model={model} seedRides={seedRides} />}
          </div>
        </section>
      </main>
    </div>
  );
}
