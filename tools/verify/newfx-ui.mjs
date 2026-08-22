import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1400,height:1400} });
const errs=[]; p.on('pageerror',e=>errs.push('[pageerror] '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('[console] '+m.text())});
await p.goto('http://localhost:5173/tools/verify/newfx-check.html',{waitUntil:'commit'});
await p.waitForFunction(()=>window.__result&&window.__result.status!=='running',null,{timeout:240000}).catch(()=>{});
const r = await p.evaluate(()=>window.__result);
console.log(JSON.stringify({status:r.status, glError:r.glError, count:r.count, dead:r.dead}, null, 1));
await p.screenshot({ path:(process.argv[2]??'/tmp/rig')+'/newfx.png', fullPage:true });
if (errs.length) console.log(errs.slice(0,5).join('\n'));
await b.close();
