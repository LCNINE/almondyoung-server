/**
 * 업로드 전에 브라우저에서 이미지를 줄인다.
 *
 * 업로드는 admin-web 의 프록시 라우트를 거치는데, 이 라우트가 Lambda 위에서 돌아
 * 요청 본문이 6MB 를 넘으면 file-service 에 닿기도 전에 413 으로 끊긴다. file_contexts
 * 는 10MB 를 허용하고 있어 6~10MB 구간이 "설정상 되는데 실제로는 안 되는" 사각지대였다.
 * 관리자가 폰 사진을 그대로 올리면 이 구간에 쉽게 들어간다.
 *
 * 겸사겸사 고객 쪽 로딩도 줄어든다 — 팝업·배너 이미지는 원본이 그대로 방문자에게 전송된다.
 */

/** 프록시(Lambda)가 받아줄 수 있는 상한. 6MB 한계에 multipart·인코딩 여유를 뺀 값. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** 이보다 크면 화면에 필요한 것보다 크다고 보고 줄인다. */
export const COMPRESS_OVER_BYTES = 2 * 1024 * 1024;

/** 긴 변 기준 축소 목표. 팝업은 460~700px, 배너도 이보다 작게 노출된다. */
export const MAX_EDGE = 1600;

const QUALITY = 0.85;

/** 애니메이션(GIF)과 벡터(SVG)는 캔버스로 다시 그리면 망가지므로 손대지 않는다. */
export function isCompressible(type: string): boolean {
  return type.startsWith('image/') && type !== 'image/gif' && type !== 'image/svg+xml';
}

export function shouldCompress(input: { type: string; size: number; longestEdge: number }): boolean {
  if (!isCompressible(input.type)) return false;
  return input.longestEdge > MAX_EDGE || input.size > COMPRESS_OVER_BYTES;
}

/** 비율을 유지하면서 긴 변을 MAX_EDGE 에 맞춘다. 이미 작으면 그대로 둔다. */
export function scaledSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function toWebpName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '') + '.webp';
}

export type CompressResult = {
  file: File;
  /** 실제로 줄였는지. 원본을 그대로 쓰면 false */
  compressed: boolean;
  originalBytes: number;
};

/**
 * 필요할 때만 줄인다. 줄이는 데 실패하거나 결과가 원본보다 크면 원본을 그대로 쓴다 —
 * 압축은 부가 기능이라 여기서 실패해도 업로드 자체를 막지 않는다.
 */
export async function compressImageForUpload(file: File): Promise<CompressResult> {
  const originalBytes = file.size;
  const unchanged: CompressResult = { file, compressed: false, originalBytes };

  if (!isCompressible(file.type) || typeof createImageBitmap !== 'function') return unchanged;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return unchanged;

  try {
    if (!shouldCompress({ type: file.type, size: originalBytes, longestEdge: Math.max(bitmap.width, bitmap.height) })) {
      return unchanged;
    }

    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return unchanged;
    ctx.drawImage(bitmap, 0, 0, width, height);

    // webp 는 투명도를 유지하면서 jpeg 수준으로 작아진다.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY));
    if (!blob || blob.size >= originalBytes) return unchanged;

    return {
      file: new File([blob], toWebpName(file.name), { type: 'image/webp', lastModified: file.lastModified }),
      compressed: true,
      originalBytes,
    };
  } finally {
    bitmap.close();
  }
}
