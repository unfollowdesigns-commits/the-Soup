import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp/rig';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const errs=[]; const p = await b.newPage({ viewport:{width:1600,height:1000} });
p.on('pageerror',e=>errs.push('[pageerror] '+e.message));
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1300);
await p.getByRole('button',{name:/put something in/i}).click();
await p.waitForTimeout(400);
await p.getByRole('button',{name:/window/i}).first().click();
await p.waitForTimeout(2500);

const cats = await p.evaluate(() => [...document.querySelectorAll('.ws__groups button')].map(e => e.textContent.trim()));
console.log('categories all visible:', JSON.stringify(cats));
const total = await p.evaluate(() => document.querySelectorAll('.card').length);
console.log('cards:', total);

for (const term of ['8mm','16mm','portra','tri-x','sprocket','kodachrome']) {
  await p.locator('.ws__search input').fill(term);
  await p.waitForTimeout(350);
  const names = await p.evaluate(() => [...document.querySelectorAll('.card__name')].map(e=>e.textContent));
  console.log(`"${term}" =>`, JSON.stringify(names.slice(0,6)), names.length > 6 ? `+${names.length-6}` : '');
}

// the Format category, and put Super 8 on the picture
await p.locator('.ws__search input').fill('');
await p.waitForTimeout(300);
await p.getByRole('button',{name:/^Format$/}).click();
await p.waitForTimeout(4500);
await p.screenshot({path:`${OUT}/f1-formats.png`});
await p.locator('.card', { hasText: 'Super 8' }).first().locator('.card__pic').click();
await p.waitForTimeout(2500);
await p.screenshot({path:`${OUT}/f2-super8.png`});

// 16mm is perforated on both edges — a different path through the layout
await p.locator('.card', { hasText: '16 mm' }).first().locator('.card__pic').click();
await p.waitForTimeout(2200);
await p.screenshot({path:`${OUT}/f4-16mm.png`});

await p.getByRole('button',{name:/^Film stock$/}).click();
await p.waitForTimeout(6000);
await p.screenshot({path:`${OUT}/f3-stocks.png`});
console.log(errs.length ? errs.slice(0,5).join('\n') : 'no page errors');
await b.close();
