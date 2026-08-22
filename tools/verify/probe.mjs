import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1500,height:1000} });
await p.goto('http://localhost:5173/', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(1500);
await p.locator('.way__name').screenshot({ path: '/tmp/rig/name.png' });
console.log(JSON.stringify(await p.evaluate(() => {
  const el = document.querySelector('.way__name');
  const cs = getComputedStyle(el);
  const wm = document.querySelector('.way__right');
  return {
    color: cs.color, opacity: cs.opacity, blend: cs.mixBlendMode, filter: cs.filter,
    parentOpacity: getComputedStyle(el.parentElement).opacity,
    lit: document.querySelector('.way').dataset.lit,
    right: wm ? { display: getComputedStyle(wm).display, rect: wm.getBoundingClientRect().toJSON(), z: getComputedStyle(wm).zIndex } : null,
    fonts: [...document.fonts].length,
    bodyZ: getComputedStyle(document.querySelector('.way__body')).zIndex,
    bodyPos: getComputedStyle(document.querySelector('.way__body')).position,
    fontFamily: getComputedStyle(document.querySelector('.way__name')).fontFamily,
    weight: getComputedStyle(document.querySelector('.way__name')).fontWeight,
  };
}), null, 1));
await b.close();
