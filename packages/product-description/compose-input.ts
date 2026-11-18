import { createProductImageDirective, formatImageCrop, isProductImageFileId, parseImageCrop } from './directive';

/**
 * 작성 단계 모델에게 넘길 이미지 한 장. directive·attrs 는 서버가 만든다 — 클라이언트가 보낸 문자열을
 * 그대로 본문에 넣으면 어떤 값이든 상세설명에 심을 수 있다.
 *
 * 입력은 HTTP 로 받은 추출 결과라 타입을 믿지 않는다(DTO 는 result 가 객체인지만 본다).
 * 모양이 틀린 이미지는 통째로, 틀린 영역·크기는 그것만 버린다 — 영역은 부가 정보라 요청을 실패시키지 않는다.
 */
export type ComposeImageInput = {
  kind: string;
  content: string;
  px?: string;
  directive: string;
  attrs: string;
  regions: { label: string; px?: string; directive: string; attrs: string }[];
};

export function toComposeImages(images: unknown): ComposeImageInput[] {
  if (!Array.isArray(images)) return [];

  return images.flatMap((image) => {
    if (!isRecord(image) || !isProductImageFileId(image.fileId)) return [];

    const fileId = image.fileId;
    const size = readSize(image.size);
    const regions = Array.isArray(image.regions) ? image.regions.flatMap((region) => toComposeRegion(fileId, size, region)) : [];

    return [
      {
        kind: typeof image.kind === 'string' ? image.kind : '기타',
        content: typeof image.content === 'string' ? image.content : '',
        ...(size ? { px: `${size.width}×${size.height}` } : {}),
        directive: createProductImageDirective({ fileId, alt: '' }),
        attrs: `fileId="${fileId}"`,
        regions,
      },
    ];
  });
}

function toComposeRegion(fileId: string, size: { width: number; height: number } | undefined, region: unknown) {
  if (!isRecord(region) || typeof region.label !== 'string' || !region.label.trim()) return [];

  const crop = parseImageCrop([region.x, region.y, region.w, region.h].map(String).join(','));
  if (!crop) return [];

  const px = size ? `${Math.round(crop.w * size.width)}×${Math.round(crop.h * size.height)}` : undefined;

  return [
    {
      label: region.label.trim(),
      ...(px ? { px } : {}),
      directive: createProductImageDirective({ fileId, alt: '', crop }),
      attrs: `fileId="${fileId}" crop="${formatImageCrop(crop)}"`,
    },
  ];
}

function readSize(value: unknown): { width: number; height: number } | undefined {
  if (!isRecord(value)) return undefined;

  const { width, height } = value;
  const valid = typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0;

  return valid && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
