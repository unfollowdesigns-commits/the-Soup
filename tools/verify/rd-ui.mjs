import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1400,height:600} });
p.on('pageerror', e=>console.log('[pageerror]', e.message));
await p.goto('http://localhost:5173/tools/verify/rd-check.html', { waitUntil:'commit' });
await p.waitForFunction(()=>window.__result&&window.__result.status!=='running', null, {timeout:240000}).catch(()=>{});
console.log(JSON.stringify(await p.evaluate(()=>window.__result), null, 1));
await p.screenshot({ path: (process.argv[2]??'/tmp/rig')+'/rd-check.png', fullPage:true });
await b.close();
