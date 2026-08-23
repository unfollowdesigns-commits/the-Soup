import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp/rig';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const errs = [];
const p = await b.newPage({ viewport:{width:1500,height:1000} });
p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
p.on('console', m => { if (m.type()==='error') errs.push('[console] ' + m.text()); });
await p.goto('http://localhost:5173/', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(1400);
await p.screenshot({ path:`${OUT}/p0-enter.png` });
await p.waitForTimeout(3200);            // let the mark turn
await p.screenshot({ path:`${OUT}/p0b-enter-turned.png` });

await p.getByRole('button', { name:/put something in/i }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name:/window/i }).first().click();
await p.waitForTimeout(4000);
await p.screenshot({ path:`${OUT}/p1-plain.png` });

// count what a first-time user is looking at
const count = await p.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const c = [...document.querySelectorAll('button, input, select, [role="slider"]')].filter(vis);
  return { controls: c.length, labels: c.slice(0, 40).map(e => (e.textContent||e.type||'').trim().slice(0,22)) };
});
console.log('plain lab controls on screen:', count.controls);

// the dial
// the knob is dragged, not filled
const knob = p.locator('.dial__knob');
const box = await knob.boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.mouse.down();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 135, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(900);
await p.screenshot({ path:`${OUT}/p2-quarter.png` });
console.log('after drag, dial reads', await p.locator('.dial__read').textContent());
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.mouse.down();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 300, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(700);

// a different look
await p.getByRole('button', { name:/^Riso$/i }).first().click().catch(()=>{});
await p.waitForTimeout(1200);
await p.screenshot({ path:`${OUT}/p3-riso.png` });

// the door
await p.keyboard.press('c');
await p.waitForTimeout(900);
await p.screenshot({ path:`${OUT}/p4-bench.png` });
const full = await p.evaluate(() => [...document.querySelectorAll('button, input, select')]
  .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length);
console.log('bench controls on screen:', full);
await p.keyboard.press('b');
await p.waitForTimeout(600);
await p.screenshot({ path:`${OUT}/p5-back.png` });

console.log(errs.length ? errs.slice(0,6).join('\n') : 'no page errors');
await b.close();
