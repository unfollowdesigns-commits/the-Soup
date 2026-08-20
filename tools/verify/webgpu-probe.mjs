import { chromium } from 'playwright';
for (const args of [
  ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
  ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
  ['--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--no-sandbox'],
]) {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args });
  const p = await b.newPage();
  const r = await p.evaluate(async () => {
    if (!('gpu' in navigator)) return { gpu:false };
    try {
      const a = await navigator.gpu.requestAdapter();
      if (!a) return { gpu:true, adapter:false };
      const d = await a.requestDevice();
      return { gpu:true, adapter:true, device:!!d,
        features:[...a.features].slice(0,8),
        maxWG:d.limits.maxComputeWorkgroupSizeX };
    } catch(e){ return { gpu:true, err:String(e).slice(0,90) }; }
  });
  console.log(args.slice(0,2).join(' '), '->', JSON.stringify(r));
  await b.close();
}
