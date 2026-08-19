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
await p.waitForTimeout(1600);

// open the Trace module and switch it on
const rail = p.locator('.process__scroll');
await rail.locator('.mod__title', { hasText: 'Trace' }).click();
await p.waitForTimeout(300);
const traceMod = p.locator('.mod', { has: p.locator('.mod__title', { hasText: 'Trace' }) });
await traceMod.locator('button', { hasText: /^Off$/ }).first().click();
await p.waitForTimeout(600);

for (const mode of ['Boxes', 'Swarm', 'Points', 'Links', 'Typographic']) {
  await traceMod.locator('.seg__opt', { hasText: mode }).click();
  await p.waitForTimeout(700);
  await p.locator('.lab__centre').screenshot({ path: `${OUT}/trace-${mode.toLowerCase()}.png` });
}
console.log(errs.length ? errs.join('\n') : 'no page errors');
await b.close();
