// ISO 2631-1:1997 frequency weighting Wk (vertical whole-body vibration, seated).
// The standard defines Wk as a product of four transfer functions; we evaluate its
// magnitude at a given frequency and apply it in the frequency domain.

const TAU = 2 * Math.PI;

const F1 = 0.4; // high-pass band limit
const F2 = 100; // low-pass band limit
const Q12 = 1 / Math.SQRT2;
const F3 = 12.5; // acceleration-velocity transition
const F4 = 12.5;
const Q4 = 0.63;
const F5 = 2.37; // upward step
const Q5 = 0.91;
const F6 = 3.35;
const Q6 = 0.91;

type C = [number, number];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const abs = (a: C) => Math.hypot(a[0], a[1]);

export function wkMagnitude(f: number): number {
  if (f <= 0) return 0;
  const w = TAU * f;
  const s: C = [0, w];
  const s2: C = [-w * w, 0];
  const w1 = TAU * F1;
  const w2 = TAU * F2;
  const w3 = TAU * F3;
  const w4 = TAU * F4;
  const w5 = TAU * F5;
  const w6 = TAU * F6;

  const hh = div(s2, [s2[0] + w1 * w1, s[1] * (w1 / Q12)]);
  const hl = div([w2 * w2, 0], [s2[0] + w2 * w2, s[1] * (w2 / Q12)]);
  const ht = div([1, w / w3], [1 - (w * w) / (w4 * w4), w / (Q4 * w4)]);
  const hs = div([s2[0] + w5 * w5, s[1] * (w5 / Q5)], [s2[0] + w6 * w6, s[1] * (w6 / Q6)]);
  return abs(mul(mul(hh, hl), mul(ht, hs)));
}
