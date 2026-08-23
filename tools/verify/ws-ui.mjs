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
await p.waitForTimeout(9000);
await p.screenshot({path:`${OUT}/w1-workspace.png`});

const geo = await p.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null;
    const b = el.getBoundingClientRect(); return { x:Math.round(b.x), y:Math.round(b.y), w:Math.round(b.width), h:Math.round(b.height) }; };
  return { browse:r('.ws__browse'), stage:r('.ws__stage'), chain:r('.ws__chain'), panel:r('.ws__panel'),
    cards:document.querySelectorAll('.card').length, thumbs:document.querySelectorAll('.card__pic img').length,
    chainLinks:document.querySelectorAll('.link').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
console.log(JSON.stringify(geo));

// search, then pick an effect — the panel must open beside the picture
await p.locator('.ws__search input').fill('kaleido');
await p.waitForTimeout(600);
await p.locator('.card__pic').first().click();
await p.waitForTimeout(2500);
await p.screenshot({path:`${OUT}/w2-picked.png`});
const panel = await p.evaluate(() => {
  const el = document.querySelector('.ws__panel');
  const st = document.querySelector('.ws__stage').getBoundingClientRect();
  return el ? { title: el.querySelector('h2')?.textContent,
    overlapsStage: el.getBoundingClientRect().left < st.right - 2 } : null;
});
console.log('panel:', JSON.stringify(panel));

// looks drawer
await p.locator('.ws__search input').fill('');
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
await p.keyboard.press('k');
await p.waitForTimeout(2500);
await p.screenshot({path:`${OUT}/w3-looks.png`});
console.log(errs.length ? errs.slice(0,5).join('\n') : 'no page errors');
await b.close();
