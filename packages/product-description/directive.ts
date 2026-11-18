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
