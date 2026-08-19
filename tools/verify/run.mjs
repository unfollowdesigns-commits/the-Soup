import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/tools/verify/engine-check.html';
const shot = process.argv[3] ?? 'engine-check.png';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__result && window.__result.status !== 'running', { timeout: 45000 }).catch(() => {});
const result = await page.evaluate(() => window.__result);
console.log(JSON.stringify(result, null, 2));
if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
await page.screenshot({ path: shot, fullPage: true });
await browser.close();
