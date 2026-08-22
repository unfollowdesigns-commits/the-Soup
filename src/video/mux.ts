/* ============================================================
   MUXERS
   The encoder gives us compressed frames. Something has to put
   them in a file the rest of the world can open.

   Two containers, because no one browser gives you both:
     · MP4 / H.264 — what an editor wants
     · WebM / VP9  — what every browser can always make

   Both are written here rather than pulled in, so the lab has no
   opaque binary in its export path.
   ============================================================ */

/* ---- bytes ------------------------------------------------- */

/** every buffer in this file is backed by a plain ArrayBuffer */
export type Bytes = Uint8Array<ArrayBuffer>;

const cat = (parts: Uint8Array[]): Bytes => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const u8 = (...v: number[]) => Uint8Array.from(v);

function u16(...v: number[]) {
  const a = new Uint8Array(v.length * 2);
  const d = new DataView(a.buffer);
  v.forEach((x, i) => d.setUint16(i * 2, x));
  return a;
}

function u32(...v: number[]) {
  const a = new Uint8Array(v.length * 4);
  const d = new DataView(a.buffer);
  v.forEach((x, i) => d.setUint32(i * 4, x >>> 0));
  return a;
}

function i32(...v: number[]) {
  const a = new Uint8Array(v.length * 4);
  const d = new DataView(a.buffer);
  v.forEach((x, i) => d.setInt32(i * 4, x));
  return a;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/* ============================================================
   MP4
   Plain, not fragmented: the whole thing is in memory anyway, so
   a real sample table is both simpler to get right and opens in
   everything.
   ============================================================ */

function box(type: string, ...payload: Uint8Array[]): Bytes {
  const body = cat(payload);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(body, 8);
  return out;
}

function full(type: string, version: number, flags: number, ...payload: Uint8Array[]) {
  return box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...payload);
}

/** the identity matrix every mp4 carries around */
const MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

export interface Mp4Sample {
  size: number;
  key: boolean;
}

export function muxMp4(opts: {
  width: number;
  height: number;
  /** ticks per second */
  timescale: number;
  /** ticks each sample is on screen */
  delta: number;
  samples: Mp4Sample[];
  /** AVCDecoderConfigurationRecord from VideoEncoder */
  description: Uint8Array;
  data: Uint8Array;
}): Blob {
  const { width, height, timescale, delta, samples, description, data } = opts;
  const n = samples.length;
  const duration = n * delta;

  /* ---- ftyp ---- */
  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));

  /* ---- mdat ---- */
  // 64-bit length once the picture gets big enough to need it
  const big = data.length + 8 > 0xfffffff0;
  let mdat: Bytes;
  if (big) {
    mdat = new Uint8Array(16 + data.length);
    const d = new DataView(mdat.buffer);
    d.setUint32(0, 1);
    mdat.set(ascii('mdat'), 4);
    d.setBigUint64(8, BigInt(mdat.length));
    mdat.set(data, 16);
  } else {
    mdat = box('mdat', data);
  }
  const dataStart = ftyp.length + (big ? 16 : 8);

  /* ---- sample tables ---- */
  const stts = full('stts', 0, 0, u32(1), u32(n, delta));
  const syncs: number[] = [];
  samples.forEach((s, i) => s.key && syncs.push(i + 1));
  const stss = full('stss', 0, 0, u32(syncs.length), u32(...syncs));
  // one chunk holding every sample
  const stsc = full('stsc', 0, 0, u32(1), u32(1, n, 1));
  const stsz = full('stsz', 0, 0, u32(0, n), u32(...samples.map((s) => s.size)));
  const stco = full('stco', 0, 0, u32(1), u32(dataStart));

  const avcC = box('avcC', description);
  const name = new Uint8Array(32);
  const label = 'SOUP';
  name[0] = label.length;
  name.set(ascii(label), 1);
  const avc1 = box(
    'avc1',
    u8(0, 0, 0, 0, 0, 0),
    u16(1),                       /* data_reference_index */
    u16(0, 0),                    /* pre_defined, reserved */
    u32(0, 0, 0),                 /* pre_defined[3] */
    u16(width, height),
    u32(0x00480000, 0x00480000),  /* 72 dpi */
    u32(0),
    u16(1),                       /* frame_count */
    name,
    u16(0x0018),                  /* depth */
    i32(-1).slice(2),             /* pre_defined = -1, int16 */
    avcC,
  );
  const stsd = full('stsd', 0, 0, u32(1), avc1);
  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);

  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
  const minf = box('minf', full('vmhd', 0, 1, u16(0, 0, 0, 0)), dinf, stbl);
  const hdlr = full('hdlr', 0, 0, u32(0), ascii('vide'), u32(0, 0, 0), ascii('VideoHandler\0'));
  const mdhd = full('mdhd', 0, 0, u32(0, 0, timescale, duration), u16(0x55c4, 0));
  const mdia = box('mdia', mdhd, hdlr, minf);

  const tkhd = full(
    'tkhd',
    0,
    7,
    u32(0, 0, 1, 0, duration),   /* created, modified, id, reserved, duration */
    u32(0, 0),
    u16(0, 0, 0, 0),             /* layer, alt group, volume, reserved */
    MATRIX,
    u32(width << 16, height << 16),
  );
  const trak = box('trak', tkhd, mdia);
  const mvhd = full(
    'mvhd',
    0,
    0,
    u32(0, 0, timescale, duration, 0x00010000),
    u16(0x0100, 0),
    u32(0, 0),
    MATRIX,
    u32(0, 0, 0, 0, 0, 0),
    u32(2),
  );
  const moov = box('moov', mvhd, trak);

  return new Blob([ftyp, mdat, moov], { type: 'video/mp4' });
}

/* ============================================================
   WEBM
   EBML. Written with the segment size known, so the duration is
   real and the file seeks.
   ============================================================ */

/** EBML variable-size integer, used for element sizes */
function vint(value: number): Bytes {
  for (let len = 1; len <= 8; len++) {
    const max = 2 ** (7 * len) - 1;
    if (value < max) {
      const out = new Uint8Array(len);
      let v = value;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('element too large for EBML');
}

const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  EBMLVersion: [0x42, 0x86],
  EBMLReadVersion: [0x42, 0xf7],
  EBMLMaxIDLength: [0x42, 0xf2],
  EBMLMaxSizeLength: [0x42, 0xf3],
  DocType: [0x42, 0x82],
  DocTypeVersion: [0x42, 0x87],
  DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67],
  Info: [0x15, 0x49, 0xa9, 0x66],
  TimestampScale: [0x2a, 0xd7, 0xb1],
  MuxingApp: [0x4d, 0x80],
  WritingApp: [0x57, 0x41],
  Duration: [0x44, 0x89],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackEntry: [0xae],
  TrackNumber: [0xd7],
  TrackUID: [0x73, 0xc5],
  TrackType: [0x83],
  FlagLacing: [0x9c],
  DefaultDuration: [0x23, 0xe3, 0x83],
  CodecID: [0x86],
  CodecPrivate: [0x63, 0xa2],
  Video: [0xe0],
  PixelWidth: [0xb0],
  PixelHeight: [0xba],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  Timestamp: [0xe7],
  SimpleBlock: [0xa3],
};

function el(id: number[], ...payload: Uint8Array[]): Bytes {
  const body = cat(payload);
  return cat([Uint8Array.from(id), vint(body.length), body]);
}

function uint(v: number): Bytes {
  const bytes: number[] = [];
  let x = v;
  do {
    bytes.unshift(x & 0xff);
    x = Math.floor(x / 256);
  } while (x > 0);
  return Uint8Array.from(bytes);
}

function f64(v: number): Bytes {
  const a = new Uint8Array(8);
  new DataView(a.buffer).setFloat64(0, v);
  return a;
}

export interface WebmFrame {
  data: Uint8Array;
  /** microseconds */
  timestamp: number;
  key: boolean;
}

const WEBM_CODEC: Record<string, string> = {
  vp8: 'V_VP8',
  vp09: 'V_VP9',
  av01: 'V_AV1',
};

export function muxWebm(opts: {
  width: number;
  height: number;
  /** codec family: vp8 | vp09 | av01 */
  family: string;
  /** nanoseconds each frame is on screen */
  frameNs: number;
  frames: WebmFrame[];
  description?: Uint8Array;
}): Blob {
  const { width, height, family, frameNs, frames, description } = opts;
  const codec = WEBM_CODEC[family];
  if (!codec) throw new Error(`no WebM mapping for ${family}`);

  const header = el(
    ID.EBML,
    el(ID.EBMLVersion, uint(1)),
    el(ID.EBMLReadVersion, uint(1)),
    el(ID.EBMLMaxIDLength, uint(4)),
    el(ID.EBMLMaxSizeLength, uint(8)),
    el(ID.DocType, ascii('webm')),
    el(ID.DocTypeVersion, uint(2)),
    el(ID.DocTypeReadVersion, uint(2)),
  );

  const durMs = (frames.length * frameNs) / 1e6;
  const info = el(
    ID.Info,
    el(ID.TimestampScale, uint(1000000)), /* one tick = one millisecond */
    el(ID.MuxingApp, ascii('SOUP')),
    el(ID.WritingApp, ascii('SOUP')),
    el(ID.Duration, f64(durMs)),
  );

  const track = el(
    ID.TrackEntry,
    el(ID.TrackNumber, uint(1)),
    el(ID.TrackUID, uint(1)),
    el(ID.TrackType, uint(1)),
    el(ID.FlagLacing, uint(0)),
    el(ID.DefaultDuration, uint(Math.round(frameNs))),
    el(ID.CodecID, ascii(codec)),
    ...(description ? [el(ID.CodecPrivate, description)] : []),
    el(ID.Video, el(ID.PixelWidth, uint(width)), el(ID.PixelHeight, uint(height))),
  );
  const tracks = el(ID.Tracks, track);

  /* ---- clusters: a new one on every key frame, and never longer
     than a couple of seconds so seeking stays cheap ---- */
  const clusters: Bytes[] = [];
  let i = 0;
  while (i < frames.length) {
    const base = Math.round(frames[i].timestamp / 1000); /* ms */
    const blocks: Bytes[] = [];
    do {
      const f = frames[i];
      const rel = Math.round(f.timestamp / 1000) - base;
      const head = new Uint8Array(4);
      head[0] = 0x81;                       /* track 1, as a 1-byte vint */
      new DataView(head.buffer).setInt16(1, rel);
      head[3] = f.key ? 0x80 : 0x00;        /* keyframe flag */
      blocks.push(el(ID.SimpleBlock, head, f.data));
      i++;
    } while (
      i < frames.length &&
      !frames[i].key &&
      frames[i].timestamp - frames[i - 1].timestamp < 32000 * 1000 &&
      Math.round(frames[i].timestamp / 1000) - base < 32000
    );
    clusters.push(el(ID.Cluster, el(ID.Timestamp, uint(base)), ...blocks));
  }

  const segment = el(ID.Segment, info, tracks, ...clusters);
  return new Blob([header, segment], { type: 'video/webm' });
}

/* ------------------------------------------------------------
   Which container a codec string belongs in.
   ------------------------------------------------------------ */
export const familyOf = (codec: string) => codec.split('.')[0].replace(/^avc1$/, 'avc');
export const containerOf = (codec: string) => (familyOf(codec) === 'avc' ? 'mp4' : 'webm');
