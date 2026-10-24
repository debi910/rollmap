// Runs real, publicly shared phone rides through the exact pipeline the app uses and checks the
// output against independent evidence. Nothing here is simulated.
//
//   git clone --depth 1 https://github.com/pratyushk22/campus-road-roughness /tmp/crr
//   git clone --depth 1 https://github.com/warstad11/pothole /tmp/potholes
//   npx tsx scripts/validate-real.ts /tmp/crr /tmp/potholes
//
// Datasets (not redistributed here, see their repos for terms):
//   campus-road-roughness: 4 bicycle rides, 100 Hz phone accelerometer + GPS, IIT Guwahati,
//     with defect photos located on the route and per-50 m segment labels.
//   warstad11/pothole: 6 car drives, 100 Hz, 232 events hand-labelled pothole / not_pothole.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RideAnalyzer, haversine, type WindowResult } from '../src/core/analyzer';
import type { MlpModel } from '../src/ml/mlp';

const root = join(import.meta.dirname, '..');
const model = JSON.parse(readFileSync(join(root, 'src/ml/model.json'), 'utf8')) as MlpModel;
const [crrDir = '/tmp/crr', potDir = '/tmp/potholes'] = process.argv.slice(2);

const csv = (path: string) =>
  readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((c) => c.replace(/"/g, '').trim()));

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
function pearson(a: number[], b: number[]) {
  const ma = mean(a);
  const mb = mean(b);
  let n = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i] - mb);
    da += (x - ma) ** 2;
    db += (b[i] - mb) ** 2;
  });
  return n / Math.sqrt(da * db);
}

const report: Record<string, unknown> = {};

// ---------- 1. Bicycle rides with GPS (campus-road-roughness) ----------
interface Win extends WindowResult {
  ride: string;
}
const RIDES = ['rp2', 'rp3', 'rp5', 'rp6'];
const wins: Win[] = [];
for (const ride of RIDES) {
  const dir = join(crrDir, 'data/raw/rides', ride);
  const a = new RideAnalyzer(model);
  const loc = csv(join(dir, 'Location.csv')).slice(1);
  let li = 0;
  for (const r of csv(join(dir, 'Accelerometer.csv')).slice(1)) {
    const t = Number(r[0]) * 1000;
    while (li < loc.length && Number(loc[li][0]) * 1000 <= t) {
      const f = loc[li++];
      const acc = Number(f[6]);
      const v = Number(f[4]);
      if (acc < 30) a.addFix({ t: Number(f[0]) * 1000, lat: Number(f[1]), lon: Number(f[2]), accuracy: acc, speed: Number.isFinite(v) ? v : null });
    }
    for (const w of a.addSample({ t, ax: Number(r[1]), ay: Number(r[2]), az: Number(r[3]) })) wins.push({ ...w, ride });
  }
}
const moving = wins.filter((w) => w.lat != null && (w.speed ?? 0) > 1.5);

// Segment labels: nearest of the dataset's 88 map-matched hotspots, within 60 m.
const bins = csv(join(crrDir, 'data/processed/hotspots.csv'))
  .slice(1)
  .map((r) => [r[3], '', r[1], r[2]]);
const segOf = (w: Win) => {
  let best: string | null = null;
  let bd = 60;
  for (const b of bins) {
    const d = haversine(w.lat!, w.lon!, Number(b[2]), Number(b[3]));
    if (d < bd) {
      bd = d;
      best = b[0];
    }
  }
  return best;
};
const bySeg = new Map<string, number[]>();
for (const w of moving) {
  const s = segOf(w);
  if (s) bySeg.set(s, [...(bySeg.get(s) ?? []), w.score]);
}
const segNames = Object.fromEntries(csv(join(crrDir, 'data/processed/segment_summary.csv')).slice(1).map((r) => [r[0], r[1]]));
report.segments = [...bySeg]
  .map(([s, v]) => ({ seg: s, name: segNames[s], windows: v.length, meanScore: Math.round(mean(v)) }))
  .sort((x, y) => x.meanScore - y.meanScore);
// Per-ride segment means: does each ride on its own tell the same story?
const segRide = new Map<string, number[]>();
for (const w of moving) {
  const s = segOf(w);
  if (s) segRide.set(`${s}|${w.ride}`, [...(segRide.get(`${s}|${w.ride}`) ?? []), w.score]);
}
report.segmentByRide = Object.fromEntries([...segRide].filter(([, v]) => v.length >= 30).map(([k, v]) => [k, Math.round(mean(v))]));

// Repeatability: same 40 m cell, different rides.
const cellKey = (w: Win) => `${Math.round(w.lat! / 0.00036)}:${Math.round(w.lon! / 0.0004)}`;
const cells = new Map<string, Map<string, number[]>>();
for (const w of moving) {
  const c = cells.get(cellKey(w)) ?? new Map<string, number[]>();
  c.set(w.ride, [...(c.get(w.ride) ?? []), w.score]);
  cells.set(cellKey(w), c);
}
const pa: number[] = [];
const pb: number[] = [];
for (const c of cells.values()) {
  const rs = [...c.values()].filter((v) => v.length >= 3).map(mean);
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    pa.push(rs[i]);
    pb.push(rs[j]);
  }
}
const absDiff = mean(pa.map((x, i) => Math.abs(x - pb[i])));
report.repeatability = { cellPairs: pa.length, pearsonR: +pearson(pa, pb).toFixed(2), meanAbsDiff: +absDiff.toFixed(1) };

// Jolts vs. defects photographed on the route (an independent record: a person stopped and took a picture).
const jolts = moving.filter((w) => w.jolt);
const photos = csv(join(crrDir, 'data/processed/photo_locations.csv')).slice(1);
const spots: [number, number][] = [];
for (const p of photos) {
  const ll: [number, number] = [Number(p[2]), Number(p[3])];
  if (!spots.some((s) => haversine(s[0], s[1], ll[0], ll[1]) < 10)) spots.push(ll);
}
const near = (ll: [number, number], r: number) => jolts.filter((j) => haversine(j.lat!, j.lon!, ll[0], ll[1]) <= r);
const found = spots.filter((s) => near(s, 25).length > 0).length;
const ridesHit = spots.map((s) => new Set(near(s, 25).map((j) => j.ride)).size);
// Control: the same test on random points along the route, to show the hit rate isn't just jolt density.
const rng = (() => {
  let x = 42;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
})();
const controls = Array.from({ length: 300 }, () => moving[Math.floor(rng() * moving.length)]).map((w): [number, number] => [w.lat!, w.lon!]);
const repeatHit = (ll: [number, number]) => new Set(near(ll, 25).map((j) => j.ride)).size >= 3;
report.bikeJolts = {
  spotsFlaggedBy3PlusRides: spots.filter(repeatHit).length,
  randomRoutePointsFlaggedBy3PlusRides: +(controls.filter(repeatHit).length / controls.length).toFixed(2),
  movingWindows: moving.length,
  joltWindows: jolts.length,
  joltsPerKm: +(jolts.length / (moving.reduce((s, w) => s + (w.speed ?? 0) * 0.64, 0) / 1000)).toFixed(1),
  photographedDefectSpots: spots.length,
  spotsWithJoltWithin25m: found,
  meanRidesFlaggingEachSpot: +mean(ridesHit).toFixed(1),
};

// ---------- 2. Car drives with labelled events (warstad11/pothole) ----------
if (existsSync(potDir)) {
  const labels = csv(join(potDir, 'dataset/labels.csv')).slice(1);
  const scored: { label: string; peak: number; jolt: boolean }[] = [];
  for (const drive of [...new Set(labels.map((l) => l[1]))]) {
    const rows = csv(join(potDir, 'dataset/drives', drive, 'sensor.csv')).slice(1);
    const a = new RideAnalyzer(model);
    const ws: WindowResult[] = [];
    // This export has gravity removed (m/s²). Road vibration in a car is mostly vertical, so put
    // gravity back on the axis with the most variance, giving the pipeline what a browser's
    // accelerationIncludingGravity would.
    const vars = [1, 2, 3].map((i) => {
      const v = rows.map((r) => Number(r[i]));
      const m = mean(v);
      return mean(v.map((x) => (x - m) ** 2));
    });
    const up = vars.indexOf(Math.max(...vars));
    for (const r of rows) {
      const g = [0, 1, 2].map((i) => Number(r[i + 1]) + (i === up ? 9.81 : 0));
      ws.push(...a.addSample({ t: Number(r[0]) * 1000, ax: g[0], ay: g[1], az: g[2] }));
    }
    for (const l of labels.filter((x) => x[1] === drive && x[3] !== 'unsure')) {
      const tc = Number(l[2]) * 1000;
      const near = ws.filter((w) => w.t >= tc - 1500 && w.t - 1280 <= tc + 1500);
      if (!near.length) continue;
      scored.push({ label: l[3], peak: Math.max(...near.map((w) => w.peak)), jolt: near.some((w) => w.jolt) });
    }
  }
  const pos = scored.filter((s) => s.label === 'pothole');
  const neg = scored.filter((s) => s.label !== 'pothole');
  let auc = 0;
  for (const p of pos) for (const n of neg) auc += p.peak > n.peak ? 1 : p.peak === n.peak ? 0.5 : 0;
  auc /= pos.length * neg.length;
  report.carPotholes = {
    potholes: pos.length,
    notPothole: neg.length,
    peakAuc: +auc.toFixed(2),
    medianPeakPothole: +pos.map((s) => s.peak).sort((a, b) => a - b)[Math.floor(pos.length / 2)].toFixed(1),
    medianPeakOther: +neg.map((s) => s.peak).sort((a, b) => a - b)[Math.floor(neg.length / 2)].toFixed(1),
    joltRecall: +(pos.filter((s) => s.jolt).length / pos.length).toFixed(2),
    joltFalseRate: +(neg.filter((s) => s.jolt).length / neg.length).toFixed(2),
  };
}

console.log(JSON.stringify(report, null, 2));
writeFileSync(join(root, 'docs/validation.json'), JSON.stringify(report, null, 2) + '\n');
