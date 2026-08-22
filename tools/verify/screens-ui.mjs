import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp/rig';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1500,height:1000} });
await p.goto('http://localhost:5173/', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/s1-enter.png` });
await p.getByRole('button', { name:/put something in/i }).click();
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/s2-import.png` });
await b.close();
