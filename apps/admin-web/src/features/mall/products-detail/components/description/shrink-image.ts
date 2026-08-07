/**
 * 업로드 전에 브라우저에서 이미지를 줄인다.
 *
 * Claude API 는 8000x8000px 를 넘는 이미지를 거부한다(400). 상품 상세 이미지는 세로로
 * 아주 길어(예: 860x12000) 이 한도를 쉽게 넘는다. 서버(sharp)에서 줄이려 했으나
 * OpenNext 가 sharp 를 Lambda server 번들에서 빼기 때문에 런타임에 `Cannot find
 * module 'sharp'` 로 죽는다 — 그래서 리사이즈를 클라이언트로 옮겼다.
 *
 * createImageBitmap 의 resize 옵션을 쓰는 이유: canvas 는 브라우저별 최대 치수·면적
 * 제한이 있어서 12000px 짜리를 원본 그대로 그리면 빈 이미지가 나올 수 있다. 디코드
 * 단계에서 줄이면 그 한계를 건드리지 않는다.
 */
export const MAX_AI_IMAGE_EDGE = 2000;

export async function shrinkImageForAi(
  file: File,
  maxEdge: number = MAX_AI_IMAGE_EDGE
): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file;

  let probe: ImageBitmap;
  try {
    probe = await createImageBitmap(file);
  } catch {
    // 디코드 실패(손상·미지원 형식)는 여기서 판정하지 않는다 — 서버가 형식을 검사한다.
    return file;
  }

  const longest = Math.max(probe.width, probe.height);
  if (longest <= maxEdge) {
    probe.close();
    return file;
  }

  const scale = maxEdge / longest;
  const width = Math.max(1, Math.round(probe.width * scale));
  const height = Math.max(1, Math.round(probe.height * scale));
  probe.close();

  const bitmap = await createImageBitmap(file, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'high',
  });

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  );
  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
