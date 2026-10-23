// Trains the surface classifier and writes src/ml/model.json.
//
//   npm run train
//
// Training data = physics-based synthetic rides (src/core/synth.ts) plus any real labelled
// windows exported from the app's "Teach RollMap" mode into data/real/*.json.
// Real windows are weighted more heavily so they dominate once enough exist.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractFeatures, FEATURE_NAMES, resample, splitAxes, WINDOW_MS } from '../src/core/features';
import { mulberry32, SURFACES, synthesize, type Rng, type Surface } from '../src/core/synth';
import { train, predict, type MlpModel } from '../src/ml/mlp';

const REAL_WEIGHT = 5;

function syntheticWindows(surface: Surface, rides: number, rng: Rng) {
  const rows: number[][] = [];
  for (let r = 0; r < rides; r++) {
    const speed = 0.4 + rng() * 1.3;
    const seconds = 8;
    const samples = synthesize({ surface, seconds, speed, rng, deviceHz: 50 + rng() * 150 });
    // GPS speed is noisy or missing in real life; train with that.
    const gpsSpeed = rng() < 0.2 ? null : speed * (0.8 + rng() * 0.4);
    for (let end = WINDOW_MS + 200; end < seconds * 1000 - 100; end += WINDOW_MS / 2) {
      const win = resample(samples, end);
      if (win) rows.push(extractFeatures(splitAxes(win), gpsSpeed));
    }
  }
  return rows;
}

function loadReal(): { X: number[][]; y: number[] } {
  const dir = join(import.meta.dirname, '..', 'data', 'real');
  const X: number[][] = [];
  const y: number[] = [];
  if (!existsSync(dir)) return { X, y };
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { windows: { label?: string; features: number[] }[] };
    for (const w of doc.windows) {
      const k = SURFACES.indexOf(w.label as Surface);
      if (k >= 0 && w.features?.length === FEATURE_NAMES.length) {
        X.push(w.features);
        y.push(k);
      }
    }
  }
  return { X, y };
}

function evaluate(model: MlpModel, X: number[][], y: number[]) {
  const k = model.classes.length;
  const confusion = Array.from({ length: k }, () => new Array(k).fill(0));
  let correct = 0;
  X.forEach((x, i) => {
    const p = model.classes.indexOf(predict(model, x).label);
    confusion[y[i]][p]++;
    if (p === y[i]) correct++;
  });
  return { accuracy: correct / X.length, confusion };
}

const rng = mulberry32(2026);
const X: number[][] = [];
const y: number[] = [];
const w: number[] = [];
SURFACES.forEach((s, k) => {
  for (const row of syntheticWindows(s, 250, rng)) {
    X.push(row);
    y.push(k);
    w.push(1);
  }
});
const synthCount = X.length;
const real = loadReal();
real.X.forEach((row, i) => {
  X.push(row);
  y.push(real.y[i]);
  w.push(REAL_WEIGHT);
});

console.log(`training on ${synthCount} synthetic + ${real.X.length} real windows`);
const model = train(X, y, w, [...SURFACES], FEATURE_NAMES, { hidden: 32, epochs: 150, lr: 0.01, l2: 1e-4, seed: 1 }, rng);

// Held-out test: fresh rides from a different seed, so phone orientation, speed and
// wheelchair resonance are all unseen.
const testRng = mulberry32(99);
const tX: number[][] = [];
const tY: number[] = [];
SURFACES.forEach((s, k) => {
  for (const row of syntheticWindows(s, 40, testRng)) {
    tX.push(row);
    tY.push(k);
  }
});
const test = evaluate(model, tX, tY);
console.log(`held-out synthetic accuracy: ${(test.accuracy * 100).toFixed(1)}%`);
console.log('confusion (rows = truth, cols = predicted):', SURFACES.join(', '));
test.confusion.forEach((row, i) => console.log(`  ${SURFACES[i].padEnd(7)} ${row.map((v) => String(v).padStart(4)).join('')}`));

model.trainedOn = { synthetic: synthCount, real: real.X.length, date: new Date().toISOString().slice(0, 10) };
model.metrics = { heldOutSyntheticAccuracy: Math.round(test.accuracy * 1000) / 1000 };
writeFileSync(join(import.meta.dirname, '..', 'src', 'ml', 'model.json'), JSON.stringify(model));
console.log('wrote src/ml/model.json');
