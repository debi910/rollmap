import clsx from 'clsx';
import { Activity, Play, Smartphone, Square } from 'lucide-react';
import type { LiveState } from '../ride/session';
import type { RideRecord } from '../store';
import { SURFACE_LABELS, SURFACES, type Surface } from '../core/synth';
import { Gauge, Stat, Waveform } from './Widgets';

interface Props {
  live: LiveState | null;
  riding: boolean;
  lastRide: RideRecord | null;
  label: string;
  setLabel: (l: string) => void;
  onStart: () => void;
  onSimulate: (speedup: number) => void;
  onStop: () => void;
  onReports: () => void;
  canSimulate: boolean;
}

const time = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const ZONES = {
  below: ['Below the ISO 2631 health caution zone', 'is-good'],
  caution: ['In the ISO 2631 health caution zone if ridden 8 h a day', 'is-warn'],
  'likely-risk': ['Above the caution zone: health risk likely with daily exposure', 'is-bad'],
} as const;

export function RidePanel(p: Props) {
  const l = p.live;
  if (p.riding && l) {
    const w = l.last;
    return (
      <div className="stack">
        <div className="row between">
          <span className="rec">
            <span className="live-dot" /> {l.simulated ? 'Simulated ride' : 'Recording'}
          </span>
          <span className="mono muted">{time(l.elapsedMs)}</span>
        </div>
        {l.error && <div className="note is-bad">{l.error}</div>}
        <div className="live">
          <Gauge score={w?.score ?? null} aw={w?.aw ?? null} />
          <div className="live-side">
            <div className="surface">
              <span className="eyebrow">Surface</span>
              <strong>{w ? (SURFACE_LABELS[w.surface as Surface] ?? w.surface) : '–'}</strong>
              <span className="conf" aria-hidden>
                <span style={{ transform: `scaleX(${w?.surfaceConfidence ?? 0})` }} />
              </span>
              <span className="muted xs">{w ? `${Math.round(w.surfaceConfidence * 100)}% confident` : 'Listening…'}</span>
            </div>
            <div className={clsx('jolt', w?.jolt && 'is-on')} aria-live="polite">
              {w?.jolt ? `Jolt · ${(w.peak / 9.81).toFixed(1)} g` : `${l.jolts} jolt${l.jolts === 1 ? '' : 's'} so far`}
            </div>
          </div>
        </div>
        <div className="card tight">
          <div className="eyebrow row between">
            <span>
              <Activity size={12} /> Vertical vibration
            </span>
            <span>±8 m/s²</span>
          </div>
          <Waveform trace={l.trace} />
        </div>
        <div className="stats">
          <Stat label="Distance" value={Math.round(l.distanceM)} unit="m" />
          <Stat label="Tilt" value={w ? w.tilt : null} unit="°" decimals={1} hint="Sustained tilt over 3° is flagged as steep" />
          <Stat label="Sensor" value={Math.round(l.sampleHz)} unit="Hz" />
        </div>
        {!l.simulated && <TeachMode label={p.label} setLabel={p.setLabel} />}
        <button className="btn btn-danger btn-lg" onClick={p.onStop}>
          <Square size={14} fill="currentColor" /> Stop ride
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      {p.lastRide && <Summary ride={p.lastRide} onReports={p.onReports} />}
      <div className="hero">
        <span className="hero-icon">
          <Smartphone size={22} />
        </span>
        <h2>Record a ride</h2>
        <p className="muted">Put your phone in the wheelchair bag, any way up, and roll. RollMap reads vibration and slope, scores every street, and catches curbs and potholes.</p>
      </div>
      <button className="btn btn-primary btn-lg" onClick={p.onStart}>
        Start ride
      </button>
      <button className="btn btn-lg" disabled={!p.canSimulate} onClick={() => p.onSimulate(25)}>
        <Play size={15} fill="currentColor" /> Simulate a ride
      </button>
      <TeachMode label={p.label} setLabel={p.setLabel} />
      <p className="fineprint">Keep the screen on while riding; phones pause sensors when asleep. Your data stays on this phone.</p>
    </div>
  );
}

function TeachMode({ label, setLabel }: { label: string; setLabel: (l: string) => void }) {
  return (
    <label className="field">
      <span>Teach RollMap · I'm rolling on</span>
      <select value={label} onChange={(e) => setLabel(e.target.value)}>
        <option value="">Don't label this ride</option>
        {SURFACES.map((s) => (
          <option key={s} value={s}>
            {SURFACE_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Summary({ ride, onReports }: { ride: RideRecord; onReports: () => void }) {
  const [text, cls] = ZONES[ride.healthZone];
  const counts = ride.issues.reduce<Record<string, number>>((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {});
  return (
    <div className="card summary">
      <div className="row between">
        <strong>Ride summary</strong>
        {ride.simulated && <span className="badge is-amber">Simulated</span>}
      </div>
      <div className="stats">
        <Stat label="Comfort" value={ride.score} unit="/100" />
        <Stat label="Distance" value={ride.distanceM} unit="m" />
        <Stat label="Jolts" value={counts.jolt ?? 0} />
        <Stat label="aw · ISO 2631" value={ride.aw} unit="m/s²" decimals={2} hint="Frequency-weighted RMS acceleration" />
        <Stat label="Vibration dose" value={ride.vdv} decimals={1} hint="VDV, m/s^1.75" />
        <Stat label="Rough stretches" value={counts.rough ?? 0} />
      </div>
      <div className={clsx('note', cls)}>{text}</div>
      {ride.issues.length > 0 && (
        <button className="btn btn-primary" onClick={onReports}>
          Review {ride.issues.length} repair report{ride.issues.length > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
