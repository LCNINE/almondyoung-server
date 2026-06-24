import { FILE_SERVICE_BASE_URL } from '@/const/api-const';

/**
 * fileId(UUID) 를 file-service public 이미지 URL 로 변환.
 * 이미 절대 URL(http/https) 이면 그대로 통과 (Medusa CDN 등).
 * 빈 값이면 null.
 */
export function resolvePublicFileUrl(
  fileId: string | null | undefined
): string | null {
  if (!fileId) return null;
  if (fileId.startsWith('http://') || fileId.startsWith('https://')) {
    return fileId;
  }
  return `${FILE_SERVICE_BASE_URL}/files/public/${fileId}`;
}
