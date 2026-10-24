import { useState } from 'react';
import clsx from 'clsx';
import { Accessibility, Baby, BatteryCharging, ChevronDown, Footprints, MousePointerClick, Play, Share2, Sparkles } from 'lucide-react';
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
  riding: boolean;
  firstVisit: boolean;
  onDismissWelcome: () => void;
  onShare: () => void;
}

const dist = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} km` : `${Math.round(x)} m`);
const mins = (x: number) => `${Math.max(1, Math.round(x / 0.9 / 60))} min`;

const PROFILE_ICONS: Record<string, typeof Accessibility> = { manual: Accessibility, power: BatteryCharging, stroller: Baby };
const PROFILE_SHORT: Record<string, string> = { manual: 'Manual chair', power: 'Power chair', stroller: 'Stroller' };

export function RoutePanel(p: Props) {
  const [compare, setCompare] = useState(false);
  return (
    <div className="stack">
      {p.firstVisit && (
        <div className="welcome">
          <strong>Find the smoothest way on wheels</strong>
          <p>RollMap skips steps and steers around rough, broken sidewalks, using vibration measured by riders’ phones. Below is an example trip in Monaco.</p>
          <button className="btn btn-sm btn-primary" onClick={p.onDismissWelcome}>
            Got it
          </button>
        </div>
      )}

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
          <Sparkles size={14} /> Example
        </button>
      </div>

      <div className="chips" role="radiogroup" aria-label="Getting around by">
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

      {p.smooth && <RouteCard route={p.smooth} kind="smooth" profile={p.profile} />}

      {p.smooth && p.short && (
        <div className={clsx('compare', compare && 'is-open')}>
          <button className="compare-row" onClick={() => setCompare((v) => !v)} aria-expanded={compare}>
            <Footprints size={16} />
            <span>{compareLine(p.short, p.smooth)}</span>
            <ChevronDown size={16} className="chev" />
          </button>
          {compare && <RouteCard route={p.short} kind="short" profile={p.profile} />}
        </div>
      )}

      {p.smooth && (
        <div className="row actions">
          <button className="btn btn-sm" onClick={p.onShare}>
            <Share2 size={14} /> Share route
          </button>
          <button className="btn btn-sm" disabled={p.riding} onClick={() => p.onSimulate(25)}>
            <Play size={14} fill="currentColor" /> Watch a demo ride
          </button>
        </div>
      )}

      <p className="tip">
        <MousePointerClick size={14} /> Tap any street to see how it rides, or to report a blocked sidewalk.
      </p>
    </div>
  );
}

function RouteCard({ route, kind, profile }: { route: RouteResult; kind: 'smooth' | 'short'; profile: ProfileId }) {
  const s = route.stats;
  const smooth = kind === 'smooth';
  return (
    <div className={clsx('route-card', smooth ? 'is-smooth' : 'is-short')}>
      <div className="rc-top">
        <div>
          <div className="rc-title">
            {smooth ? <Accessibility size={16} /> : <Footprints size={16} />}
            {smooth ? `Best for ${PROFILE_SHORT[profile].toLowerCase()}` : 'Shortest walk'}
          </div>
          <div className="rc-meta">
            {dist(route.length)} · {mins(route.length)}
            {smooth && s.steps === 0 && ' · step-free'}
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

function compareLine(short: RouteResult, smooth: RouteResult): string {
  const bad: string[] = [];
  if (short.stats.steps) bad.push(`${short.stats.steps} flight${short.stats.steps > 1 ? 's' : ''} of steps`);
  if (short.stats.roughMetres - smooth.stats.roughMetres > 20) bad.push(`${Math.round(short.stats.roughMetres)} m rough`);
  if (!bad.length) return `The shortest way is about the same (${dist(short.length)})`;
  return `Shortest way is ${dist(short.length)}, but has ${bad.join(' and ')}`;
}
