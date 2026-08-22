import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('http://localhost:5173/tools/verify/mp4-check.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__result && window.__result.status !== 'running', null, { timeout: 30000 }).catch(()=>{});
console.log(JSON.stringify(await p.evaluate(() => window.__result), null, 1));
await b.close();
