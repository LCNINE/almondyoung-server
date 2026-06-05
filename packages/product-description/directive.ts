export const PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID = 'product-description-image';
export const PRODUCT_IMAGE_DIRECTIVE_NAME = 'product-image';

export type ProductImageDirectiveNode = {
  type?: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
};

export type ProductImageReference = {
  fileId: string;
  alt: string;
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
  return {
    ok: true,
    fileId,
    alt: typeof alt === 'string' ? alt : '',
  };
}

function escapeDirectiveAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function createProductImageDirective({ fileId, alt }: ProductImageReference): string {
  const escapedAlt = escapeDirectiveAttr(alt);
  return `::${PRODUCT_IMAGE_DIRECTIVE_NAME}{fileId="${fileId}" alt="${escapedAlt}"}`;
}
