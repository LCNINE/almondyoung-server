import { scan, Format } from '@tauri-apps/plugin-barcode-scanner';
import { platform } from '@tauri-apps/plugin-os';
import type { ScanEvent } from './ScanProvider';

export class CameraUnsupportedError extends Error {
  constructor() {
    super('Camera scanning is not supported on this platform');
    this.name = 'CameraUnsupportedError';
  }
}

/**
 * Opens the native camera scanner and emits the first successful read into the
 * shared scan bus. Android only in Phase 0; desktop throws.
 */
export async function scanWithCamera(
  emit: (e: ScanEvent) => void
): Promise<void> {
  if (platform() !== 'android') throw new CameraUnsupportedError();
  const result = await scan({
    windowed: false,
    formats: [Format.QRCode, Format.EAN13, Format.Code128],
  });
  emit({ code: result.content, source: 'camera', at: Date.now() });
}
