import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '.';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('ERR ' + e.message));
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1400);
await p.getByRole('button', { name: /put something in/i }).click();
await p.waitForTimeout(600);
await p.getByRole('button', { name: /^Window/i }).first().click();
await p.waitForTimeout(4500);
await p.getByRole('button', { name: /^Light$/ }).click();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/60-light.png` });
const dead = await p.locator('.light__dead').count();
const txt = dead ? (await p.locator('.light__dead').innerText()).replace(/\n/g,' | ') : 'rig running';
console.log('WEBGPU STATE:', txt);
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close();
