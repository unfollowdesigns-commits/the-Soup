import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
await p.goto('http://localhost:5173/tools/verify/video-check.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__result && window.__result.status !== 'running', null, { timeout: 180000 })
  .catch(() => {});
console.log(JSON.stringify(await p.evaluate(() => window.__result), null, 1));
await p.screenshot({ path: (process.argv[2] ?? '/tmp/rig') + '/video-check.png', fullPage: true });
if (errs.length) console.log(errs.slice(0, 8).join('\n'));
await b.close();
