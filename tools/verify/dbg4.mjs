import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:1600,height:1000}});
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1200);
await p.getByRole('button',{name:/enter the lab/i}).click(); await p.waitForTimeout(400);
await p.getByRole('button',{name:/window study/i}).click(); await p.waitForTimeout(1500);
console.log(await p.evaluate(() => {
  const q = s => document.querySelector(s);
  const r = el => el ? {w: Math.round(el.getBoundingClientRect().width), sw: el.scrollWidth} : null;
  return {
    doc: {w: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth},
    lab: r(q('.lab')), main: r(q('.lab__main')), left: r(q('.lab__left')),
    centre: r(q('.lab__centre')), right: r(q('.lab__right')), bar: r(q('.lab__bar')),
    process: r(q('.process')), deck: r(q('.deck')),
    toothOnStage: !!q('.viewer__stage.tooth'),
  };
}));
await b.close();
