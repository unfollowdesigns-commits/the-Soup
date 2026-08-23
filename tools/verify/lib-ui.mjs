import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp/rig';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const errs=[]; const p = await b.newPage({ viewport:{width:1600,height:1000} });
p.on('pageerror',e=>errs.push('[pageerror] '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('[console] '+m.text())});
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1300);
await p.getByRole('button',{name:/put something in/i}).click();
await p.waitForTimeout(400);
await p.getByRole('button',{name:/window/i}).first().click();
await p.waitForTimeout(3000);
await p.screenshot({path:`${OUT}/l0-plain.png`});

// through the door into the library
await p.keyboard.press('b');
await p.waitForTimeout(9000);            // let the thumbnails render
await p.screenshot({path:`${OUT}/l1-library.png`});

const info = await p.evaluate(() => ({
  cards: document.querySelectorAll('.fx').length,
  thumbs: document.querySelectorAll('.fx__frame img').length,
  groups: document.querySelectorAll('.lib__group').length,
}));
console.log('library:', JSON.stringify(info));

// search
await p.locator('.lib__search').fill('8mm');
await p.waitForTimeout(500);
const found = await p.evaluate(() => [...document.querySelectorAll('.fx__name')].map(e=>e.textContent));
console.log('search "8mm" =>', JSON.stringify(found));
await p.screenshot({path:`${OUT}/l2-search.png`});

await p.locator('.lib__search').fill('tunnel');
await p.waitForTimeout(400);
console.log('search "tunnel" =>', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.fx__name')].map(e=>e.textContent))));

// add the film gate, then the leader, then a burn
await p.locator('.lib__search').fill('');
await p.waitForTimeout(300);
for (const name of ['Film gate','Countdown leader','Tracking']) {
  await p.locator('.fx', { hasText: name }).first().locator('.fx__frame').click().catch(()=>{});
  await p.waitForTimeout(900);
}
await p.screenshot({path:`${OUT}/l3-added.png`});
const on = await p.evaluate(() => [...document.querySelectorAll('.fx[data-on="true"] .fx__name')].map(e=>e.textContent));
console.log('on the picture:', JSON.stringify(on));

// close the bench and look at the picture with the gate + trace live
await p.keyboard.press('Escape');
await p.waitForTimeout(1500);
await p.screenshot({path:`${OUT}/l4-gate.png`});
console.log(errs.length ? errs.slice(0,6).join('\n') : 'no page errors');
await b.close();
