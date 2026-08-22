import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp/rig';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const errs = [];
const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
p.on('console', m => { if (m.type()==='error') errs.push('[console] ' + m.text()); });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
await p.getByRole('button', { name: /put something in/i }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /passing/i }).first().click();
await p.waitForTimeout(2500);
await p.getByRole('button', { name: /^Develop$/ }).click();
await p.waitForTimeout(3500);

// a short run at 1080 so the software encoder finishes
await p.getByRole('button', { name: /^1080$/ }).click();
const to = p.locator('.clip__time input').nth(1);
await to.fill('0.7');
await to.blur();
await p.waitForTimeout(1500);

const dl = p.waitForEvent('download', { timeout: 300000 });
await p.getByRole('button', { name: /run the clip through/i }).click();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/c4-running.png` });
const d = await dl;
const path = `${OUT}/` + d.suggestedFilename();
await d.saveAs(path);
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/c5-done.png` });

const done = await p.locator('.clip__done').textContent().catch(() => null);
console.log('saved:', d.suggestedFilename());
console.log('done line:', done);
console.log(errs.length ? errs.slice(0,6).join('\n') : 'no page errors');
await b.close();
