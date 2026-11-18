export const PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID = 'product-description-image';
export const PRODUCT_IMAGE_DIRECTIVE_NAME = 'product-image';

export type ProductImageDirectiveNode = {
  type?: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
};

/** 원본 이미지에서 보여 줄 영역. 이미지 폭·높이에 대한 0~1 비율이다. */
export type ImageCrop = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ProductImageReference = {
  fileId: string;
  alt: string;
  crop?: ImageCrop;
};

export type ProductImageDirectiveParseResult =
  | ({ ok: true } & ProductImageReference)
  | {
      ok: false;
      reason: 'not_product_image_directive' | 'missing_file_id' | 'invalid_file_id';
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProductImageFileId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function parseProductImageDirective(node: ProductImageDirectiveNode): ProductImageDirectiveParseResult {
  if (node.name !== PRODUCT_IMAGE_DIRECTIVE_NAME) {
    return { ok: false, reason: 'not_product_image_directive' };
  }

  const fileId = node.attributes?.fileId;
  if (typeof fileId !== 'string' || fileId.trim().length === 0) {
    return { ok: false, reason: 'missing_file_id' };
  }

  if (!UUID_RE.test(fileId)) {
    return { ok: false, reason: 'invalid_file_id' };
  }

  const alt = node.attributes?.alt;
  const crop = parseImageCrop(node.attributes?.crop);

  return {
    ok: true,
    fileId,
    alt: typeof alt === 'string' ? alt : '',
    ...(crop ? { crop } : {}),
  };
}

/** 잘못된 crop 은 버리고 원본 전체를 보여 준다 — 이미지까지 버릴 이유는 없다. */
export function parseImageCrop(value: unknown): ImageCrop | undefined {
  if (typeof value !== 'string') return undefined;

  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;

  const [x, y, w, h] = parts;
  const inRange = x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001;

  return inRange ? { x, y, w, h } : undefined;
}

/**
 * 칸보다 이 배수 넘게 세로로 길면 "같은 대상이 두 줄 이상 잡힌 영역"으로 본다. 네일 칩 하나는 칸(3:5)
 * 비율과 큰 차이가 없고, 칩 두 줄을 한꺼번에 잡은 영역은 칸의 두 배 가까이 길다(2026-11-18 실측 2.07배).
 */
const STACKED_TARGET_RATIO = 1.6;

/**
 * 격자 칸(예: 3:4)에 맞게 crop 비율을 맞춘다. aspect 와 결과는 픽셀 기준 가로/세로 비율이다 —
 * 0~1 비율 crop 은 원본 크기를 알아야 실제 비율이 정해진다.
 * - 대상이 두 줄 이상 잡힐 만큼 세로로 길면(STACKED_TARGET_RATIO) 위쪽을 기준으로 세로를 줄여 첫 대상만 남긴다.
 *   가로를 넓히면 옆 대상까지 딸려 들어온다.
 * - 그 밖에는 영역을 자르지 않고 모자란 쪽 변을 넓혀 칸 비율에 맞춘다. 중심은 지키고, 원본 밖으로 나가면
 *   안쪽으로 밀며, 원본이 칸 비율을 못 담으면 다른 변을 줄인다.
 */
export function fitCropToAspect(crop: ImageCrop, imageWidth: number, imageHeight: number, aspect: number): ImageCrop {
  const width = crop.w * imageWidth;
  const height = crop.h * imageHeight;

  if (aspect / (width / height) > STACKED_TARGET_RATIO) {
    return { ...crop, h: width / aspect / imageHeight };
  }

  let fittedWidth = Math.max(width, height * aspect);
  let fittedHeight = fittedWidth / aspect;

  if (fittedWidth > imageWidth) {
    fittedWidth = imageWidth;
    fittedHeight = fittedWidth / aspect;
  }

  if (fittedHeight > imageHeight) {
    fittedHeight = imageHeight;
    fittedWidth = fittedHeight * aspect;
  }

  const centerX = (crop.x + crop.w / 2) * imageWidth;
  const centerY = (crop.y + crop.h / 2) * imageHeight;
  const left = Math.min(Math.max(centerX - fittedWidth / 2, 0), imageWidth - fittedWidth);
  const top = Math.min(Math.max(centerY - fittedHeight / 2, 0), imageHeight - fittedHeight);

  return { x: left / imageWidth, y: top / imageHeight, w: fittedWidth / imageWidth, h: fittedHeight / imageHeight };
}

export function formatImageCrop({ x, y, w, h }: ImageCrop): string {
  return [x, y, w, h].map((n) => Number(n.toFixed(4))).join(',');
}

function escapeDirectiveAttr(value: string): string {
  return value.replace(/[&"<>]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return char;
    }
  });
}

export function createProductImageDirective({ fileId, alt, crop }: ProductImageReference): string {
  const escapedAlt = escapeDirectiveAttr(alt);
  const cropAttr = crop ? ` crop="${formatImageCrop(crop)}"` : '';

  return `::${PRODUCT_IMAGE_DIRECTIVE_NAME}{fileId="${fileId}" alt="${escapedAlt}"${cropAttr}}`;
}
