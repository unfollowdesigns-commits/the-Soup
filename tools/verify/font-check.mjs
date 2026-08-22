import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }).catch(()=>{});
const r = await p.evaluate(async () => {
  await document.fonts.ready;
  const loaded = [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`);
  const m = (font) => { const c = document.createElement('canvas').getContext('2d');
    c.font = '40px ' + font; return c.measureText('SOUP grain 0123').width; };
  return { count: document.fonts.size, loaded,
    archivo: m('Archivo'), plex: m('"IBM Plex Mono"'), arial: m('Arial'), mono: m('monospace') };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
