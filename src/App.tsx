import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import clsx from 'clsx';
import './App.css';
import modelJson from './ml/model.json';
import type { MlpModel } from './ml/mlp';
import { MapView, type Basemap, type Focus } from './components/MapView';
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
export type Tab = 'route' | 'ride' | 'reports' | 'about';

// A route through Monaco where the shortest path uses steps and rough paving.
const DEMO_FROM: [number, number] = [43.73405, 7.42161];
const DEMO_TO: [number, number] = [43.73845, 7.41924];

const TABS: [Tab, string][] = [
  ['route', 'Route'],
  ['ride', 'Ride'],
  ['reports', 'Reports'],
  ['about', 'How it works'],
];

function mapPadding(): { topLeft: [number, number]; bottomRight: [number, number] } {
  // Keep fitted content clear of the floating sheet (left on desktop, bottom on phones).
  if (window.innerWidth > 860) return { topLeft: [440, 48], bottomRight: [64, 64] };
  return { topLeft: [24, 24], bottomRight: [24, Math.round(window.innerHeight * 0.55) + 24] };
}

export default function App() {
  const [graph, setGraph] = useState<RoutableGraph | null>(null);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
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
  const [focus, setFocus] = useState<Focus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const get = (f: string) => fetch(`${base}data/${f}`).then((r) => r.json());
    Promise.all([get('monaco.json'), get('monaco-seed.json'), get('monaco-basemap.json')])
      .then(([g, s, b]: [StreetGraph, { rides: number; segments: SegmentStats[] }, Basemap]) => {
        setGraph(new RoutableGraph(g));
        setSeed(deserializeSegments(s.segments));
        setSeedRides(s.rides);
        setBasemap(b);
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
    return { smooth, short, error: smooth ? null : 'No step-free route between these points.' };
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
      const hit = graph.nearestEdge(lat, lon, 40, (e) => !!e.way.name) ?? graph.nearestEdge(lat, lon, 150, (e) => !!e.way.name);
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
          if (now - lastPos.current > 50) {
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

  // Draw the ride on the street it happened on, not on raw GPS jitter.
  const rawTrail = live?.windows ?? lastRide?.windows ?? null;
  const trail = useMemo(() => {
    if (!rawTrail || !graph) return [];
    return rawTrail.map((w) => {
      if (w.lat == null || w.lon == null) return w as WindowResult;
      const [lat, lon] = graph.snap(w.lat, w.lon);
      return { ...w, lat, lon } as WindowResult;
    });
  }, [rawTrail, graph]);
  const riding = !!session;
  const tabIndex = TABS.findIndex(([id]) => id === tab);

  return (
    <div className="app">
      <MapView
        graph={graph}
        basemap={basemap}
        segments={segments}
        showSegments={showSegments}
        smoothRoute={tab === 'route' || riding ? routes.smooth : null}
        routeMuted={riding}
        shortRoute={tab === 'route' && !riding ? routes.short : null}
        from={tab === 'route' ? from : null}
        to={tab === 'route' ? to : null}
        trail={trail}
        position={position}
        issues={tab === 'reports' || (tab === 'ride' && lastRide) ? issues : []}
        onMapClick={onMapClick}
        focus={focus}
        padding={mapPadding()}
      />

      <div className="map-chrome">
        <Legend showSegments={showSegments} onToggle={() => setShowSegments((v) => !v)} />
      </div>
      {picking && (
        <div className="pick-hint" role="status">
          <span className={clsx('pick-dot', picking === 'from' ? 'is-a' : 'is-b')} />
          Tap the map to set {picking === 'from' ? 'the start' : 'the destination'}
          <button onClick={() => setPicking(null)}>Cancel</button>
        </div>
      )}
      {loadError && (
        <div className="pick-hint is-error" role="alert">
          Couldn't load map data. {loadError}
        </div>
      )}

      <aside className="sheet" aria-label="RollMap">
        <header className="sheet-head">
          <div className="brand">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
              <rect width="32" height="32" rx="9" fill="currentColor" />
              <circle cx="15" cy="14" r="7.5" fill="none" stroke="#fff" strokeWidth="2.4" />
              <path d="M15 6.5v15M7.5 14h15M9.7 8.7l10.6 10.6M20.3 8.7 9.7 19.3" stroke="#fff" strokeWidth="1.2" opacity=".55" />
              <circle cx="15" cy="14" r="2" fill="#fff" />
              <path d="M4 26.5c2.6-1.8 5.2-1.8 7.8 0s5.2 1.8 7.8 0 5.2-1.8 7.8 0" fill="none" stroke="#86efac" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <div>
              <div className="brand-name">RollMap</div>
              <div className="brand-sub">Sidewalks scored by how they feel on wheels</div>
            </div>
          </div>
        </header>

        <nav className="segmented" role="tablist" style={{ ['--i' as string]: tabIndex, ['--n' as string]: TABS.length }}>
          <span className="segmented-thumb" aria-hidden />
          {TABS.map(([id, name]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={clsx(tab === id && 'is-active')} onClick={() => setTab(id)}>
              {name}
              {id === 'reports' && issues.length > 0 && <span className="count">{issues.length}</span>}
              {id === 'ride' && riding && <span className="live-dot" aria-label="recording" />}
            </button>
          ))}
        </nav>

        <div className="sheet-body" key={tab}>
          {tab === 'route' && (
            <RoutePanel
              profile={profile}
              setProfile={setProfile}
              smooth={routes.smooth}
              short={routes.short}
              error={routes.error}
              loading={!graph}
              fromName={from ? (streetAt(from[0], from[1]) ?? 'Dropped pin') : null}
              toName={to ? (streetAt(to[0], to[1]) ?? 'Dropped pin') : null}
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
              onFocus={(lat, lon) => setFocus({ lat, lon, zoom: 18.5, nonce: Date.now() })}
              onCleared={() => {
                setRides([]);
                setMine(new Map());
                setLastRide(null);
              }}
            />
          )}
          {tab === 'about' && <AboutPanel model={model} seedRides={seedRides} />}
        </div>
      </aside>

      <Toaster position="top-center" toastOptions={{ className: 'toast' }} />
    </div>
  );
}
