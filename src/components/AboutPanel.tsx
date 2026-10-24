import type { MlpModel } from '../ml/mlp';

const STEPS: [string, string][] = [
  ['Sense', "The phone's accelerometer reads vibration 60+ times a second. Gravity tells us which way is down, so the phone can sit in a bag any way up."],
  ['Score like a doctor would', "Vibration is weighted with ISO 2631-1's Wk curve, the international standard for how the seated body feels shaking. You get a 0–100 comfort score and a daily vibration dose."],
  ['Recognise the ground', 'A small neural network on the phone (15 signal features → 32 → 4) tells smooth pavement, cracked concrete, bricks and gravel apart. A shock detector catches curbs and potholes.'],
  ['Map it', 'Readings snap to OpenStreetMap street segments and combine across riders into a shared comfort layer.'],
  ['Route and report', 'Routing avoids steps, steep slopes and rough segments for your chair or stroller. Every problem becomes a city repair report as text, GeoJSON or Open311.'],
];

export function AboutPanel({ model, seedRides }: { model: MlpModel; seedRides: number }) {
  return (
    <div className="stack prose">
      <div>
        <h2>How RollMap works</h2>
        <p className="muted">Map apps rate routes by distance. RollMap measures what a wheelchair rider actually feels.</p>
      </div>
      <ol className="steps">
        {STEPS.map(([t, d], i) => (
          <li key={t} style={{ ['--d' as string]: `${i * 40}ms` }}>
            <span className="step-n">{i + 1}</span>
            <div>
              <strong>{t}</strong>
              <p>{d}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="card">
        <strong>Why it's new</strong>
        <p className="muted small">
          Project Sidewalk judges sidewalks from photos. The MyPath research prototype (2022) showed that phone vibration can classify surfaces, but it never shipped. RollMap runs in any phone browser with no install, scores comfort with a medical standard, and is useful from the very first ride.
        </p>
      </div>

      <div className="card">
        <strong>Honest status</strong>
        <ul className="small muted">
          <li>
            The classifier was trained on {model.trainedOn.synthetic.toLocaleString()} windows from a physics-based simulator and {model.trainedOn.real} real labelled windows. Accuracy on held-out simulated rides: {Math.round((model.metrics?.heldOutSyntheticAccuracy ?? 0) * 100)}% per 1.3 s window, about 89% per street segment.
          </li>
          <li>
            Checked on real public phone rides: on 4 bicycle rides in Guwahati the score picked out the road that photos show is failing as the worst of 6, in every ride, and all 15 photographed defects had a jolt nearby. On 6 labelled car drives, vibration peaks separate real potholes from other bumps with AUC 0.87.
          </li>
          <li>The Monaco comfort layer comes from {seedRides} simulated rides run through the same pipeline. Streets, steps, lifts and buildings are real OpenStreetMap data.</li>
          <li>Live sensing, ISO scoring, jolt and slope detection, routing and reports work on real phones today.</li>
        </ul>
      </div>
      <p className="fineprint">Map data © OpenStreetMap contributors (ODbL), via the GraphHopper project's Monaco extract.</p>
    </div>
  );
}
