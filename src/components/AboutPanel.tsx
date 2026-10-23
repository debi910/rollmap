import type { MlpModel } from '../ml/mlp';

export function AboutPanel({ model, seedRides }: { model: MlpModel; seedRides: number }) {
  return (
    <div className="stack prose">
      <h2>How RollMap works</h2>
      <ol>
        <li>
          <strong>Sense.</strong> The phone's accelerometer reads vibration about 60 times a second. Gravity tells us which way is down, so the phone can sit in a bag any way up.
        </li>
        <li>
          <strong>Score like a doctor would.</strong> Vibration is weighted with ISO 2631-1's W<sub>k</sub> curve, the international standard for how the seated human body feels shaking. The result is a 0–100 comfort score and a daily vibration dose (VDV).
        </li>
        <li>
          <strong>Recognise the ground.</strong> A small neural network (15 signal features → 32 → 4) running on the phone tells smooth pavement, cracked concrete, bricks and gravel apart. It also flags single jolts like curbs and potholes.
        </li>
        <li>
          <strong>Map it.</strong> Readings snap to OpenStreetMap street segments and combine across riders into a shared comfort layer.
        </li>
        <li>
          <strong>Route and report.</strong> Routing avoids steps, steep slopes and rough segments, tuned to your wheelchair or stroller. Every problem becomes a city repair report (text, GeoJSON or Open311).
        </li>
      </ol>

      <h3>Why it matters</h3>
      <p>
        Mapping apps rate routes by distance. Wheelchair users find broken sidewalks and missing curb ramps only when they're already stuck on them. Research projects like UW's Project Sidewalk judge sidewalks from photos. MyPath (2022) showed phone vibration can classify surfaces, but it never shipped. RollMap measures what the rider actually feels, works in a browser with no install, and is useful from the very first ride.
      </p>

      <h3>Honest status (hackathon build)</h3>
      <ul>
        <li>
          The classifier was trained on {model.trainedOn.synthetic.toLocaleString()} windows from a physics-based simulator (wheel-surface excitation through a seat resonance) and {model.trainedOn.real} real labelled windows. Held-out simulated accuracy: {Math.round((model.metrics?.heldOutSyntheticAccuracy ?? 0) * 100)}% per 1.3 s window, about 89% per street segment. Real-world accuracy still needs field data; "Teach RollMap" collects it.
        </li>
        <li>The Monaco community layer comes from {seedRides} simulated rides run through the same pipeline. Streets, steps and lifts are real OpenStreetMap data.</li>
        <li>Comfort scoring (ISO 2631 W<sub>k</sub>), jolt detection, routing and reports work on real sensor data today.</li>
      </ul>
      <p className="muted small">Map data © OpenStreetMap contributors (ODbL). Monaco extract via the GraphHopper project.</p>
    </div>
  );
}
