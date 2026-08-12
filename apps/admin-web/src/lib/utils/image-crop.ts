/**
 * 업로드 전에 이미지에서 쓸 영역만 잘라낸다.
 *
 * 배너 슬롯은 `object-cover` 라 비율이 다른 이미지를 넣으면 중앙만 남기고 잘린다.
 * AI 생성기는 3:2 가 가장 가로로 긴 출력이라 그보다 납작한 슬롯에서는 항상 상하가
 * 잘리는데, 어디를 남길지는 이미지마다 다르다 (로고가 위에 있으면 위를 살려야 한다).
 * 그래서 잘라낼 영역을 사람이 직접 정하게 하고, 여기서는 그 영역만 그려낸다.
 */

/** react-easy-crop 이 돌려주는 원본 픽셀 기준 영역 */
export type CropArea = { x: number; y: number; width: number; height: number };

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = src;
  });
}

/**
 * 영역이 원본 전체를 덮는지. 덮으면 다시 인코딩할 이유가 없다 — 재인코딩은 화질만 깎는다.
 * 크롭 라이브러리가 소수점을 돌려주므로 1px 오차는 같은 것으로 본다.
 */
export function coversWholeImage(
  area: CropArea,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  return (
    area.x <= 1 &&
    area.y <= 1 &&
    area.width >= sourceWidth - 1 &&
    area.height >= sourceHeight - 1
  );
}

const CROP_QUALITY = 0.92;

/** 잘라낸 영역만 담은 새 File. 잘라낼 게 없으면 원본을 그대로 돌려준다. */
export async function cropImageToArea(file: File, area: CropArea): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);

    if (coversWholeImage(area, img.naturalWidth, img.naturalHeight)) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(area.width);
    canvas.height = Math.round(area.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(
      img,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', CROP_QUALITY),
    );
    if (!blob) return file;

    return new File([blob], file.name.replace(/\.[^./\\]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
