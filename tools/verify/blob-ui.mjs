import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '.';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const p = await b.newPage({ viewport:{width:1600,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push('ERR '+e.message));
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1400);
await p.getByRole('button',{name:/put something in/i}).click(); await p.waitForTimeout(700);
await p.getByRole('button',{name:/passing/i}).first().click(); await p.waitForTimeout(9000);
await p.locator('.look').filter({hasText:'Trace'}).first().click();
await p.waitForTimeout(6000);
await p.locator('.viewer__stage').screenshot({path:`${OUT}/B1-blob.png`});
console.log('errors:', errs.length?errs.join('\n'):'none');
await b.close();
