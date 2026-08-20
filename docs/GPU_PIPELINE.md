# The GPU pipeline

```
camera / image
      │  copyExternalImageToTexture   (queue copy, not a readback)
      ▼
┌──────────────────────────┐
│ depth node               │   448² r16float
│  model  → your network   │   dispatches counted, not estimated
│  proxy  → 1 compute pass │   labelled PROXY wherever it is shown
└───────────┬──────────────┘
            │  GPUTextureView — the same object, no copy
            ▼
┌──────────────────────────┐
│ lighting node            │
│  depth → normals         │   central differences × relief
│  depth → attenuation     │   inverse square on reconstructed position
│  contact shadows         │   12-step march through the depth field
│  N lights, wrap-lit      │
└───────────┬──────────────┘
            │  rgba16float
            ▼
┌──────────────────────────┐
│ present node             │   render pass, same encoder
└──────────────────────────┘

            ONE GPUCommandEncoder · ONE submit
```

## Why it is a substrate and not one integration

Every stage is a `GpuNode` (`src/gpu/graph.ts`):

```ts
interface GpuNode {
  id: string;
  label: string;
  dispatches: number;                    // counted last frame
  outputs: Record<string, GPUTextureView>;
  resize(w, h): void;
  encode(encoder, frame, stamps): void;  // must not submit, map or await
  dispose(): void;
}
```

`FrameGraph.frame()` opens one encoder, walks the nodes, and submits once.
A segmentation node, an optical-flow node or a matting node drops in beside
the depth node and inherits the encoder, the timing and the capability
reporting without touching anything else. That is what makes this many of
these in the same platform rather than a single depth hack.

## Timing

`writeTimestamp` on the command encoder was removed from the WebGPU spec.
Timestamps are written by the pass descriptor instead, so the graph hands
each node a `{ querySet, beginningOfPassWriteIndex, endOfPassWriteIndex }`
and the node puts it on its own pass. The resolve is copied to a mappable
buffer and read **one frame late**, on purpose — nothing in the render path
ever waits on it.

If the adapter will not grant `timestamp-query`, the overlay says
`no GPU timing` and prints no per-node number. It does not substitute wall
clock and call it GPU time.

## TypeGPU

`tgpu.initFromDevice({ device })` adopts the device the platform already
created, so typed WGSL and raw WebGPU share one device, one queue and one
encoder. Nothing here creates a second device.

---

# The depth model contract

The lighting is the easy half. The hard half is your network's weights and
tensor layout, which belong to you — this file only fixes **when it runs,
what it writes into, and that it never leaves the GPU.**

Implement `DepthModel` from `src/gpu/nodes/depth.ts`:

```ts
interface DepthModel {
  readonly info: {
    name: string;
    resolution: number;      // 448
    dispatches: number;      // ~250 — reported by you, displayed as-is
    source: string;          // where the weights came from
    kind: 'metric' | 'relative';
  };

  init(ctx: GpuContext): Promise<void>;

  encode(
    encoder: GPUCommandEncoder,
    input:   GPUTextureView,   // source frame, rgba8unorm
    output:  GPUTextureView,   // r16float storage, resolution², write-only
    stamps:  PassStamps | null,
  ): void;

  dispose(): void;
}
```

Rules for `encode`:

- Record only. **No `submit`, no `mapAsync`, no `await`.** You are inside
  the platform's encoder.
- Fill `output` with normalised depth where **near = 1, far = 0**. If your
  network is metric, normalise and set `kind: 'metric'` so the readout can
  say so.
- Put `stamps` on your first pass descriptor if you want your inference
  timed as one block, or ignore it and time your own sub-passes.
- Allocate every intermediate in `init`, not per frame.

Then:

```ts
await rig.useDepthModel(new YourDepthModel());
```

Nothing else in the graph changes. The lighting node is already reading
that texture view.

## What is running today

No model is loaded, so the depth node runs its proxy: one compute pass
deriving a stand-in from local contrast, aerial perspective and frame
geometry. It is **not an inference** and the overlay says `PROXY — no model
loaded` in red for as long as that is true.

## Not verified here

The build environment has no WebGPU adapter — `navigator.gpu` exists and
`requestAdapter()` returns null under software rendering. So the WebGPU
path in this repository is **type-checked and built, not run**. The
fallback is verified: without an adapter the bench says what is missing and
the rest of SOUP carries on unaffected on WebGL2.
