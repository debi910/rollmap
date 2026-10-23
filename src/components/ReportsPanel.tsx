import { useState } from 'react';
import { issueSeverity, issuesGeoJson, issueTitle, open311Request, reportText } from '../core/issues';
import { serializeSegments, type SegmentMap } from '../geo/segments';
import { clearAll, download, loadTraining, type Issue, type RideRecord } from '../store';

interface Props {
  issues: Issue[];
  rides: RideRecord[];
  mySegments: SegmentMap;
  onFocus: (lat: number, lon: number) => void;
  onCleared: () => void;
}

export function ReportsPanel({ issues, rides, mySegments, onFocus, onCleared }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const sorted = [...issues].sort((a, b) => sevRank(b) - sevRank(a) || b.t - a.t);

  const copy = async (i: Issue) => {
    try {
      await navigator.clipboard.writeText(reportText(i));
      setCopied(i.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      download(`rollmap-report-${i.id}.txt`, reportText(i), 'text/plain');
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
        <h2>Repair reports</h2>
        <p className="muted">Nothing yet. After a ride, every curb without a ramp, pothole, broken stretch and steep slope shows up here as a ready-to-send report with location and measured evidence.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h2>Repair reports</h2>
        <p className="muted">
          {issues.length} problems from {rides.length} ride{rides.length > 1 ? 's' : ''}. Each one carries GPS location and the measured shock or vibration, so a city crew knows exactly where to go.
        </p>
      </div>
      <ul className="issues">
        {sorted.map((i) => (
          <li key={i.id} className={`issue sev-${issueSeverity(i)}`}>
            <div className="row between">
              <strong>{issueTitle(i)}</strong>
              <span className={`sev sev-${issueSeverity(i)}`}>{issueSeverity(i)}</span>
            </div>
            <div className="muted small">
              {i.street ?? `${i.lat.toFixed(5)}, ${i.lon.toFixed(5)}`} · {new Date(i.t).toLocaleTimeString()}
              {i.simulated && ' · simulated'}
            </div>
            <div className="small">
              {i.kind === 'jolt' && `Shock ${(i.peakG ?? 0).toFixed(1)} g`}
              {i.kind === 'rough' && `Comfort ${i.score}/100 over ${i.lengthM} m`}
              {i.kind === 'steep' && `Tilt ${(i.tilt ?? 0).toFixed(1)}° over ${i.lengthM} m`}
            </div>
            <div className="row">
              <button className="btn btn-sm" onClick={() => onFocus(i.lat, i.lon)}>
                Show
              </button>
              <button className="btn btn-sm" onClick={() => copy(i)}>
                {copied === i.id ? 'Copied ✓' : 'Copy report'}
              </button>
              <button className="btn btn-sm" onClick={() => share(i)}>
                Send
              </button>
              <button className="btn btn-sm" onClick={() => download(`open311-${i.id}.json`, open311Request(i))} title="Open311 GeoReport v2 request body">
                311 JSON
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="card">
        <strong>Export</strong>
        <div className="row wrap">
          <button className="btn btn-sm" onClick={() => download('rollmap-issues.geojson', issuesGeoJson(issues), 'application/geo+json')}>
            All issues (GeoJSON)
          </button>
          <button className="btn btn-sm" onClick={() => download('rollmap-segments.json', { segments: serializeSegments(mySegments) })}>
            My street scores
          </button>
          <button className="btn btn-sm" onClick={() => download('rollmap-training.json', { windows: loadTraining() })}>
            Labelled training data
          </button>
        </div>
      </div>
      <button
        className="btn btn-sm btn-ghost"
        onClick={() => {
          if (confirm('Delete all rides and reports stored on this device?')) {
            clearAll();
            onCleared();
          }
        }}
      >
        Clear my data
      </button>
    </div>
  );
}

const sevRank = (i: Issue) => ({ high: 2, medium: 1, low: 0 })[issueSeverity(i)];
