import type { Specimen } from './types';

/* ============================================================
   THE CAMERA
   One way in, so every bench that wants live capture opens it the
   same way instead of each growing its own.
   ============================================================ */

export class CameraError extends Error {
  readonly kind: 'unsupported' | 'refused' | 'missing' | 'insecure' | 'failed';
  constructor(kind: CameraError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export async function openCamera(facing: 'environment' | 'user' = 'environment'): Promise<Specimen> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'This browser will not hand over a camera.');
  }
  if (!window.isSecureContext) {
    throw new CameraError('insecure', 'A camera needs https or localhost. This page is neither.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error('no signal'));
    });
    await video.play();
    return {
      id: `cam-${Date.now().toString(36)}`,
      name: 'Camera',
      source: 'camera',
      kind: 'moving',
      width: video.videoWidth,
      height: video.videoHeight,
      bitmap: video,
      video,
      stream,
      importedAt: Date.now(),
      note: 'Live. Every look runs on it frame by frame.',
    };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError') {
      throw new CameraError('refused', 'The camera was refused. Allow it in the address bar and try again.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CameraError('missing', 'No camera on this machine.');
    }
    throw new CameraError('failed', 'The camera would not open.');
  }
}
