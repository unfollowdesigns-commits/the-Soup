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
await p.getByRole('button', { name: /enter the lab/i }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /window study/i }).click();
// the strip renders 12 looks in turn
await p.waitForTimeout(6000);
await p.screenshot({ path: `${OUT}/30-looks.png` });

for (const [name, file] of [['Cross / Wine Soup','31-soup'], ['End of Reel','32-burn'], ['Bitmap','33-bitmap'], ['Trace / Swarm','34-trace'], ['Proof Sheet','35-sheet']]) {
  await p.locator('.look', { hasText: name.split(' / ')[0] }).first().click();
  await p.waitForTimeout(1300);
  await p.locator('.viewer__stage').screenshot({ path: `${OUT}/${file}.png` });
}
console.log(errs.length ? errs.join('\n') : 'no page errors');
await b.close();
