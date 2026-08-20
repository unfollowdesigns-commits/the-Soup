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
await p.waitForTimeout(3000);
await p.screenshot({ path: `${OUT}/40-way.png` });
await p.getByRole('button', { name: /put something in/i }).click();
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/41-in.png` });
await p.getByRole('button', { name: /window/i }).first().click();
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/42-lab.png` });
console.log(errs.length ? errs.join('\n') : 'no page errors');
await b.close();
