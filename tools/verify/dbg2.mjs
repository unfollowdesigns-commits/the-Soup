import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:1600,height:1000}});
await p.goto('http://localhost:5173/',{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
const names = await p.evaluate(() => [...document.querySelectorAll('button')].map(x => JSON.stringify(x.textContent)));
console.log(names.join('\n'));
console.log('--- count via role ---', await p.getByRole('button').count());
await b.close();
