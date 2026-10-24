import clsx from 'clsx';
import { Accessibility, Baby, BatteryCharging, Footprints, Play, Sparkles } from 'lucide-react';
import { PROFILES, type ProfileId, type RouteResult } from '../geo/router';
import { scoreColor } from '../core/comfort';

interface Props {
  profile: ProfileId;
  setProfile: (p: ProfileId) => void;
  smooth: RouteResult | null;
  short: RouteResult | null;
  error: string | null;
  loading: boolean;
  fromName: string | null;
  toName: string | null;
  picking: 'from' | 'to' | null;
  setPicking: (p: 'from' | 'to' | null) => void;
  onDemo: () => void;
  onSimulate: (speedup: number) => void;
  seedRides: number;
  mySegments: number;
  riding: boolean;
}

const dist = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} km` : `${Math.round(x)} m`);
const mins = (x: number) => `${Math.max(1, Math.round(x / 0.9 / 60))} min`;

const PROFILE_ICONS: Record<string, typeof Accessibility> = { manual: Accessibility, power: BatteryCharging, stroller: Baby };
const PROFILE_SHORT: Record<string, string> = { manual: 'Manual chair', power: 'Power chair', stroller: 'Stroller' };

export function RoutePanel(p: Props) {
  return (
    <div className="stack">
      <div className="waypoints">
        <button className={clsx('waypoint', p.picking === 'from' && 'is-picking')} onClick={() => p.setPicking(p.picking === 'from' ? null : 'from')}>
          <span className="wp-dot is-a">A</span>
          <span className="wp-text">
            <span className="wp-label">From</span>
            <span className="wp-name">{p.picking === 'from' ? 'Tap the map…' : (p.fromName ?? 'Choose start')}</span>
          </span>
        </button>
        <span className="wp-line" aria-hidden />
        <button className={clsx('waypoint', p.picking === 'to' && 'is-picking')} onClick={() => p.setPicking(p.picking === 'to' ? null : 'to')}>
          <span className="wp-dot is-b">B</span>
          <span className="wp-text">
            <span className="wp-label">To</span>
            <span className="wp-name">{p.picking === 'to' ? 'Tap the map…' : (p.toName ?? 'Choose destination')}</span>
          </span>
        </button>
        <button className="btn btn-ghost btn-xs wp-demo" onClick={p.onDemo}>
          <Sparkles size={14} /> Demo route
        </button>
      </div>

      <div className="chips" role="radiogroup" aria-label="Mobility profile">
        {(['manual', 'power', 'stroller'] as ProfileId[]).map((id) => {
          const Icon = PROFILE_ICONS[id];
          return (
            <button key={id} role="radio" aria-checked={p.profile === id} className={clsx('chip', p.profile === id && 'is-on')} onClick={() => p.setProfile(id)} title={PROFILES[id].label}>
              <Icon size={16} strokeWidth={2} />
              {PROFILE_SHORT[id]}
            </button>
          );
        })}
      </div>

      {p.error && <div className="note is-bad">{p.error}</div>}
      {p.loading && <div className="skeleton" style={{ height: 196 }} />}

      {p.smooth && p.short && (
        <div className="options">
          <RouteCard route={p.smooth} kind="smooth" />
          <RouteCard route={p.short} kind="short" />
          <p className="verdict">{verdict(p.short, p.smooth)}</p>
        </div>
      )}

      {p.smooth && (
        <div className="callout">
          <div className="callout-text">
            <strong>Watch it measure a ride</strong>
            <span>Plays a simulated sensor stream along this route through the same analysis the phone runs.</span>
          </div>
          <button className="btn btn-primary" disabled={p.riding} onClick={() => p.onSimulate(25)}>
            <Play size={16} fill="currentColor" /> Simulate
          </button>
        </div>
      )}

      <p className="fineprint">
        Comfort layer: {p.seedRides} simulated demo rides{p.mySegments ? ` + ${p.mySegments} segments you measured` : ''}. Streets, steps and lifts: OpenStreetMap.
      </p>
    </div>
  );
}

function RouteCard({ route, kind }: { route: RouteResult; kind: 'smooth' | 'short' }) {
  const s = route.stats;
  const smooth = kind === 'smooth';
  return (
    <div className={clsx('route-card', smooth ? 'is-smooth' : 'is-short')}>
      <div className="rc-top">
        <div>
          <div className="rc-title">
            {smooth ? <Accessibility size={16} /> : <Footprints size={16} />}
            {smooth ? 'RollMap route' : 'Shortest walk'}
            {smooth && <span className="badge">Recommended</span>}
          </div>
          <div className="rc-meta">
            {dist(route.length)} · {mins(route.length)}
          </div>
        </div>
        <div className="rc-score" style={{ ['--c' as string]: scoreColor(s.comfort) }}>
          <span className="rc-score-num">{s.comfort}</span>
          <span className="rc-score-l">comfort</span>
        </div>
      </div>
      <div className="rc-facts">
        <Fact bad={s.steps > 0} text={s.steps ? `${s.steps} flight${s.steps > 1 ? 's' : ''} of steps` : 'No steps'} />
        <Fact bad={s.roughMetres > 150} text={`${Math.round(s.roughMetres)} m rough`} />
        <Fact bad={s.jolts > 2} text={`${s.jolts} jolt${s.jolts === 1 ? '' : 's'}`} />
      </div>
    </div>
  );
}

function Fact({ bad, text }: { bad: boolean; text: string }) {
  return <span className={clsx('fact', bad ? 'is-bad' : 'is-good')}>{text}</span>;
}

function verdict(short: RouteResult, smooth: RouteResult): string {
  const extra = smooth.length - short.length;
  const parts: string[] = [];
  const stepDiff = short.stats.steps - smooth.stats.steps;
  if (stepDiff > 0) parts.push(`skips ${stepDiff} flight${stepDiff > 1 ? 's' : ''} of steps`);
  const roughSaved = short.stats.roughMetres - smooth.stats.roughMetres;
  if (roughSaved > 20) parts.push(`avoids ${Math.round(roughSaved)} m of rough ground`);
  if (!parts.length) return 'Here the shortest route is also the smoothest.';
  return `RollMap ${parts.join(' and ')}${extra > 10 ? `, for ${Math.round(extra)} m more` : ''}.`;
}

