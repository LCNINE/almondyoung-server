// 서버 `readPiiExportReason`(libs/authorization) 과 같은 범위 — 넘김은 서버도 쓰기 전에 본다(N4)
export const EXPORT_REASON_MIN = 5;
export const EXPORT_REASON_MAX = 200;

export const EXPORT_REASON_MESSAGE = '사유를 5~200자로 적어 주세요.';

export function exportReasonError(reason: string): string | null {
  const length = reason.trim().length;
  return length < EXPORT_REASON_MIN || length > EXPORT_REASON_MAX ? EXPORT_REASON_MESSAGE : null;
}
