import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
const r = await p.evaluate(async () => {
  if (!('VideoEncoder' in window)) return { webcodecs: false };
  const cands = ['avc1.42E01F','avc1.4D0028','avc1.640028','avc1.640033','vp8','vp09.00.51.08','vp09.00.10.08','av01.0.08M.08'];
  const out = {};
  for (const c of cands) {
    for (const [w,h] of [[1920,1080],[3840,2160]]) {
      try {
        const s = await VideoEncoder.isConfigSupported({ codec: c, width: w, height: h, bitrate: 2e7, framerate: 24 });
        out[`${c}@${w}x${h}`] = !!s.supported;
      } catch (e) { out[`${c}@${w}x${h}`] = 'err:' + e.name; }
    }
  }
  return { webcodecs: true, out, mediaRecorder: ['video/mp4;codecs=avc1.640028','video/webm;codecs=vp9','video/webm;codecs=vp8'].map(t=>[t, MediaRecorder.isTypeSupported(t)]) };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
