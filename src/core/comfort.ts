// Turning vibration numbers into something a rider and a city engineer both understand.
// Thresholds come from ISO 2631-1:1997 Annex C (comfort) and Annex B (health guidance).

export interface ComfortBand {
  max: number; // upper bound of weighted RMS, m/s²
  label: string;
  color: string;
}

export const COMFORT_BANDS: ComfortBand[] = [
  { max: 0.315, label: 'Smooth', color: '#1a9850' },
  { max: 0.63, label: 'A little uncomfortable', color: '#91cf60' },
  { max: 1.0, label: 'Fairly uncomfortable', color: '#fee08b' },
  { max: 1.6, label: 'Uncomfortable', color: '#fc8d59' },
  { max: 2.5, label: 'Very uncomfortable', color: '#e34a33' },
  { max: Infinity, label: 'Extremely uncomfortable', color: '#b30000' },
];

export function comfortBand(aw: number): ComfortBand {
  return COMFORT_BANDS.find((b) => aw < b.max) ?? COMFORT_BANDS[COMFORT_BANDS.length - 1];
}

const BEST = 0.2;
const WORST = 2.5;

/** 100 = glass smooth, 0 = extremely uncomfortable. Log scale, like how people perceive vibration. */
export function comfortScore(aw: number): number {
  if (aw <= BEST) return 100;
  if (aw >= WORST) return 0;
  return Math.round(100 * (1 - Math.log(aw / BEST) / Math.log(WORST / BEST)));
}

export function scoreColor(score: number): string {
  // Map the score back onto the ISO band colours so the map, gauge and reports agree.
  const aw = BEST * Math.pow(WORST / BEST, 1 - score / 100);
  return comfortBand(aw).color;
}

// A jolt is a single shock (curb drop, pothole, raised slab) rather than continuous roughness.
export const JOLT_PEAK = 8; // m/s² above gravity (~0.8 g)
export const JOLT_CREST = 3.8;

// Continuous rough ground has high peaks but a low crest factor; a jolt stands out from its window.
export function isJolt(peak: number, crest: number): boolean {
  return peak >= JOLT_PEAK && (crest >= JOLT_CREST || peak >= 2 * JOLT_PEAK);
}

// Sidewalk slope limits (US ADA guidance): 5% running slope (~2.9°), 2% cross slope (~1.1°).
// A phone in a bag can't tell running from cross slope, so we flag sustained tilt over 3°.
export const STEEP_TILT_DEG = 3;

export interface ExposureSummary {
  aw: number; // energy-averaged weighted RMS over the ride
  vdv: number; // vibration dose value, m/s^1.75
  a8: number; // aw scaled to an 8-hour day of the same riding
  healthZone: 'below' | 'caution' | 'likely-risk';
}

/** ISO 2631-1 Annex B health guidance caution zone for daily exposure. */
export function exposure(windows: { aw: number; vdvRate: number; seconds: number }[]): ExposureSummary {
  let energy = 0;
  let dose = 0;
  let total = 0;
  for (const w of windows) {
    energy += w.aw * w.aw * w.seconds;
    dose += w.vdvRate * w.seconds;
    total += w.seconds;
  }
  const aw = total > 0 ? Math.sqrt(energy / total) : 0;
  const a8 = aw * Math.sqrt(Math.min(total, 8 * 3600) / (8 * 3600));
  // Projected to a full riding day, so the guidance zone is meaningful for daily wheelchair users.
  const healthZone = aw < 0.45 ? 'below' : aw < 0.9 ? 'caution' : 'likely-risk';
  return { aw, vdv: Math.pow(dose, 0.25), a8, healthZone };
}
