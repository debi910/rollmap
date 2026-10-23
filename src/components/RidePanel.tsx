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
  below: ['Below the ISO 2631 health caution zone', 'good'],
  caution: ['In the ISO 2631 health caution zone if ridden for 8 h a day', 'warn'],
  'likely-risk': ['Above the caution zone: health risk likely with daily exposure', 'bad'],
} as const;

export function RidePanel(p: Props) {
  const l = p.live;
  if (p.riding && l) {
    const w = l.last;
    return (
      <div className="stack">
        {l.simulated && <div className="badge-sim">Simulated ride</div>}
        {l.error && <div className="alert">{l.error}</div>}
        <div className="live">
          <Gauge score={w?.score ?? null} aw={w?.aw ?? null} />
          <div className="live-side">
            <div className="surface-chip">
              <span className="muted small">Surface</span>
              <strong>{w ? SURFACE_LABELS[w.surface as Surface] ?? w.surface : '—'}</strong>
              {w && <span className="muted small">{Math.round(w.surfaceConfidence * 100)}% sure</span>}
            </div>
            {w?.jolt && <div className="jolt-flash">Jolt! {(w.peak / 9.81).toFixed(1)} g</div>}
          </div>
        </div>
        <Waveform trace={l.trace} />
        <div className="stats">
          <Stat label="Time" value={time(l.elapsedMs)} />
          <Stat label="Distance" value={`${Math.round(l.distanceM)} m`} />
          <Stat label="Jolts" value={String(l.jolts)} />
          <Stat label="Tilt" value={w ? `${w.tilt.toFixed(1)}°` : '—'} hint="Sustained tilt over 3° is flagged as steep" />
          <Stat label="Sensor" value={`${Math.round(l.sampleHz)} Hz`} />
          <Stat label="GPS" value={l.gpsAccuracy == null ? '—' : `±${Math.round(l.gpsAccuracy)} m`} />
        </div>
        {!l.simulated && <TeachMode label={p.label} setLabel={p.setLabel} />}
        <button className="btn btn-big btn-stop" onClick={p.onStop}>
          Stop ride
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      {p.lastRide && <Summary ride={p.lastRide} onReports={p.onReports} />}
      <div>
        <h2>Record a ride</h2>
        <p className="muted">
          Put your phone in the wheelchair's bag or seat pocket, any way up, and roll. RollMap reads the vibration and slope, scores every street, and spots curbs and potholes.
        </p>
      </div>
      <button className="btn btn-big btn-go" onClick={p.onStart}>
        Start ride
      </button>
      <p className="muted small">Keep the screen on while riding. Phones pause sensors when they sleep. Data stays on this phone.</p>
      <TeachMode label={p.label} setLabel={p.setLabel} />
      <div className="card">
        <strong>No phone or wheelchair handy?</strong>
        <p className="muted small">Run a simulated ride along the route from the Route tab.</p>
        <div className="row">
          <button className="btn" disabled={!p.canSimulate} onClick={() => p.onSimulate(10)}>
            Simulate ride ×10
          </button>
        </div>
      </div>
    </div>
  );
}

function TeachMode({ label, setLabel }: { label: string; setLabel: (l: string) => void }) {
  return (
    <label className="field">
      <span>Teach RollMap (optional): I'm rolling on</span>
      <select value={label} onChange={(e) => setLabel(e.target.value)}>
        <option value="">Don't label</option>
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
        {ride.simulated && <span className="badge-sim">Simulated</span>}
      </div>
      <div className="stats">
        <Stat label="Comfort" value={`${ride.score}/100`} />
        <Stat label="Distance" value={`${ride.distanceM} m`} />
        <Stat label="aw (ISO)" value={`${ride.aw.toFixed(2)} m/s²`} hint="Frequency-weighted RMS acceleration, ISO 2631-1" />
        <Stat label="VDV" value={ride.vdv.toFixed(1)} hint="Vibration dose value, m/s^1.75" />
      </div>
      <div className={`zone ${cls}`}>{text}</div>
      <p className="small">
        Found {counts.jolt ?? 0} jolts, {counts.rough ?? 0} rough stretches, {counts.steep ?? 0} steep sections.
      </p>
      {ride.issues.length > 0 && (
        <button className="btn btn-go" onClick={onReports}>
          Review & report to the city
        </button>
      )}
    </div>
  );
}
