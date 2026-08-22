import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp/rig';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const errs = [];
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
p.on('console', m => { if (m.type()==='error') errs.push('[console] ' + m.text()); });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
await p.getByRole('button', { name: /put something in/i }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /passing/i }).first().click();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/c0-moving.png` });

await p.getByRole('button', { name: /^Develop$/ }).click();
await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/c1-clip.png` });

// switch gate and frame mode
await p.getByRole('button', { name: /16 mm/i }).first().click();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/c2-16mm.png` });
await p.getByRole('button', { name: /picture only/i }).click();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/c3-clean.png` });

const info = await p.evaluate(() => {
  const el = document.querySelector('.clip__preview');
  const rows = [...document.querySelectorAll('.clip__out .spec__row')].map(r => r.textContent);
  return { preview: el && { w: el.width, h: el.height }, rows,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
console.log(JSON.stringify(info, null, 1));
console.log(errs.length ? errs.slice(0,6).join('\n') : 'no page errors');
await b.close();
