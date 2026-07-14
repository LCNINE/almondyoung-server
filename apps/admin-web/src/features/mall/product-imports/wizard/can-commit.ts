import type { ValidatePreviewDto } from '@/lib/types/dto/product-import';

/**
 * 커밋 게이팅: invalid 행이 0 개이고 등록할 유효 행이 1개 이상일 때만 커밋 허용.
 * (invalid 행이 있으면 파일 수정 → 재검증을 강제한다.)
 */
export function canCommit(
  preview: ValidatePreviewDto | null | undefined
): boolean {
  if (!preview) return false;
  return preview.totalRows > 0 && preview.invalidCount === 0;
}
