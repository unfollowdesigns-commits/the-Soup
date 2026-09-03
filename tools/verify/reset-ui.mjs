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
await p.waitForTimeout(3500);

const state = () => p.evaluate(() => ({
  chips: [...document.querySelectorAll('.link__name')].map(e=>e.textContent),
  look: document.querySelector('.lookchip__name')?.textContent ?? null,
  n: document.querySelector('.lookchip__n')?.textContent ?? null,
}));
console.log('opens as:      ', JSON.stringify(await state()));

const pick = async (term) => {
  await p.locator('.ws__search input').fill(term);
  await p.waitForTimeout(400);
  await p.locator('.card__pic').first().click();
  await p.waitForTimeout(800);
};

await pick('kaleido');
console.log('+ Kaleidoscope:', JSON.stringify(await state()));
await pick('vignette');
console.log('+ Vignette:    ', JSON.stringify(await state()));

await p.getByRole('button',{name:/^Stack up$/}).click();
await pick('grain');
console.log('stack + Grain: ', JSON.stringify(await state()));
await p.screenshot({path:`${OUT}/r1-chain.png`});

await p.getByRole('button',{name:/^Reset$/}).click();
await p.waitForTimeout(1000);
console.log('after Reset:   ', JSON.stringify(await state()));
await p.screenshot({path:`${OUT}/r2-reset.png`});

// a look comes back as one chip
await p.keyboard.press('k');
await p.waitForTimeout(4000);
await p.locator('.look').first().click();
await p.waitForTimeout(1500);
await p.keyboard.press('Escape');
await p.waitForTimeout(600);
console.log('after a look:  ', JSON.stringify(await state()));
await p.screenshot({path:`${OUT}/r3-look.png`});
console.log(errs.length ? errs.slice(0,4).join('\n') : 'no page errors');
await b.close();
