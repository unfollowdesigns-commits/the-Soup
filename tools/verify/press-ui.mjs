import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '.';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('ERR ' + e.message));
p.on('console', m => { if (m.type()==='error') errs.push('C ' + m.text()); });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1400);
await p.getByRole('button', { name: /enter the lab/i }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /window study/i }).click();
await p.waitForTimeout(1600);
await p.getByRole('button', { name: /^Press$/ }).click();
await p.waitForTimeout(2000);
await p.screenshot({ path: `${OUT}/20-press.png` });

const layouts = ['Index', 'Sheet', 'Terminal'];
for (const l of layouts) {
  await p.locator('.press__controls .seg__opt', { hasText: l }).first().click();
  await p.waitForTimeout(1600);
  await p.locator('.press__sheet').screenshot({ path: `${OUT}/21-press-${l.toLowerCase()}.png` });
}
// screening, on the terminal layout with the chemical ground
await p.locator('.ground').nth(3).click();
await p.waitForTimeout(600);
const screenTrack = p.locator('.press__controls .instr', { hasText: 'SCREEN' }).first().locator('.instr__track');
const bb = await screenTrack.boundingBox();
await p.mouse.click(bb.x + bb.width * 0.8, bb.y + bb.height / 2);
await p.waitForTimeout(2000);
await p.locator('.press__sheet').screenshot({ path: `${OUT}/22-press-screen.png` });
// and the plate layout again
await p.locator('.press__controls .seg__opt', { hasText: 'Plate' }).first().click();
await p.locator('.ground').nth(0).click();
await p.waitForTimeout(1800);
await p.locator('.press__sheet').screenshot({ path: `${OUT}/23-press-plate.png` });
console.log(errs.length ? errs.join('\n') : 'no page errors');
await b.close();
