// A tiny multilayer perceptron, small enough to train in Node in seconds and run on any phone.
// We keep the model as plain JSON so it ships with the app and needs no ML runtime.

export interface MlpModel {
  version: number;
  classes: string[];
  featureNames: string[];
  mean: number[];
  std: number[];
  w1: number[][]; // hidden x input
  b1: number[];
  w2: number[][]; // classes x hidden
  b2: number[];
  trainedOn: { synthetic: number; real: number; date: string };
  metrics?: Record<string, number>;
}

export function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

function forwardRaw(model: Pick<MlpModel, 'w1' | 'b1' | 'w2' | 'b2'>, x: number[]) {
  const h = model.w1.map((row, j) => Math.max(0, row.reduce((s, w, i) => s + w * x[i], model.b1[j])));
  const z = model.w2.map((row, k) => row.reduce((s, w, j) => s + w * h[j], model.b2[k]));
  return { h, p: softmax(z) };
}

export function normalize(model: Pick<MlpModel, 'mean' | 'std'>, x: number[]): number[] {
  return x.map((v, i) => (v - model.mean[i]) / (model.std[i] || 1));
}

export function predict(model: MlpModel, features: number[]): { label: string; probs: number[] } {
  const { p } = forwardRaw(model, normalize(model, features));
  let best = 0;
  p.forEach((v, i) => {
    if (v > p[best]) best = i;
  });
  return { label: model.classes[best], probs: p };
}

export interface TrainOptions {
  hidden: number;
  epochs: number;
  lr: number;
  l2: number;
  seed: number;
}

export function train(
  X: number[][],
  y: number[],
  weights: number[],
  classes: string[],
  featureNames: string[],
  opts: TrainOptions,
  rng: () => number,
): MlpModel {
  const d = X[0].length;
  const k = classes.length;
  const mean = Array.from({ length: d }, (_, i) => X.reduce((s, r) => s + r[i], 0) / X.length);
  const std = Array.from({ length: d }, (_, i) =>
    Math.sqrt(X.reduce((s, r) => s + (r[i] - mean[i]) ** 2, 0) / X.length) || 1,
  );
  const Xn = X.map((r) => normalize({ mean, std }, r));

  const init = (fanIn: number) => (rng() * 2 - 1) * Math.sqrt(6 / fanIn);
  const w1 = Array.from({ length: opts.hidden }, () => Array.from({ length: d }, () => init(d)));
  const b1 = new Array(opts.hidden).fill(0);
  const w2 = Array.from({ length: k }, () => Array.from({ length: opts.hidden }, () => init(opts.hidden)));
  const b2 = new Array(k).fill(0);

  // Adam state, flattened per parameter tensor.
  const params = [w1, b1, w2, b2] as unknown as (number[] | number[][])[];
  const m = params.map((p) => JSON.parse(JSON.stringify(p).replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '0')));
  const vv = params.map((p) => JSON.parse(JSON.stringify(p).replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '0')));
  const beta1 = 0.9;
  const beta2 = 0.999;
  let step = 0;

  const order = Xn.map((_, i) => i);
  const batch = 64;
  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let start = 0; start < order.length; start += batch) {
      const idx = order.slice(start, start + batch);
      const gw1 = w1.map((r) => r.map(() => 0));
      const gb1 = b1.map(() => 0);
      const gw2 = w2.map((r) => r.map(() => 0));
      const gb2 = b2.map(() => 0);
      let wsum = 0;
      for (const n of idx) {
        const x = Xn[n];
        const { h, p } = forwardRaw({ w1, b1, w2, b2 }, x);
        const sw = weights[n];
        wsum += sw;
        const dz = p.map((pk, c) => (pk - (c === y[n] ? 1 : 0)) * sw);
        const dh = new Array(opts.hidden).fill(0);
        for (let c = 0; c < k; c++) {
          gb2[c] += dz[c];
          for (let j = 0; j < opts.hidden; j++) {
            gw2[c][j] += dz[c] * h[j];
            dh[j] += dz[c] * w2[c][j];
          }
        }
        for (let j = 0; j < opts.hidden; j++) {
          if (h[j] <= 0) continue;
          gb1[j] += dh[j];
          for (let i = 0; i < d; i++) gw1[j][i] += dh[j] * x[i];
        }
      }
      step++;
      const grads = [gw1, gb1, gw2, gb2];
      grads.forEach((g, pi) => {
        const p = params[pi];
        const update = (pv: number[], gv: number[], mv: number[], vvv: number[]) => {
          for (let q = 0; q < pv.length; q++) {
            const gq = gv[q] / wsum + (pi % 2 === 0 ? opts.l2 * pv[q] : 0);
            mv[q] = beta1 * mv[q] + (1 - beta1) * gq;
            vvv[q] = beta2 * vvv[q] + (1 - beta2) * gq * gq;
            const mh = mv[q] / (1 - beta1 ** step);
            const vh = vvv[q] / (1 - beta2 ** step);
            pv[q] -= (opts.lr * mh) / (Math.sqrt(vh) + 1e-8);
          }
        };
        if (Array.isArray(p[0])) {
          (p as number[][]).forEach((row, r) => update(row, (g as number[][])[r], m[pi][r], vv[pi][r]));
        } else {
          update(p as number[], g as number[], m[pi], vv[pi]);
        }
      });
    }
  }

  const round = (x: number) => Math.round(x * 1e5) / 1e5;
  return {
    version: 1,
    classes,
    featureNames,
    mean: mean.map(round),
    std: std.map(round),
    w1: w1.map((r) => r.map(round)),
    b1: b1.map(round),
    w2: w2.map((r) => r.map(round)),
    b2: b2.map(round),
    trainedOn: { synthetic: 0, real: 0, date: new Date().toISOString() },
  };
}
