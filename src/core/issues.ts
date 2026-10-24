// Turns a ride's windows into concrete, reportable problems.

import { STEEP_TILT_DEG } from './comfort';
import { haversine, type WindowResult } from './analyzer';
import type { BarrierKind, Issue } from '../store';

const ROUGH_SCORE = 50; // ISO 'fairly uncomfortable' and worse

export function detectIssues(rideId: string, windows: WindowResult[], simulated: boolean, streetAt: (lat: number, lon: number) => string | undefined): Issue[] {
  const issues: Issue[] = [];
  const located = windows.filter((w) => w.lat != null && w.lon != null);

  // Jolts: merge hits within 8 m (one curb can register on two overlapping windows).
  for (const w of located) {
    if (!w.jolt) continue;
    const near = issues.find((i) => i.kind === 'jolt' && haversine(i.lat, i.lon, w.lat!, w.lon!) < 8);
    if (near) {
      near.peakG = Math.max(near.peakG ?? 0, w.peak / 9.81);
      continue;
    }
    issues.push({
      id: `${rideId}-j${issues.length}`,
      kind: 'jolt',
      lat: w.lat!,
      lon: w.lon!,
      t: w.t,
      peakG: w.peak / 9.81,
      street: streetAt(w.lat!, w.lon!),
      rideId,
      simulated,
    });
  }

  // Rough stretches: runs of windows below the score threshold covering at least 10 m.
  const runs = (pred: (w: WindowResult) => boolean, kind: 'rough' | 'steep') => {
    let run: WindowResult[] = [];
    const flush = () => {
      if (run.length >= 3) {
        let len = 0;
        for (let i = 1; i < run.length; i++) len += haversine(run[i - 1].lat!, run[i - 1].lon!, run[i].lat!, run[i].lon!);
        if (len >= 10) {
          const mid = run[Math.floor(run.length / 2)];
          issues.push({
            id: `${rideId}-${kind[0]}${issues.length}`,
            kind,
            lat: mid.lat!,
            lon: mid.lon!,
            t: mid.t,
            score: Math.round(run.reduce((s, w) => s + w.score, 0) / run.length),
            tilt: Math.max(...run.map((w) => w.tilt)),
            lengthM: Math.round(len),
            street: streetAt(mid.lat!, mid.lon!),
            rideId,
            simulated,
          });
        }
      }
      run = [];
    };
    for (const w of located) {
      if (pred(w)) run.push(w);
      else flush();
    }
    flush();
  };
  runs((w) => w.score < ROUGH_SCORE, 'rough');
  runs((w) => w.tilt > STEEP_TILT_DEG, 'steep');
  return issues;
}

export const BARRIER_LABELS: Record<BarrierKind, { title: string; hint: string }> = {
  blocked: { title: 'Sidewalk blocked', hint: 'Construction, parked car, scooters, bins' },
  no_ramp: { title: 'Curb with no ramp', hint: 'A crossing you can’t get down or up' },
  lift: { title: 'Lift out of service', hint: 'Public lift or elevator not working' },
  hazard: { title: 'Other hazard', hint: 'Broken slab, hole, slippery, too narrow' },
};

export function issueTitle(i: Issue): string {
  if (i.kind === 'barrier') return BARRIER_LABELS[i.barrier ?? 'hazard'].title;
  if (i.kind === 'jolt') return (i.peakG ?? 0) > 2 ? 'Severe jolt: curb without ramp or pothole' : 'Jolt: raised slab, crack or curb edge';
  if (i.kind === 'steep') return 'Steep slope for wheelchairs';
  return 'Rough, broken surface';
}

export function issueSeverity(i: Issue): 'high' | 'medium' | 'low' {
  if (i.kind === 'barrier') return i.barrier === 'hazard' ? 'medium' : 'high';
  if (i.kind === 'jolt') return (i.peakG ?? 0) > 2 ? 'high' : 'medium';
  if (i.kind === 'steep') return (i.tilt ?? 0) > 6 ? 'high' : 'medium';
  return (i.score ?? 100) < 15 ? 'high' : 'medium';
}

export function reportText(i: Issue): string {
  const when = new Date(i.t).toLocaleString();
  const lines = [
    `Sidewalk accessibility issue: ${issueTitle(i)}`,
    '',
    `Location: ${i.lat.toFixed(6)}, ${i.lon.toFixed(6)}${i.street ? ` (${i.street})` : ''}`,
    `Map: https://www.openstreetmap.org/?mlat=${i.lat.toFixed(6)}&mlon=${i.lon.toFixed(6)}#map=19/${i.lat.toFixed(6)}/${i.lon.toFixed(6)}`,
    `Recorded: ${when}`,
    `Severity: ${issueSeverity(i)}`,
  ];
  if (i.kind === 'barrier') lines.push(`Reported by a wheelchair user on site: ${BARRIER_LABELS[i.barrier ?? 'hazard'].hint.toLowerCase()}.`);
  if (i.kind === 'jolt') lines.push(`Measured shock: ${(i.peakG ?? 0).toFixed(1)} g vertical acceleration at the wheelchair.`);
  if (i.kind === 'rough') {
    lines.push(`Comfort score: ${i.score}/100 over ${i.lengthM} m (ISO 2631-1 weighted vibration; under 50 is uncomfortable).`);
  }
  if (i.kind === 'steep') lines.push(`Sustained tilt of ${(i.tilt ?? 0).toFixed(1)}° over ${i.lengthM} m (ADA guidance: 2.9° running, 1.1° cross slope).`);
  lines.push(
    '',
    i.kind === 'barrier'
      ? 'Reported through RollMap. Please clear or repair so wheelchair users can pass safely.'
      : 'Measured automatically by RollMap from a phone carried on a wheelchair. Please inspect and repair so wheelchair users can pass safely.',
  );
  if (i.simulated) lines.push('', '[DEMO: this report was generated from a simulated ride.]');
  return lines.join('\n');
}

/** GeoJSON FeatureCollection, the format city GIS teams and OpenStreetMap tools import. */
export function issuesGeoJson(issues: Issue[]) {
  return {
    type: 'FeatureCollection',
    features: issues.map((i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
      properties: { id: i.id, kind: i.kind, barrier: i.barrier, title: issueTitle(i), severity: issueSeverity(i), recorded: new Date(i.t).toISOString(), peakG: i.peakG, comfortScore: i.score, tiltDeg: i.tilt, lengthM: i.lengthM, street: i.street, simulated: i.simulated },
    })),
  };
}

/** Open311 GeoReport v2 service request body, the API many city 311 systems accept. */
export function open311Request(i: Issue) {
  return {
    service_code: 'SIDEWALK_REPAIR',
    lat: i.lat,
    long: i.lon,
    address_string: i.street,
    description: reportText(i),
    attribute: { severity: issueSeverity(i), source: 'RollMap' },
  };
}
