import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '.';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push('ERR ' + e.message));
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1400);
await p.getByRole('button', { name: /put something in/i }).click();
await p.waitForTimeout(700);
await p.screenshot({ path: `${OUT}/90-in.png` });

await p.getByRole('button', { name: /passing/i }).first().click();
await p.waitForTimeout(6000);
await p.screenshot({ path: `${OUT}/91-motion.png` });

// two frames a second apart must differ — proof it is actually moving
const grab = async () => p.locator('canvas').first().screenshot();
const a = await grab(); await p.waitForTimeout(1200); const c = await grab();
console.log('frames differ:', Buffer.compare(a, c) !== 0, `(${a.length} vs ${c.length} bytes)`);

// the effects that need motion
const strip = p.locator('.look');
for (const [name, file] of [['Trace','92-trace'],['Proof Sheet','93-sheet']]) {
  await strip.filter({ hasText: name }).first().click();
  await p.waitForTimeout(2500);
  await p.locator('.viewer__stage').screenshot({ path: `${OUT}/${file}.png` });
}
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close();
