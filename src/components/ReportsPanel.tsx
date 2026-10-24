import clsx from 'clsx';
import { toast } from 'sonner';
import { Construction, Copy, Crosshair, Download, FileJson, Mountain, Send, Trash2, TriangleAlert, Waves } from 'lucide-react';
import { issueSeverity, issuesGeoJson, issueTitle, open311Request, reportText } from '../core/issues';
import { serializeSegments, type SegmentMap } from '../geo/segments';
import { clearAll, download, loadTraining, type Issue, type RideRecord } from '../store';

interface Props {
  issues: Issue[];
  rides: RideRecord[];
  mySegments: SegmentMap;
  onFocus: (lat: number, lon: number) => void;
  onRemove: (id: string) => void;
  onCleared: () => void;
}

const KIND_ICON = { jolt: TriangleAlert, rough: Waves, steep: Mountain, barrier: Construction };

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function ReportsPanel({ issues, rides, mySegments, onFocus, onRemove, onCleared }: Props) {
  const sorted = [...issues].sort((a, b) => sevRank(b) - sevRank(a) || b.t - a.t);

  const copy = async (i: Issue) => {
    try {
      await navigator.clipboard.writeText(reportText(i));
      toast.success('Report copied', { description: 'Paste it into your city’s 311 form or an email.' });
    } catch {
      download(`rollmap-report-${i.id}.txt`, reportText(i), 'text/plain');
      toast('Report downloaded as text');
    }
  };
  const share = async (i: Issue) => {
    const text = reportText(i);
    if (navigator.share) {
      try {
        await navigator.share({ title: issueTitle(i), text });
        return;
      } catch {
        /* cancelled */
      }
    }
    window.location.href = `mailto:?subject=${encodeURIComponent(`Sidewalk repair request: ${issueTitle(i)}`)}&body=${encodeURIComponent(text)}`;
  };

  if (!issues.length) {
    return (
      <div className="stack">
        <div className="hero">
          <span className="hero-icon">
            <TriangleAlert size={22} />
          </span>
          <h2>No reports yet</h2>
          <p className="muted">Problems land here as ready-to-send repair reports: the ones a ride measures (curb drops, potholes, broken or steep stretches) and the ones you report by tapping a street on the map.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h2>Repair reports</h2>
        <p className="muted">
          {issues.length} problem{issues.length > 1 ? 's' : ''}, each with its exact location{rides.length ? ' and, for measured ones, the shock the chair felt' : ''}, so a crew knows where to go.
        </p>
      </div>
      <ul className="issues">
        {sorted.map((i, idx) => {
          const Icon = KIND_ICON[i.kind];
          const sev = issueSeverity(i);
          return (
            <li key={i.id} className={clsx('issue', `sev-${sev}`)} style={{ ['--d' as string]: `${Math.min(idx, 8) * 40}ms` }}>
              <span className={clsx('issue-icon', `sev-${sev}`, i.kind === 'steep' && 'is-steep')}>
                <Icon size={16} />
              </span>
              <div className="issue-main">
                <div className="issue-title">{issueTitle(i)}</div>
                <div className="issue-meta">
                  {i.street ?? `${i.lat.toFixed(5)}, ${i.lon.toFixed(5)}`}
                  {i.simulated && <span className="badge is-amber">Simulated</span>}
                </div>
                <div className="issue-measure">
                  {i.kind === 'jolt' && `${(i.peakG ?? 0).toFixed(1)} g shock`}
                  {i.kind === 'rough' && `Comfort ${i.score}/100 over ${i.lengthM} m`}
                  {i.kind === 'steep' && `${(i.tilt ?? 0).toFixed(1)}° tilt over ${i.lengthM} m`}
                  {i.kind === 'barrier' && `Reported by you · ${ago(i.t)}`}
                  <span className={clsx('sev', `sev-${sev}`)}>{sev}</span>
                </div>
              </div>
              <div className="issue-actions">
                <button className="icon-btn" onClick={() => onFocus(i.lat, i.lon)} aria-label="Show on map" title="Show on map">
                  <Crosshair size={16} />
                </button>
                <button className="icon-btn" onClick={() => copy(i)} aria-label="Copy report" title="Copy report">
                  <Copy size={16} />
                </button>
                <button className="icon-btn" onClick={() => share(i)} aria-label="Send report" title="Send report">
                  <Send size={16} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => {
                    download(`open311-${i.id}.json`, open311Request(i));
                    toast('Open311 request saved');
                  }}
                  aria-label="Download Open311 request"
                  title="Open311 GeoReport v2 request"
                >
                  <FileJson size={16} />
                </button>
                {i.kind === 'barrier' && (
                  <button className="icon-btn" onClick={() => onRemove(i.id)} aria-label="Mark as fixed" title="Fixed: remove this report">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="card">
        <strong>Export</strong>
        <div className="row wrap">
          <button className="btn btn-sm" onClick={() => download('rollmap-issues.geojson', issuesGeoJson(issues), 'application/geo+json')}>
            <Download size={14} /> Issues · GeoJSON
          </button>
          <button className="btn btn-sm" onClick={() => download('rollmap-segments.json', { segments: serializeSegments(mySegments) })}>
            <Download size={14} /> Street scores
          </button>
          <button className="btn btn-sm" onClick={() => download('rollmap-training.json', { windows: loadTraining() })}>
            <Download size={14} /> Training data
          </button>
        </div>
      </div>
      <button
        className="btn btn-ghost btn-xs"
        onClick={() => {
          if (confirm('Delete all rides and reports stored on this device?')) {
            clearAll();
            onCleared();
            toast('Your rides were deleted from this device');
          }
        }}
      >
        Clear my data
      </button>
    </div>
  );
}

const sevRank = (i: Issue) => ({ high: 2, medium: 1, low: 0 })[issueSeverity(i)];
