import { useState } from 'react';
import clsx from 'clsx';
import { ArrowDownToDot, ArrowUpFromDot, Construction, Flag, X } from 'lucide-react';
import { scoreColor } from '../core/comfort';
import { BARRIER_LABELS } from '../core/issues';
import { SURFACE_LABELS, type Surface } from '../core/synth';
import type { BarrierKind, Issue } from '../store';

export interface StreetInfo {
  edge: number;
  lat: number;
  lon: number;
  name: string;
  kind: string; // footway, residential, steps...
  osmSurface?: string;
  incline?: string;
  steps: boolean;
  score: number;
  measuredRides: number;
  lastSeen: number | null;
  joltsPerPass: number;
  surface: string | null; // what riders' phones heard
  demo: boolean; // measured only by the simulated demo rides
  barrier: Issue | null;
}

const KIND: Record<string, string> = {
  footway: 'Footpath',
  pedestrian: 'Pedestrian street',
  path: 'Path',
  steps: 'Steps',
  living_street: 'Shared street',
  residential: 'Street',
  service: 'Service road',
  primary: 'Main road',
  secondary: 'Main road',
  tertiary: 'Street',
};
const OSM_SURFACE: Record<string, string> = {
  asphalt: 'asphalt',
  paving_stones: 'paving stones',
  sett: 'cobbles (sett)',
  cobblestone: 'cobbles',
  concrete: 'concrete',
  gravel: 'gravel',
};

const ago = (t: number) => {
  const d = Math.round((Date.now() - t) / 86400000);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

interface Props {
  info: StreetInfo;
  onClose: () => void;
  onReport: (kind: BarrierKind) => void;
  onFixed: (id: string) => void;
  onFrom: () => void;
  onTo: () => void;
}

export function StreetCard({ info, onClose, onReport, onFixed, onFrom, onTo }: Props) {
  const [reporting, setReporting] = useState(false);
  const confidence = info.measuredRides >= 5 ? 3 : info.measuredRides >= 2 ? 2 : 1;
  const surfaceTag = info.osmSurface ? (OSM_SURFACE[info.osmSurface] ?? info.osmSurface.replace(/_/g, ' ')) : null;

  return (
    <div className="street-card" role="dialog" aria-label={`About ${info.name}`}>
      <div className="sc-head">
        <span className="sc-score" style={{ ['--c' as string]: info.steps ? 'var(--map-steps)' : scoreColor(info.score) }}>
          {info.steps ? '—' : info.score}
        </span>
        <div className="sc-title">
          <strong>{info.name}</strong>
          <span className="muted xs">
            {KIND[info.kind] ?? 'Street'}
            {surfaceTag && ` · ${surfaceTag}`}
            {info.incline && ` · incline ${info.incline}`}
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      {info.steps ? (
        <p className="sc-line">Steps. Wheelchair and stroller routes never use this.</p>
      ) : info.measuredRides >= 2 ? (
        <p className="sc-line">
          <span className="conf-dots" aria-label={`Confidence ${confidence} of 3`}>
            {[1, 2, 3].map((i) => (
              <i key={i} className={clsx(i <= confidence && 'on')} />
            ))}
          </span>
          Measured on {info.measuredRides} {info.demo ? 'simulated demo ' : ''}ride{info.measuredRides > 1 ? 's' : ''}
          {!info.demo && info.lastSeen ? `, last ${ago(info.lastSeen)}` : ''}.
          {info.surface && ` Feels like ${(SURFACE_LABELS[info.surface as Surface] ?? info.surface).toLowerCase()}.`}
          {info.joltsPerPass >= 0.5 && ` About ${info.joltsPerPass.toFixed(1)} jolts per pass.`}
        </p>
      ) : (
        <p className="sc-line">
          <span className="conf-dots" aria-label="Estimate only">
            <i className="on" />
            <i />
            <i />
          </span>
          Nobody has measured this yet. Score estimated from map data{surfaceTag ? ` (${surfaceTag})` : ''}.
        </p>
      )}

      {info.barrier && (
        <div className="sc-barrier">
          <Construction size={16} />
          <span>
            <strong>{BARRIER_LABELS[info.barrier.barrier ?? 'hazard'].title}</strong>, reported {ago(info.barrier.t)}.
            {info.barrier.barrier !== 'hazard' ? ' Routes avoid this street.' : ' Routes avoid it when they can.'}
          </span>
          <button className="btn btn-xs" onClick={() => onFixed(info.barrier!.id)}>
            It’s fixed
          </button>
        </div>
      )}

      {reporting ? (
        <div className="sc-report">
          <span className="eyebrow">What’s wrong here?</span>
          <div className="sc-options">
            {(Object.keys(BARRIER_LABELS) as BarrierKind[]).map((k) => (
              <button
                key={k}
                className="sc-option"
                onClick={() => {
                  onReport(k);
                  setReporting(false);
                }}
              >
                <strong>{BARRIER_LABELS[k].title}</strong>
                <span>{BARRIER_LABELS[k].hint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="sc-actions">
          <button className="btn btn-sm" onClick={onFrom}>
            <ArrowUpFromDot size={14} /> Start here
          </button>
          <button className="btn btn-sm" onClick={onTo}>
            <ArrowDownToDot size={14} /> Go here
          </button>
          {!info.barrier && (
            <button className="btn btn-sm btn-warn" onClick={() => setReporting(true)}>
              <Flag size={14} /> Report a problem
            </button>
          )}
        </div>
      )}
    </div>
  );
}
