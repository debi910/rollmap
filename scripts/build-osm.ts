// Converts an OpenStreetMap XML extract into the compact street graph the app routes on.
//
//   npx tsx scripts/build-osm.ts data/monaco.osm.gz public/data/monaco.json
//
// The bundled demo area is Monaco: hilly, full of steps, public lifts and old-town paving,
// which makes it a hard, honest test for wheelchair routing. Elsewhere the app fetches the
// same tags live from the Overpass API.

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseOsmXml, compactGraph } from '../src/geo/osm';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: build-osm.ts <extract.osm[.gz]> <out.json>');
  process.exit(1);
}
const raw = readFileSync(input);
const xml = (input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
const graph = compactGraph(parseOsmXml(xml));
writeFileSync(output, JSON.stringify(graph));
console.log(`${graph.ways.length} ways, ${graph.nodes.length} nodes -> ${output}`);
