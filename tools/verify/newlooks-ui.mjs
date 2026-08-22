import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '.';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox',
         '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],
});
const ctx = await b.newContext({ viewport:{width:1600,height:1000}, permissions:['camera'] });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('ERR '+e.message));
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1400);
await p.getByRole('button',{name:/put something in/i}).click(); await p.waitForTimeout(700);
await p.getByRole('button',{name:/passing/i}).first().click(); await p.waitForTimeout(9000);
await p.screenshot({path:`${OUT}/A0-strip.png`});
for (const [name,file] of [['Press','A1-press'],['Riso','A2-riso'],['Smear','A3-smear'],['Photocopy','A4-copy']]) {
  await p.locator('.look').filter({hasText:name}).first().click();
  await p.waitForTimeout(2200);
  await p.locator('.viewer__stage').screenshot({path:`${OUT}/${file}.png`});
}
// light bench: go live
await p.getByRole('button',{name:/^Light$/}).click(); await p.waitForTimeout(1500);
await p.getByRole('button',{name:/go live/i}).click(); await p.waitForTimeout(3500);
const badge = await p.locator('.light__live').innerText().catch(()=> 'n/a');
console.log('LIGHT BADGE:', badge.replace(/\n/g,' '));
await p.screenshot({path:`${OUT}/A5-light-live.png`});
console.log('errors:', errs.length?errs.join('\n'):'none');
await b.close();
