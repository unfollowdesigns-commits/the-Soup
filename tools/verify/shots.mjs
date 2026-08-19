import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '.';
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errs = [];
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); };

// ---------- desktop ----------
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`[console] ${m.text()}`); });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
await shot(page, '01-enter');

await page.getByRole('button', { name: /enter the lab/i }).click();
await page.waitForTimeout(500);
await shot(page, '02-import');

await page.getByRole('button', { name: /window study/i }).click();
await page.waitForTimeout(1800);
await shot(page, '03-lab');

// material archive + record
await page.getByRole('button', { name: /^Record$/ }).first().click({ force: true }).catch(() => {});
await page.waitForTimeout(600);
await shot(page, '04-record');
await page.getByRole('button', { name: /close record/i }).click().catch(() => {});
await page.waitForTimeout(300);

// analysis rail
await page.getByRole('button', { name: /^Analysis$/ }).first().click();
await page.waitForTimeout(500);
await shot(page, '05-analysis');
await page.getByRole('button', { name: /^Process$/ }).first().click();

// deck tabs
for (const [t, n] of [[/experiment/i, '06-experiment'], [/^Log$/, '07-log'], [/^Recipes$/, '08-recipes']]) {
  await page.getByRole('button', { name: t }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, n);
}
await page.getByRole('button', { name: /process stack/i }).first().click().catch(() => {});

// comparison + export
await page.getByRole('button', { name: /^Split$/ }).click().catch(() => {});
await page.waitForTimeout(700);
await shot(page, '09-split');
await page.getByRole('button', { name: /^Develop$/ }).click().catch(() => {});
await page.waitForTimeout(600);
await shot(page, '10-export');

// ---------- mobile ----------
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
m.on('pageerror', (e) => errs.push(`[mobile pageerror] ${e.message}`));
await m.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await m.waitForTimeout(1800);
await m.getByRole('button', { name: /enter the lab/i }).click();
await m.waitForTimeout(400);
await m.getByRole('button', { name: /window study/i }).click();
await m.waitForTimeout(1800);
await shot(m, '11-mobile-lab');
await m.locator('.mob__nav button').nth(1).click({ force: true });
await m.waitForTimeout(600);
await shot(m, '12-mobile-materials');
await m.locator('.mob__nav button').nth(2).click({ force: true });
await m.waitForTimeout(500);
await m.locator('button', { hasText: 'Film Soup' }).first().click({ force: true }).catch(() => {});
await m.waitForTimeout(600);
await shot(m, '13-mobile-sheet');

console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
