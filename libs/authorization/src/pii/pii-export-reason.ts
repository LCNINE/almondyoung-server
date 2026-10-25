import { BadRequestException } from '@nestjs/common';

export const PII_EXPORT_REASON_MIN = 5;
export const PII_EXPORT_REASON_MAX = 200;

/**
 * `X-Pii-Export-Reason` 헤더(URL 인코딩)를 읽어 사유를 돌려준다. 5~200자가 아니거나 인코딩이 깨졌으면 400.
 * 인터셉터(응답을 가리기 직전)와 «쓰기 전에 사유를 봐야 하는» 라우트가 같은 함수를 부른다.
 */
export function readPiiExportReason(encoded: string | null): string {
  let reason = '';
  try {
    reason = encoded === null ? '' : decodeURIComponent(encoded).trim();
  } catch {
    reason = '';
  }
  if (reason.length < PII_EXPORT_REASON_MIN || reason.length > PII_EXPORT_REASON_MAX) {
    throw new BadRequestException(
      `개인정보 내보내기 사유를 ${PII_EXPORT_REASON_MIN}~${PII_EXPORT_REASON_MAX}자로 입력하세요`,
    );
  }
  return reason;
}
