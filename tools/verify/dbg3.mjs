import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:1600,height:1000}});
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1500);
for (const sel of [/enter the lab/i, /ENTER THE LAB/, 'Enter the lab']) {
  try { console.log(String(sel), '->', await p.getByRole('button', { name: sel }).count()); }
  catch(e){ console.log(String(sel), 'ERR', e.message.slice(0,80)); }
}
console.log('text locator ->', await p.locator('button', { hasText: 'Enter' }).count());
await b.close();
