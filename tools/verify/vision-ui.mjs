import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '.';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox',
         '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['camera'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('ERR ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/favicon/.test(m.text())) errs.push('C ' + m.text()); });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1400);
await p.getByRole('button', { name: /put something in/i }).click();
await p.waitForTimeout(600);
await p.getByRole('button', { name: /open the camera/i }).click();
await p.waitForTimeout(3000);

// open the Vision module
await p.locator('.process__scroll .mod__title', { hasText: 'Vision' }).click();
await p.waitForTimeout(9000);   // models are ~12MB
const state = await p.locator('.vis__state .mono').innerText();
console.log('VISION STATE:', state);
const counts = await p.locator('.vis__counts').count();
if (counts) console.log('COUNTS:', (await p.locator('.vis__counts').innerText()).replace(/\n/g,' | '));
await p.screenshot({ path: `${OUT}/70-vision.png` });
console.log('errors:', errs.length ? errs.slice(0,4).join('\n') : 'none');
await b.close();
