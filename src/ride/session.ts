// A ride in progress, fed either by the phone's real sensors or by a simulated sensor stream.

import { exposure } from '../core/comfort';
import { haversine, RideAnalyzer, type GeoFix, type WindowResult } from '../core/analyzer';
import { detectIssues } from '../core/issues';
import type { RawSample } from '../core/features';
import type { MlpModel } from '../ml/mlp';
import type { RideRecord } from '../store';
import type { SimRide } from '../sim/rideSim';

export interface LiveState {
  running: boolean;
  simulated: boolean;
  elapsedMs: number;
  distanceM: number;
  last: WindowResult | null;
  windows: WindowResult[];
  trace: number[]; // recent vertical acceleration samples, for the live waveform
  jolts: number;
  gpsAccuracy: number | null;
  sampleHz: number;
  error?: string;
}

type Listener = (s: LiveState) => void;

export class RideSession {
  readonly id = `ride-${Date.now().toString(36)}`;
  private analyzer: RideAnalyzer;
  private listeners = new Set<Listener>();
  private cleanup: (() => void)[] = [];
  private started = Date.now();
  private lastFix: GeoFix | null = null;
  private sampleTimes: number[] = [];
  private gravityEstimate = [0, 0, 9.81];
  state: LiveState;

  readonly simulated: boolean;

  constructor(model: MlpModel, simulated: boolean) {
    this.simulated = simulated;
    this.analyzer = new RideAnalyzer(model);
    this.state = { running: false, simulated, elapsedMs: 0, distanceM: 0, last: null, windows: [], trace: [], jolts: 0, gpsAccuracy: null, sampleHz: 0 };
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  set label(l: string | undefined) {
    this.analyzer.label = l;
  }

  private emit(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private onSample(s: RawSample) {
    // Live waveform: subtract a slow gravity estimate, project roughly on it.
    const g = this.gravityEstimate;
    for (let i = 0; i < 3; i++) g[i] = 0.98 * g[i] + 0.02 * [s.ax, s.ay, s.az][i];
    const gn = Math.hypot(g[0], g[1], g[2]) || 1;
    const v = ((s.ax - g[0]) * g[0] + (s.ay - g[1]) * g[1] + (s.az - g[2]) * g[2]) / gn;
    const trace = this.state.trace.length > 240 ? this.state.trace.slice(-240) : this.state.trace.slice();
    trace.push(v);

    this.sampleTimes.push(s.t);
    while (this.sampleTimes.length && this.sampleTimes[0] < s.t - 2000) this.sampleTimes.shift();

    const results = this.analyzer.addSample(s);
    if (results.length) {
      const windows = this.state.windows.concat(results);
      this.emit({
        trace,
        windows,
        last: results[results.length - 1],
        jolts: windows.filter((w, i) => w.jolt && !windows[i - 1]?.jolt).length,
        sampleHz: this.sampleTimes.length / 2,
      });
    } else if (trace.length % 6 === 0) {
      this.emit({ trace });
    } else {
      this.state.trace = trace;
    }
  }

  private onFix(f: GeoFix) {
    this.analyzer.addFix(f);
    let distanceM = this.state.distanceM;
    if (f.accuracy < 30) {
      // Only count real movement, not GPS jitter while standing still.
      const step = this.lastFix ? haversine(this.lastFix.lat, this.lastFix.lon, f.lat, f.lon) : 0;
      if (!this.lastFix) this.lastFix = f;
      else if (step > Math.max(5, f.accuracy)) {
        distanceM += step;
        this.lastFix = f;
      }
    }
    this.emit({ distanceM, gpsAccuracy: f.accuracy });
  }

  /** Start reading the phone's real accelerometer and GPS. Must be called from a tap. */
  async startSensors() {
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DME.requestPermission === 'function') {
      const r = await DME.requestPermission();
      if (r !== 'granted') {
        this.emit({ error: 'Motion sensor permission was denied.' });
        return;
      }
    }
    const motion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a?.x == null || a.y == null || a.z == null) return;
      this.onSample({ t: performance.timeOrigin + e.timeStamp, ax: a.x, ay: a.y, az: a.z });
    };
    window.addEventListener('devicemotion', motion);
    this.cleanup.push(() => window.removeEventListener('devicemotion', motion));

    if ('geolocation' in navigator) {
      const id = navigator.geolocation.watchPosition(
        (p) =>
          this.onFix({
            t: p.timestamp,
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            accuracy: p.coords.accuracy,
            speed: p.coords.speed,
          }),
        (err) => this.emit({ error: `Location: ${err.message}. Vibration is still recorded, but it can't be mapped.` }),
        { enableHighAccuracy: true, maximumAge: 0 },
      );
      this.cleanup.push(() => navigator.geolocation.clearWatch(id));
    }

    // Phones stop sensor events when the screen sleeps, so keep it awake during a ride.
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      const lock = await nav.wakeLock?.request('screen');
      if (lock) this.cleanup.push(() => void lock.release());
    } catch {
      /* not supported; the ride page tells the user to keep the screen on */
    }
    this.started = Date.now();
    const timer = setInterval(() => this.emit({ elapsedMs: Date.now() - this.started }), 500);
    this.cleanup.push(() => clearInterval(timer));
    setTimeout(() => this.analyzer.calibrateLevel(), 1500);
    this.emit({ running: true });

    // If no motion events arrive the device has no accelerometer (e.g. a laptop).
    setTimeout(() => {
      if (this.state.running && this.sampleTimes.length === 0) {
        this.emit({ error: 'No motion sensor data. Open RollMap on a phone, or try a simulated ride.' });
      }
    }, 2500);
  }

  /** Play a simulated sensor stream in (accelerated) real time. */
  startSimulation(sim: SimRide, speedup: number, onPosition?: (lat: number, lon: number) => void) {
    const t0 = performance.now();
    let si = 0;
    let fi = 0;
    let pi = 0;
    const base = sim.samples[0]?.t ?? 0;
    const tick = () => {
      const simT = base + (performance.now() - t0) * speedup;
      while (fi < sim.fixes.length && sim.fixes[fi].t <= simT) this.onFix(sim.fixes[fi++]);
      while (si < sim.samples.length && sim.samples[si].t <= simT) this.onSample(sim.samples[si++]);
      while (pi < sim.path.length - 1 && sim.path[pi + 1].t <= simT) pi++;
      const a = sim.path[pi];
      const b = sim.path[Math.min(pi + 1, sim.path.length - 1)];
      if (a && b && onPosition) {
        const u = b.t > a.t ? Math.min(1, (simT - a.t) / (b.t - a.t)) : 0;
        onPosition(a.lat + (b.lat - a.lat) * u, a.lon + (b.lon - a.lon) * u);
      }
      this.emit({ elapsedMs: simT - base });
      if (si >= sim.samples.length) {
        this.emit({ running: false });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    this.cleanup.push(() => cancelAnimationFrame(raf));
    this.emit({ running: true });
  }

  stop(streetAt: (lat: number, lon: number) => string | undefined): RideRecord {
    for (const c of this.cleanup.splice(0)) c();
    this.emit({ running: false });
    const w = this.state.windows;
    const hop = w.length > 1 ? (w[w.length - 1].t - w[0].t) / (w.length - 1) / 1000 : 0.64;
    const exp = exposure(w.map((x) => ({ aw: x.aw, vdvRate: x.vdvRate, seconds: hop })));
    const score = w.length ? Math.round(w.reduce((s, x) => s + x.score, 0) / w.length) : 100;
    return {
      id: this.id,
      started: this.started,
      ended: Date.now(),
      simulated: this.simulated,
      distanceM: Math.round(this.state.distanceM),
      score,
      aw: exp.aw,
      vdv: exp.vdv,
      healthZone: exp.healthZone,
      windows: w.map(({ t, lat, lon, score, surface, jolt, tilt, aw, peak }) => ({ t, lat, lon, score, surface, jolt, tilt, aw, peak })),
      issues: detectIssues(this.id, w, this.simulated, streetAt),
    };
  }
}
