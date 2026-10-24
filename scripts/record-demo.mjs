// Records the demo video with Playwright: the real app, driven by script, with captions overlaid.
//
//   npm run dev &   then   node scripts/record-demo.mjs [url] [chromium-path]
//
// Output: demo/rollmap-demo.webm (1280x720)

// PLAYWRIGHT=/path/to/playwright/index.mjs picks a Playwright build that matches an installed browser.
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const executablePath = process.argv[3];
const outDir = join(import.meta.dirname, '..', 'demo');
const tmpDir = join(outDir, 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: tmpDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const t0 = Date.now();

// Voiceover: clips made by scripts/make-voice.py. Each line starts once the previous one has
// finished, and its start time is logged so the audio can be laid onto the video afterwards.
let durations = {};
try {
  durations = JSON.parse(readFileSync(join(outDir, 'voice/durations.json'), 'utf8'));
} catch {
  console.warn('no voice/durations.json: recording without voiceover cues');
}
const cues = [];
let speechEnd = 0;
async function say(id) {
  const d = durations[id];
  if (d == null) return;
  const gap = speechEnd - Date.now();
  if (gap > 0) await page.waitForTimeout(gap);
  cues.push({ id, t: Date.now() - t0 });
  speechEnd = Date.now() + d + 350;
}
const speechLeft = () => Math.max(0, speechEnd - Date.now());
const wait = (ms) => page.waitForTimeout(ms);

async function caption(text, sub = '') {
  await page.evaluate(
    ([t, s]) => {
      let el = document.getElementById('demo-caption');
      if (!el) {
        el = document.createElement('div');
        el.id = 'demo-caption';
        el.style.cssText =
          'position:fixed;left:440px;right:24px;bottom:24px;z-index:99999;background:rgba(9,14,28,.9);backdrop-filter:blur(8px);color:#fff;padding:14px 20px;border-radius:14px;font:600 21px/1.3 Inter Variable,system-ui,sans-serif;letter-spacing:-.01em;box-shadow:0 8px 30px rgba(0,0,0,.3);transition:opacity .3s';
        document.body.appendChild(el);
      }
      el.style.opacity = t ? '1' : '0';
      el.innerHTML = `${t}${s ? `<div style="font-weight:400;font-size:16px;opacity:.85;margin-top:6px">${s}</div>` : ''}`;
    },
    [text, sub],
  );
}

async function card(title, lines, ms) {
  await page.evaluate(
    ([t, l]) => {
      const el = document.createElement('div');
      el.id = 'demo-card';
      el.style.cssText =
        'position:fixed;inset:0;z-index:100000;background:radial-gradient(circle at 20% 10%,#2563eb,#0b1b44 70%);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 110px;font-family:Inter Variable,system-ui,sans-serif';
      el.innerHTML = `<div style="font:750 56px/1.1 Inter Variable,system-ui;letter-spacing:-.03em">${t}</div>${l.map((x) => `<div style="font:400 25px/1.45 Inter Variable,system-ui;margin-top:18px;max-width:1000px;opacity:.95">${x}</div>`).join('')}`;
      document.body.appendChild(el);
    },
    [title, lines],
  );
  await wait(Math.max(ms, speechLeft() + 300));
  await page.evaluate(() => document.getElementById('demo-card')?.remove());
}

async function highlight(selector, ms = 1800) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.style.transition = 'box-shadow .3s';
    el.style.boxShadow = '0 0 0 4px #f59e0b, 0 0 30px rgba(245,158,11,.6)';
  }, selector);
  await wait(ms);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.boxShadow = '';
  }, selector);
}

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.route-card', { timeout: 30000 });
// Keep toasts clear of the caption bar.
await page.addStyleTag({ content: '[data-sonner-toaster]{bottom:130px !important}' });
await wait(1500);

await say('intro');
await card(
  'RollMap',
  [
    'Sidewalks scored by how they feel on wheels.',
    'Map apps tell a wheelchair user how <b>far</b> a route is.<br>Not whether it has broken slabs, cobbles, a curb with no ramp, or steps.',
  ],
  6500,
);

// A first-time visitor sees a one-line welcome before anything else.
await say('monaco');
await caption('Plan a trip in Monaco: hilly, full of steps and old paving', 'Real OpenStreetMap streets, steps and buildings. Coloured lines are the community comfort layer.');
await highlight('.welcome', 3000);
await page.getByRole('button', { name: 'Got it' }).click();
await wait(1200);
await say('smooth');
await caption('RollMap picks a step-free route that is far smoother', 'Cost = distance × measured discomfort, jolts, surface and incline, tuned to your chair.');
await highlight('.route-card.is-smooth', 3600);
await say('short');
await caption('The shortest walk uses 5 flights of steps and 429 m of rough ground', 'Impossible in a wheelchair, and a rough ride with a stroller.');
await page.locator('.compare-row').click();
await highlight('.route-card.is-short', 3200);
await page.locator('.compare-row').click();
await page.getByRole('radio', { name: /Stroller/ }).click();
await say('profiles');
await caption('Profiles weigh roughness differently: manual chair, power chair, stroller');
await wait(2800);
await page.getByRole('radio', { name: /Manual/ }).click();
await wait(800);

// Tap a street on the route, then report it blocked and watch the route move.
const tapAt = async (lat, lon) => {
  const pt = await page.evaluate(([a, b]) => window.__rollmapMap.latLngToContainerPoint([a, b]), [lat, lon]);
  await page.mouse.click(pt.x, pt.y);
};
await say('street');
await caption('Tap any street to see how it rides, and how sure RollMap is', 'Number of rides that measured it, what it feels like, how often it jolts.');
await tapAt(43.736016, 7.419258);
await wait(3500);
await say('barrier');
await caption('Something in the way? Report it in two taps', 'The route goes around it at once, and the report is ready to send to the city.');
await page.getByRole('button', { name: 'Report a problem' }).click();
await wait(1500);
await page.getByRole('button', { name: /Sidewalk blocked/ }).click();
await wait(4000);
await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
await wait(800);

await say('sensing');
await caption('Now the sensing: roll with a phone in the wheelchair bag', 'For this video we play a SIMULATED sensor stream through the exact pipeline the phone runs.');
await wait(3500);
await page.getByRole('button', { name: 'Watch a demo ride' }).click();
await wait(2500);
await say('iso');
await caption('Live comfort score uses ISO 2631-1 Wk weighting', 'The international standard for how the seated human body feels vibration.');
await wait(7000);
await say('surface');
await caption('An on-device neural network names the surface', 'Smooth, cracked, pavers, gravel. Trained on physics-based simulated rides.');
await wait(7000);
await say('jolts');
await caption('Curb drops and potholes are caught as jolts', 'Peak acceleration plus crest factor separates a single shock from continuous rough ground.');
await page.waitForFunction(() => document.body.innerText.includes('Ride summary'), null, { timeout: 180000 });
await wait(600);
await say('summary');
await caption('After the ride: vibration dose and the ISO 2631 health zone', 'For people who roll all day, vibration exposure is a health issue, not just comfort.');
await highlight('.summary', 4500);

await page.getByRole('button', { name: /Review \d+ repair report/ }).click();
await wait(800);
await say('reports');
await caption('Every problem becomes a ready-to-send city repair report', 'Measured by the ride or reported by hand. Copy, share, or export GeoJSON / Open311 for 311 systems.');
await wait(2500);
await page.getByRole('button', { name: 'Show on map' }).first().click();
await wait(2500);
await page.getByRole('button', { name: 'Copy report' }).first().click().catch(() => {});
await wait(2000);

await say('real');
await card(
  'Checked on real phone rides',
  [
    '4 public bicycle rides in Guwahati: the road that photos show is failing scored <b>worst of 6, in every ride</b>.',
    'All <b>15</b> photographed defects had a jolt flagged within 25 m.',
    '6 public car drives with potholes labelled from video: vibration peaks separate potholes from other bumps, <b>AUC 0.87</b>.',
  ],
  7500,
);

await page.getByRole('tab', { name: 'About' }).click();
await say('honest');
await caption('Open, explainable, and honest about what is simulated', 'Sensing, scoring, routing and reports run on real phones today. "Teach RollMap" collects labelled field data.');
await wait(3000);
await page.evaluate(() => document.querySelector('.sheet-body')?.scrollTo({ top: 600, behavior: 'smooth' }));
await wait(4000);
await caption('');

await say('outro');
await card(
  'RollMap',
  [
    'Measure what a wheelchair rider actually feels → route around it → get it fixed.',
    'Runs in any phone browser. No install. Useful from the very first ride.',
    '<span style="opacity:.8;font-size:22px">github.com/debi910/rollmap · Demo rides and the Monaco comfort layer are simulated and labelled as such.</span>',
  ],
  6000,
);

await wait(speechLeft());
writeFileSync(join(outDir, 'voice/cues.json'), JSON.stringify(cues, null, 1));
const video = page.video();
await context.close();
const dest = join(outDir, 'rollmap-demo.webm');
await video.saveAs(dest);
await browser.close();
rmSync(tmpDir, { recursive: true, force: true });
console.log('wrote', dest);
