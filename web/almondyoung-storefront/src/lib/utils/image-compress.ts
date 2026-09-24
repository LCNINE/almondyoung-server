/**
 * 업로드 전에 브라우저에서 이미지를 무손실 webp 로 변환한다.
 *
 * admin-web(`apps/admin-web/src/lib/utils/image-compress.ts`)에서 그대로 옮겨왔다 — 회원
 * 업로드도 같은 Lambda 프록시(`uploadFile` 서버 액션)를 거쳐, 요청 본문이 상한을 넘으면
 * file-service 에 닿기도 전에 413 으로 끊긴다. 폰으로 찍은 사진은 이 구간에 쉽게 들어간다.
 *
 * 변환은 조건 없이 모든 이미지에 적용한다(포맷 통일 방침). 화질 훼손이 없도록
 * 무손실 인코딩만 쓰고, 크기는 리사이즈로만 줄인다.
 */

/**
 * 프록시(Lambda)가 받아줄 수 있는 상한. 6MB 한계에 multipart·인코딩 여유를 뺀 값.
 * 변환 뒤에도 이 값을 넘으면 업로드를 포기하고 사용자에게 더 작은 사진을 고르라고 안내한다.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/** 긴 변 기준 축소 목표. */
export const MAX_EDGE = 1600

/**
 * canvas.toBlob 의 webp 인코딩은 quality 가 1 이면 무손실(VP8L), 1 미만이면
 * 손실(VP8)이다. 화질 훼손 없이 포맷만 통일하는 방침이라 무손실만 쓴다 —
 * 손실 인코딩 경로를 새로 만들지 말 것.
 */
export const WEBP_LOSSLESS_QUALITY = 1

/** 애니메이션(GIF)과 벡터(SVG)는 캔버스로 다시 그리면 망가지므로 손대지 않는다. */
export function isCompressible(type: string): boolean {
  return type.startsWith("image/") && type !== "image/gif" && type !== "image/svg+xml"
}

/** 비율을 유지하면서 기준 변을 maxEdge 에 맞춘다. 이미 작으면 그대로 둔다. */
export function scaledSize(
  width: number,
  height: number,
  opts: { maxEdge?: number; measure?: "longest" | "width" } = {}
): { width: number; height: number } {
  const { maxEdge = MAX_EDGE, measure = "longest" } = opts
  const base = measure === "width" ? width : Math.max(width, height)
  const scale = Math.min(1, maxEdge / base)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function toWebpName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "") + ".webp"
}

export type CompressResult = {
  file: File
  /** 실제로 변환했는지. 원본을 그대로 쓰면 false */
  compressed: boolean
  originalBytes: number
}

export type CompressOptions = {
  /**
   * 축소 기준 변. 세로로 긴 이미지는 'width' 로 두어야 긴 변(세로) 기준 축소로
   * 가로 해상도가 뭉개지는 걸 막는다.
   */
  measure?: "longest" | "width"
  maxEdge?: number
}

/**
 * 이미지를 무손실 webp 로 변환한다. 기준 변이 maxEdge 를 넘으면 리사이즈도 한다.
 *
 * 변환에 실패하면(HEIC 등 브라우저가 못 여는 포맷, toBlob 미지원) 원본을 그대로
 * 쓴다 — 변환은 부가 기능이라 여기서 실패해도 업로드 자체를 막지 않는다.
 *
 * 무손실 webp 가 원본(주로 손실 JPEG)보다 커지는 사진도 원본을 그대로 쓴다.
 * "가볍게 만들자"는 취지에서 파일을 키우는 변환은 업로드 상한과 페이지 무게
 * 양쪽에 다 손해라서다. 이 경우 포맷은 통일되지 않는다.
 */
export async function compressImageForUpload(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
  const { measure = "longest", maxEdge = MAX_EDGE } = opts
  const originalBytes = file.size
  const unchanged: CompressResult = { file, compressed: false, originalBytes }

  if (!isCompressible(file.type) || typeof createImageBitmap !== "function") return unchanged

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return unchanged

  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, { maxEdge, measure })
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext("2d")
    if (!ctx) return unchanged
    ctx.drawImage(bitmap, 0, 0, width, height)

    // webp 는 무손실에서도 투명도(알파)를 유지한다.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_LOSSLESS_QUALITY)
    )
    if (!blob || blob.size >= originalBytes) return unchanged

    return {
      file: new File([blob], toWebpName(file.name), { type: "image/webp", lastModified: file.lastModified }),
      compressed: true,
      originalBytes,
    }
  } finally {
    bitmap.close()
  }
}
