import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp/rig';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const errs=[]; const p = await b.newPage({ viewport:{width:1500,height:1000} });
p.on('pageerror',e=>errs.push('[pageerror] '+e.message));
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1300);
await p.getByRole('button',{name:/put something in/i}).click();
await p.waitForTimeout(400);
await p.getByRole('button',{name:/passing/i}).first().click();   // the moving specimen
await p.waitForTimeout(3000);

// switch the trace on through the library, in constellation mode
await p.keyboard.press('b');
await p.waitForTimeout(1200);
await p.locator('.lib__search').fill('constellation');
await p.waitForTimeout(600);
await p.locator('.fx').first().locator('.fx__frame').click();
await p.waitForTimeout(600);
await p.locator('.fx').first().locator('.fx__frame').click();   // opens the presets
await p.waitForTimeout(400);
await p.getByRole('button',{name:/^Constellation$/}).click().catch(()=>{});
await p.waitForTimeout(600);
await p.keyboard.press('Escape');
await p.waitForTimeout(3500);            // let trails build
await p.screenshot({path:`${OUT}/t1-constellation.png`});

// how much ink the layer is actually putting down
const ink = await p.evaluate(() => {
  const c = document.querySelector('.trace');
  if (!c) return null;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let on = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 12) on++;
  return { w: c.width, h: c.height, drawnPct: +(100 * on / (d.length / 4)).toFixed(2) };
});
console.log('trace layer:', JSON.stringify(ink));
console.log(errs.length ? errs.slice(0,4).join('\n') : 'no page errors');
await b.close();
