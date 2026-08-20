import tgpu from 'typegpu';
import type { TgpuRoot } from 'typegpu';

/* ============================================================
   THE DEVICE
   One WebGPU device for the whole platform, adopted by TypeGPU
   through initFromDevice so raw WebGPU and typed WGSL share it.
   Everything that wants the GPU asks here; nothing creates its
   own device.
   ============================================================ */

export interface GpuCaps {
  /** navigator.gpu exists at all */
  present: boolean;
  adapter: boolean;
  device: boolean;
  /** real GPU timings, not wall clock */
  timestamps: boolean;
  f16: boolean;
  maxWorkgroupSizeX: number;
  maxStorageBufferBytes: number;
  maxComputeInvocations: number;
  vendor: string;
  architecture: string;
  reason?: string;
}

export interface GpuContext {
  device: GPUDevice;
  root: TgpuRoot;
  caps: GpuCaps;
}

let pending: Promise<GpuContext | null> | null = null;
let caps: GpuCaps = {
  present: false, adapter: false, device: false, timestamps: false, f16: false,
  maxWorkgroupSizeX: 0, maxStorageBufferBytes: 0, maxComputeInvocations: 0,
  vendor: '', architecture: '',
};

export const gpuCaps = () => caps;

export function acquireGpu(): Promise<GpuContext | null> {
  if (!pending) pending = boot();
  return pending;
}

async function boot(): Promise<GpuContext | null> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    caps = { ...caps, reason: 'This browser has no WebGPU. The WebGL2 engine is doing the work.' };
    return null;
  }
  caps.present = true;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      caps.reason = 'WebGPU is present but no adapter was granted.';
      return null;
    }
    caps.adapter = true;

    // ask for what we can measure and compute with, never require it
    const wanted: GPUFeatureName[] = [];
    if (adapter.features.has('timestamp-query')) wanted.push('timestamp-query');
    if (adapter.features.has('shader-f16')) wanted.push('shader-f16');

    const device = await adapter.requestDevice({
      requiredFeatures: wanted,
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(
          adapter.limits.maxStorageBufferBindingSize,
          1 << 28,
        ),
        maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      },
    });

    const info = (adapter as unknown as { info?: GPUAdapterInfo }).info;
    caps = {
      ...caps,
      device: true,
      timestamps: device.features.has('timestamp-query'),
      f16: device.features.has('shader-f16'),
      maxWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
      maxStorageBufferBytes: device.limits.maxStorageBufferBindingSize,
      maxComputeInvocations: device.limits.maxComputeInvocationsPerWorkgroup,
      vendor: info?.vendor ?? '',
      architecture: info?.architecture ?? '',
    };

    device.lost.then((i) => {
      caps = { ...caps, device: false, reason: `Device lost: ${i.reason ?? 'unknown'}` };
      pending = null;
    });

    // TypeGPU adopts the device we already made, so typed WGSL and raw
    // WebGPU write into the same queue and the same encoders
    const root = tgpu.initFromDevice({ device });
    return { device, root, caps };
  } catch (e) {
    caps.reason = e instanceof Error ? e.message : String(e);
    return null;
  }
}
