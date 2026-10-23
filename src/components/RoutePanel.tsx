import { PROFILES, type ProfileId, type RouteResult } from '../geo/router';
import { scoreColor } from '../core/comfort';

interface Props {
  profile: ProfileId;
  setProfile: (p: ProfileId) => void;
  smooth: RouteResult | null;
  short: RouteResult | null;
  error: string | null;
  picking: 'from' | 'to' | null;
  setPicking: (p: 'from' | 'to' | null) => void;
  onDemo: () => void;
  onSimulate: (speedup: number) => void;
  seedRides: number;
  mySegments: number;
  riding: boolean;
}

const m = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} km` : `${Math.round(x)} m`);
const mins = (x: number) => `${Math.max(1, Math.round(x / 0.9 / 60))} min`;

export function RoutePanel(p: Props) {
  const rows: [string, (r: RouteResult) => string, (r: RouteResult) => boolean][] = [
    ['Distance', (r) => `${m(r.length)} · ${mins(r.length)}`, () => false],
    ['Flights of steps', (r) => String(r.stats.steps), (r) => r.stats.steps > 0],
    ['Rough surface', (r) => m(r.stats.roughMetres), (r) => r.stats.roughMetres > 50],
    ['Measured jolts', (r) => String(r.stats.jolts), (r) => r.stats.jolts > 0],
    ['Comfort', (r) => `${r.stats.comfort}/100`, (r) => r.stats.comfort < 60],
  ];
  return (
    <div className="stack">
      <div>
        <h2>Find the smoothest way</h2>
        <p className="muted">Google Maps knows how far. RollMap knows how it feels: every street is scored by the vibration riders actually measured.</p>
      </div>

      <div className="row">
        <button className={`btn ${p.picking === 'from' ? 'btn-on' : ''}`} onClick={() => p.setPicking(p.picking ? null : 'from')}>
          {p.picking ? 'Cancel' : 'Set A → B on map'}
        </button>
        <button className="btn" onClick={p.onDemo}>
          Demo route
        </button>
      </div>

      <label className="field">
        <span>I'm using</span>
        <select value={p.profile} onChange={(e) => p.setProfile(e.target.value as ProfileId)}>
          {(['manual', 'power', 'stroller'] as ProfileId[]).map((id) => (
            <option key={id} value={id}>
              {PROFILES[id].label}
            </option>
          ))}
        </select>
      </label>

      {p.error && <div className="alert">{p.error}</div>}

      {p.smooth && p.short && (
        <div className="compare" role="table" aria-label="Route comparison">
          <div className="compare-head" role="row">
            <span />
            <span className="c-short">
              <i className="swatch dashed" /> Shortest walk
            </span>
            <span className="c-smooth">
              <i className="swatch solid" /> RollMap
            </span>
          </div>
          {rows.map(([name, fmt, bad]) => (
            <div className="compare-row" role="row" key={name}>
              <span className="muted">{name}</span>
              <span className={bad(p.short!) ? 'bad' : ''}>{fmt(p.short!)}</span>
              <span className={bad(p.smooth!) ? 'bad' : 'good'}>{fmt(p.smooth!)}</span>
            </div>
          ))}
          <div className="compare-foot">
            <span className="score-dot" style={{ background: scoreColor(p.smooth.stats.comfort) }} />
            {verdict(p.short, p.smooth)}
          </div>
        </div>
      )}

      {p.smooth && (
        <div className="card">
          <strong>See it measure a ride</strong>
          <p className="muted small">Plays a simulated sensor stream along this route through the same analysis the phone runs. Marked as simulated everywhere.</p>
          <div className="row">
            {[10, 25].map((x) => (
              <button key={x} className="btn" disabled={p.riding} onClick={() => p.onSimulate(x)}>
                Simulate ride ×{x}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="muted small">
        Community layer: {p.seedRides} simulated demo rides{p.mySegments ? ` + your ${p.mySegments} measured segments` : ''}. Steps, lifts and slopes come from OpenStreetMap.
      </p>
    </div>
  );
}

function verdict(short: RouteResult, smooth: RouteResult): string {
  const extra = smooth.length - short.length;
  const parts: string[] = [];
  if (short.stats.steps > smooth.stats.steps) parts.push(`avoids ${short.stats.steps - smooth.stats.steps} flight${short.stats.steps - smooth.stats.steps > 1 ? 's' : ''} of steps`);
  const roughSaved = short.stats.roughMetres - smooth.stats.roughMetres;
  if (roughSaved > 20) parts.push(`${Math.round(roughSaved)} m less rough ground`);
  if (short.stats.jolts > smooth.stats.jolts) parts.push(`${short.stats.jolts - smooth.stats.jolts} fewer jolts`);
  if (!parts.length) return 'The shortest route is also the smoothest here.';
  return `RollMap ${parts.join(', ')}${extra > 10 ? `, for ${Math.round(extra)} m extra` : ''}.`;
}
