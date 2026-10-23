// Records the demo video with Playwright: the real app, driven by script, with captions overlaid.
//
//   npm run dev &   then   node scripts/record-demo.mjs [url] [chromium-path]
//
// Output: demo/rollmap-demo.webm (1280x720)

import { chromium } from 'playwright';
import { mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs';
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
const wait = (ms) => page.waitForTimeout(ms);

async function caption(text, sub = '') {
  await page.evaluate(
    ([t, s]) => {
      let el = document.getElementById('demo-caption');
      if (!el) {
        el = document.createElement('div');
        el.id = 'demo-caption';
        el.style.cssText =
          'position:fixed;left:24px;bottom:24px;max-width:820px;z-index:99999;background:rgba(15,23,42,.92);color:#fff;padding:14px 20px;border-radius:14px;font:600 22px/1.3 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .3s';
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
        'position:fixed;inset:0;z-index:100000;background:linear-gradient(135deg,#0f766e,#134e4a);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 110px;font-family:system-ui,sans-serif';
      el.innerHTML = `<div style="font:800 54px/1.1 system-ui">${t}</div>${l.map((x) => `<div style="font:400 26px/1.45 system-ui;margin-top:18px;max-width:1000px;opacity:.95">${x}</div>`).join('')}`;
      document.body.appendChild(el);
    },
    [title, lines],
  );
  await wait(ms);
  await page.evaluate(() => document.getElementById('demo-card')?.remove());
}

async function highlight(selector, ms = 1800) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
await wait(2500);

await card(
  'RollMap',
  [
    'Sidewalks scored by how they feel on wheels.',
    'Map apps tell a wheelchair user how <b>far</b> a route is.<br>Not whether it has broken slabs, cobbles, a curb with no ramp, or steps.',
  ],
  6500,
);

await caption('Plan a trip in Monaco: hilly, full of steps and old paving', 'Real OpenStreetMap streets, steps and lifts. Coloured lines are the community comfort layer.');
await wait(4500);
await highlight('.compare', 600);
await caption('The shortest walking route uses 5 flights of steps and 429 m of rough ground', 'Useless in a wheelchair, and a rough ride with a stroller.');
await highlight('.compare-row:nth-child(3)', 2600);
await caption('RollMap finds a step-free route that is far smoother: comfort 89 vs 53', 'Cost = distance × measured discomfort, jolts, OSM surface & incline, tuned to your chair.');
await highlight('.compare-foot', 4200);
await page.selectOption('select', 'stroller');
await caption('Different profiles weigh roughness differently: manual chair, power chair, stroller');
await wait(2800);
await page.selectOption('select', 'manual');
await wait(800);

await caption('Now the sensing: roll with a phone in the wheelchair bag', 'For this video we play a SIMULATED sensor stream through the exact pipeline the phone runs.');
await wait(3500);
await page.getByRole('button', { name: 'Simulate ride ×25' }).click();
await wait(2500);
await caption('Live comfort score uses ISO 2631-1 Wk weighting', 'The international standard for how the seated human body feels vibration.');
await wait(7000);
await caption('An on-device neural network names the surface', 'Smooth, cracked/broken, bricks/pavers, gravel. 89% per street segment on held-out simulated rides.');
await wait(7000);
await caption('Works with the phone in any orientation', 'Gravity tells us which way is down; vibration is projected onto it.');
await wait(7000);
await caption('Curb drops and potholes are caught as jolts', 'Peak acceleration plus crest factor separates a single shock from continuous rough ground.');
await page.waitForFunction(() => document.body.innerText.includes('Ride summary'), null, { timeout: 120000 });
await wait(600);
await caption('After the ride: vibration dose and the ISO 2631 health zone', 'For people who roll all day, vibration exposure is a real health issue, not just comfort.');
await highlight('.summary', 4500);

await page.getByRole('button', { name: /Review/ }).click();
await wait(800);
await caption('Every problem becomes a ready-to-send city repair report', 'GPS location + measured shock. Copy, share, or export GeoJSON / Open311 for 311 systems.');
await wait(2500);
const show = page.getByRole('button', { name: 'Show' }).first();
await show.click();
await wait(2500);
await highlight('.issue', 2500);
await page.getByRole('button', { name: /Copy report/ }).first().click().catch(() => {});
await wait(1500);

await page.getByRole('tab', { name: 'How it works' }).click();
await caption('Open, explainable, and honest about what is simulated', 'Steps, routing, scoring and reports run on real sensors today. Field data collection is built in ("Teach RollMap").');
await wait(3000);
await page.evaluate(() => document.querySelector('.panel-body')?.scrollTo({ top: 400, behavior: 'smooth' }));
await wait(4000);
await caption('');

await card(
  'RollMap',
  [
    'Measure what a wheelchair rider actually feels → route around it → get it fixed.',
    'Runs in any phone browser. No install. Useful from the very first ride.',
    '<span style="opacity:.8;font-size:22px">github.com/debi910/rollmap · Demo rides and community layer are simulated and labelled as such.</span>',
  ],
  6000,
);

const video = page.video();
await context.close();
await browser.close();
const path = await video.path();
renameSync(path, join(outDir, 'rollmap-demo.webm'));
rmSync(tmpDir, { recursive: true, force: true });
console.log('wrote', join(outDir, 'rollmap-demo.webm'), readdirSync(outDir));
