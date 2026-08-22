import type { Specimen } from './types';

/* ============================================================
   INTAKE
   One way in. A file becomes a specimen here and nowhere else,
   so the dropzone, the file button and a drop anywhere on the
   window all behave identically.

   Nothing leaves the machine: the file is decoded locally and
   handed straight to the engine.
   ============================================================ */

export const INTAKE_ACCEPT = 'image/*,video/*';

export class IntakeError extends Error {}

const STILL = /\.(jpe?g|png|webp|avif|gif|bmp)$/i;
const MOVING = /\.(mp4|webm|mov|m4v|ogv)$/i;

/** Some browsers hand over an empty `type` for dragged files. */
function kindOf(file: File): 'still' | 'moving' | null {
  if (file.type.startsWith('video/')) return 'moving';
  if (file.type.startsWith('image/')) return 'still';
  if (MOVING.test(file.name)) return 'moving';
  if (STILL.test(file.name)) return 'still';
  return null;
}

export function canRead(file: File): boolean {
  return kindOf(file) !== null;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'Untitled';

export async function openFile(file: File): Promise<Specimen> {
  const kind = kindOf(file);
  if (!kind) {
    throw new IntakeError(
      'That is not something the lab can read. Try a JPEG, PNG, WebP or MP4.',
    );
  }

  if (kind === 'moving') {
    // a moving specimen goes through exactly the same engine, one frame
    // at a time
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    try {
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error('decode'));
      });
    } catch {
      URL.revokeObjectURL(video.src);
      throw new IntakeError('That clip could not be decoded. Try an MP4 or WebM.');
    }
    await video.play().catch(() => undefined);
    return {
      id: `sp-${Date.now().toString(36)}`,
      name: stem(file.name),
      source: 'imported',
      kind: 'moving',
      width: video.videoWidth,
      height: video.videoHeight,
      bitmap: video,
      video,
      duration: video.duration,
      importedAt: Date.now(),
      fileSize: file.size,
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new IntakeError('The file could not be decoded. Try a JPEG, PNG or WebP.');
  }
  return {
    id: `sp-${Date.now().toString(36)}`,
    name: stem(file.name),
    source: 'imported',
    kind: 'still',
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
    importedAt: Date.now(),
    fileSize: file.size,
  };
}

/** The first thing in a drop that the lab can actually read. */
export function pickFile(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  const files = Array.from(dt.files ?? []);
  return files.find(canRead) ?? files[0] ?? null;
}

/** True when a drag is carrying files rather than text or a selection. */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (dt.items && dt.items.length) {
    return Array.from(dt.items).some((i) => i.kind === 'file');
  }
  return Array.from(dt.types ?? []).includes('Files');
}
