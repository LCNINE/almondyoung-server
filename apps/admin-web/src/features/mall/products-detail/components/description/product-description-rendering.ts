export const PRODUCT_FILE_URL_PREFIX = 'product-file:';

const SAFE_URL_PROTOCOL_RE = /^(https?|ircs?|mailto|xmpp)$/i;

function defaultSafeUrlTransform(value: string): string {
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_URL_PROTOCOL_RE.test(value.slice(0, colon))
  ) {
    return value;
  }

  return '';
}

export function productDescriptionUrlTransform(
  value: string,
  key?: string
): string {
  if (key === 'src' && value.startsWith(PRODUCT_FILE_URL_PREFIX)) {
    return value;
  }

  return defaultSafeUrlTransform(value);
}

type ProductDescriptionImagePlaceholderInput = {
  fileId: string | null;
  alt: string;
  error?: string | null;
  broken?: boolean;
};

export function getProductDescriptionImagePlaceholderText({
  fileId,
  alt,
  error,
  broken,
}: ProductDescriptionImagePlaceholderInput): string {
  const diagnostics = [error, broken ? 'image_load_failed' : null].filter(
    (value): value is string => Boolean(value)
  );

  return [
    `이미지를 불러올 수 없습니다${fileId ? `: ${fileId}` : ''}`,
    diagnostics.length > 0 ? `[${diagnostics.join(', ')}]` : '',
    alt ? `(${alt})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
