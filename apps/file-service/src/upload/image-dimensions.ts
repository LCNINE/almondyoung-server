import * as probe from 'probe-image-size';

/** 공모전에서 허용하는 래스터 형식의 실제 픽셀 크기만 읽는다. */
export function imageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) return null;

  try {
    const result = probe.sync(buffer);
    return result?.mime === mimeType && result.width > 0 && result.height > 0
      ? { width: result.width, height: result.height }
      : null;
  } catch {
    return null;
  }
}
