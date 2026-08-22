import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp/rig';
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errs = [];
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`[console] ${m.text()}`); });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /put something in/i }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /window/i }).first().click();
await page.waitForTimeout(3500);
await shot('01-rig-cook');

// benches by key
for (const [k, n] of [['s', '02-stock'], ['r', '03-read'], ['c', '04-cook']]) {
  await page.keyboard.press(k);
  await page.waitForTimeout(500);
  await shot(n);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot('05-shut');

// foot tabs
for (const [t, n] of [[/^Recipe$/, '06-recipe'], [/roll the dice/i, '07-dice'], [/^Looks$/, '08-looks']]) {
  await page.getByRole('button', { name: t }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  await shot(n);
}

// bare
await page.keyboard.press('h');
await page.waitForTimeout(600);
await shot('09-bare');
await page.keyboard.press('h');
await page.waitForTimeout(600);

// measurements
const m = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const box = (el) => { const b = r(el); return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const canvas = q('.viewer__canvas');
  const doc = document.documentElement;
  return {
    rig: box(q('.rig')),
    stage: box(q('.viewer__stage')),
    canvas: box(canvas),
    top: box(q('.rig__top')),
    spine: box(q('.rig__spine')),
    foot: box(q('.rig__foot')),
    viewerBar: box(q('.viewer__bar')),
    overflowX: doc.scrollWidth - doc.clientWidth,
    overflowY: doc.scrollHeight - doc.clientHeight,
  };
});
console.log(JSON.stringify(m, null, 2));

// drop anywhere
await page.evaluate(() => {
  const dt = new DataTransfer();
  const ev = new DragEvent('dragenter', { bubbles: true, dataTransfer: dt });
  Object.defineProperty(ev.dataTransfer, 'types', { value: ['Files'] });
  window.dispatchEvent(ev);
});
await page.waitForTimeout(400);
await shot('10-drop');
console.log('anydrop visible:', await page.locator('.anydrop').count());

// a real file, dropped on the window rather than on a screen
const named = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 400;
  const g = c.getContext('2d');
  g.fillStyle = '#8a6b3f'; g.fillRect(0, 0, 640, 400);
  g.fillStyle = '#f0ece2'; g.fillRect(60, 60, 200, 280);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'dropped-plate.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise((r) => setTimeout(r, 1200));
  return document.querySelector('.viewer__name')?.textContent ?? null;
});
console.log('after drop, specimen name =', JSON.stringify(named));
await page.waitForTimeout(1200);
await shot('11-dropped');

console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
