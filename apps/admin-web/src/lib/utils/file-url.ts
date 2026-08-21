import { FILE_SERVICE_BASE_URL } from '@/const/api-const';

/**
 * file-service 가 파생본을 제공하는 변형 파라미터.
 * width 는 서버 화이트리스트와 같은 값만 허용된다 (그 외는 400).
 */
export interface PublicFileVariant {
  format: 'webp';
  width?: 320 | 640 | 1024 | 1600;
}

/**
 * fileId(UUID) 를 file-service public 이미지 URL 로 변환.
 * 이미 절대 URL(http/https) 이면 그대로 통과 (Medusa CDN 등) — variant 도 붙이지 않는다.
 * 빈 값이면 null.
 */
export function resolvePublicFileUrl(
  fileId: string | null | undefined,
  variant?: PublicFileVariant
): string | null {
  if (!fileId) return null;
  if (fileId.startsWith('http://') || fileId.startsWith('https://')) {
    return fileId;
  }
  const query = variant
    ? `?format=${variant.format}${variant.width !== undefined ? `&width=${variant.width}` : ''}`
    : '';
  return `${FILE_SERVICE_BASE_URL}/files/public/${fileId}${query}`;
}
