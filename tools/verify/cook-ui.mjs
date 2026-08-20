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
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1400);
await p.getByRole('button', { name: /put something in/i }).click();
await p.waitForTimeout(700);
await p.screenshot({ path: `${OUT}/50-in.png` });

await p.getByRole('button', { name: /^Window/i }).first().click();
await p.waitForTimeout(5200);
await p.screenshot({ path: `${OUT}/51-default-soup.png` });

// the soup card must not say None on arrival
const soupCard = p.locator('.stagecard', { hasText: 'Film Soup' }).first();
console.log('SOUP CARD:', (await soupCard.innerText()).replace(/\n/g, ' | '));
const burnCard = p.locator('.stagecard', { hasText: 'Film Burn' }).first();
console.log('BURN CARD (before):', (await burnCard.innerText()).replace(/\n/g, ' | '));

// tapping a sleeping card must cook it
await burnCard.locator('.stagecard__grip').click();
await p.waitForTimeout(1200);
console.log('BURN CARD (after tap):', (await burnCard.innerText()).replace(/\n/g, ' | '));
await p.locator('.deck').screenshot({ path: `${OUT}/52-cards.png` });
await p.locator('.viewer__stage').screenshot({ path: `${OUT}/53-burn-from-card.png` });

// the camera
await p.getByRole('button', { name: /swap/i }).click();
await p.waitForTimeout(600);
await p.getByRole('button', { name: /open the camera/i }).click();
await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/54-camera.png` });
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close();
