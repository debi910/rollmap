import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
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
import { StreetCard, type StreetInfo } from './components/StreetCard';
import { RoutableGraph } from './geo/graph';
import type { StreetGraph } from './geo/osm';
import { assessEdge, findRoute, PROFILES, type ProfileId, type RouteResult } from './geo/router';
import { addRide, deserializeSegments, joltsPerRide, mergeSegments, segmentScore, serializeSegments, topSurface, type SegmentMap, type SegmentStats } from './geo/segments';
import { RideSession, type LiveState } from './ride/session';
import { simulateRide } from './sim/rideSim';
import { loadBarriers, loadMySegments, loadRides, loadTraining, saveBarriers, saveMySegments, saveRides, saveTraining, type BarrierKind, type Issue, type RideRecord } from './store';
import { haversine, type WindowResult } from './core/analyzer';

const model = modelJson as MlpModel;
export type Tab = 'route' | 'ride' | 'reports' | 'about';

// A route through Monaco where the shortest path uses steps and rough paving.
const DEMO_FROM: [number, number] = [43.73405, 7.42161];
const DEMO_TO: [number, number] = [43.73845, 7.41924];

const TABS: [Tab, string][] = [
  ['route', 'Route'],
  ['ride', 'Record'],
  ['reports', 'Reports'],
  ['about', 'About'],
];

// Shared links carry the trip in the URL: #from=lat,lon&to=lat,lon&p=manual
function readHash(): { from?: [number, number]; to?: [number, number]; profile?: ProfileId } {
  const q = new URLSearchParams(window.location.hash.slice(1));
  const pt = (v: string | null): [number, number] | undefined => {
    const m = v?.split(',').map(Number);
    return m && m.length === 2 && m.every(Number.isFinite) ? [m[0], m[1]] : undefined;
  };
  const prof = q.get('p') as ProfileId | null;
  return { from: pt(q.get('from')), to: pt(q.get('to')), profile: prof && prof in PROFILES ? prof : undefined };
}
const shared = readHash();

const WELCOMED_KEY = 'rollmap.welcomed';
const wasWelcomed = () => {
  try {
    return !!localStorage.getItem(WELCOMED_KEY) || !!shared.from;
  } catch {
    return false;
  }
};

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

  const [from, setFrom] = useState<[number, number] | null>(shared.from ?? DEMO_FROM);
  const [to, setTo] = useState<[number, number] | null>(shared.to ?? DEMO_TO);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [profile, setProfile] = useState<ProfileId>(shared.profile ?? 'manual');
  const [barriers, setBarriers] = useState<Issue[]>(() => loadBarriers());
  const [inspect, setInspect] = useState<{ edge: number; lat: number; lon: number } | null>(null);
  const [firstVisit, setFirstVisit] = useState(() => !wasWelcomed());

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
  const barrierMap = useMemo(() => new Map(barriers.filter((b) => b.edgeKey).map((b) => [b.edgeKey!, b.barrier ?? 'hazard'] as [string, BarrierKind])), [barriers]);

  const routes = useMemo(() => {
    if (!graph || !from || !to) return { smooth: null as RouteResult | null, short: null as RouteResult | null, error: null as string | null };
    const prof = PROFILES[profile];
    const accept = (e: { way: { h: string } }) => e.way.h !== 'steps';
    const a = graph.nearestNode(from[0], from[1], accept);
    const b = graph.nearestNode(to[0], to[1], accept);
    if (a == null || b == null) return { smooth: null, short: null, error: 'Pick points closer to a street.' };
    const smooth = findRoute(graph, segments, a, b, prof, barrierMap);
    const short = findRoute(graph, segments, a, b, PROFILES.walking);
    return { smooth, short, error: smooth ? null : 'No step-free route between these points.' };
  }, [graph, from, to, profile, segments, barrierMap]);

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
      if (hit) return graph.edges[hit.edge].way.name;
      // Unnamed road: fall back to the neighbourhood so the user still knows roughly where it is.
      let best: string | undefined;
      let bestD = 1500;
      for (const l of basemap?.labels ?? []) {
        const d = haversine(lat, lon, l.lat, l.lon);
        if (d < bestD) [best, bestD] = [l.name, d];
      }
      return best ? `Near ${best}` : undefined;
    },
    [graph, basemap],
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
      } else if (graph) {
        // Tap a street to see how it rides and why.
        // Taps near the drawn route mean the route, even if a side street is a hair closer.
        const onRoute = new Set(routes.smooth?.edges.map((i) => graph.edges[i].key));
        const hit = graph.nearestEdge(lat, lon, 25, (e) => onRoute.has(e.key)) ?? graph.nearestEdge(lat, lon, 30);
        setInspect(hit ? { edge: hit.edge, lat, lon } : null);
      }
    },
    [picking, graph, routes.smooth],
  );

  const streetInfo = useMemo((): StreetInfo | null => {
    if (!inspect || !graph) return null;
    const e = graph.edges[inspect.edge];
    const seg = segments.get(e.key);
    const measured = !!seg && seg.n >= 2;
    const est = assessEdge(e, segments, { ...PROFILES.manual, stepsAllowed: true, maxInclinePct: 100 });
    const [lat, lon] = graph.snap(inspect.lat, inspect.lon);
    return {
      edge: inspect.edge,
      lat,
      lon,
      name: e.way.name ?? streetAt(lat, lon) ?? 'Unnamed path',
      kind: e.way.h,
      osmSurface: e.way.s,
      incline: e.way.inc,
      steps: e.way.h === 'steps',
      score: measured ? segmentScore(seg) : Math.round((1 - est.discomfort) * 100),
      measuredRides: measured ? seg.rides.length : 0,
      lastSeen: measured ? seg.lastSeen : null,
      joltsPerPass: measured ? joltsPerRide(seg) : 0,
      surface: measured ? topSurface(seg) : null,
      demo: measured && !mine.has(e.key),
      barrier: barriers.find((b) => b.edgeKey === e.key) ?? null,
    };
  }, [inspect, graph, segments, barriers, streetAt, mine]);

  const reportBarrier = (kind: BarrierKind) => {
    if (!streetInfo || !graph) return;
    const e = graph.edges[streetInfo.edge];
    const b: Issue = {
      id: `b-${Date.now().toString(36)}`,
      kind: 'barrier',
      barrier: kind,
      edgeKey: e.key,
      lat: streetInfo.lat,
      lon: streetInfo.lon,
      t: Date.now(),
      street: streetInfo.name,
      rideId: 'manual',
      simulated: false,
    };
    const next = [...barriers, b];
    setBarriers(next);
    saveBarriers(next);
    toast.success('Thanks, reported', { description: kind === 'hazard' ? 'Routes now steer around this spot when they can.' : 'Routes now avoid this street. It’s also in Reports, ready to send to the city.' });
  };
  const removeBarrier = (id: string) => {
    const next = barriers.filter((b) => b.id !== id);
    setBarriers(next);
    saveBarriers(next);
    toast('Marked as fixed');
  };

  const dismissWelcome = () => {
    setFirstVisit(false);
    try {
      localStorage.setItem(WELCOMED_KEY, '1');
    } catch {
      /* private mode */
    }
  };

  const shareRoute = async () => {
    if (!from || !to) return;
    const f = (p: [number, number]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
    const url = `${window.location.origin}${window.location.pathname}#from=${f(from)}&to=${f(to)}&p=${profile}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Step-free route on RollMap', url });
        return;
      } catch {
        /* cancelled: fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', { description: 'Anyone who opens it sees this route.' });
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (setInspect(null), setPicking(null));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const issues = useMemo(() => [...barriers, ...rides.flatMap((r) => r.issues)], [rides, barriers]);

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
        issues={tab === 'reports' || (tab === 'ride' && lastRide) ? issues : barriers}
        selected={streetInfo ? graph!.edges[streetInfo.edge].way.n.map((i) => graph!.data.nodes[i]) : null}
        onMapClick={onMapClick}
        focus={focus}
        padding={mapPadding()}
      />

      <div className="map-chrome">
        <Legend showSegments={showSegments} onToggle={() => setShowSegments((v) => !v)} />
      </div>
      {streetInfo && !picking && (
        <div className="map-card">
          <StreetCard
            key={streetInfo.edge}
            info={streetInfo}
            onClose={() => setInspect(null)}
            onReport={reportBarrier}
            onFixed={removeBarrier}
            onFrom={() => {
              setFrom([streetInfo.lat, streetInfo.lon]);
              setInspect(null);
              setTab('route');
              setFitRoutes(Date.now());
            }}
            onTo={() => {
              setTo([streetInfo.lat, streetInfo.lon]);
              setInspect(null);
              setTab('route');
              setFitRoutes(Date.now());
            }}
          />
        </div>
      )}
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
              riding={riding}
              firstVisit={firstVisit}
              onDismissWelcome={dismissWelcome}
              onShare={shareRoute}
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
              onRemove={removeBarrier}
              onCleared={() => {
                setRides([]);
                setBarriers([]);
                setMine(new Map());
                setLastRide(null);
              }}
            />
          )}
          {tab === 'about' && <AboutPanel model={model} seedRides={seedRides} />}
        </div>
      </aside>

      <Toaster position={window.innerWidth > 860 ? 'bottom-center' : 'top-center'} toastOptions={{ className: 'toast' }} />
    </div>
  );
}
