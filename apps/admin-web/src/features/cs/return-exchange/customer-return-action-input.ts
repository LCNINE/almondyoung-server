/**
 * 반품 CS 대화상자 입력 판정 (K8 PR7). 콤마·공백은 허용하고 정수만 받는다.
 * 실패하면 null — 호출한 쪽이 «제출 불가»로 다룬다.
 */
function parseInteger(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/** 보류 차감액·이미 환불한 금액: 0 이상 정수 */
export function parseNonNegativeAmount(text: string): number | null {
  return parseInteger(text);
}

/** 선환불 금액: 1 이상 `max`(미리보기 품목 값) 이하 정수. max 를 모르면(미리보기 전) 거절 */
export function parsePrepayAmount(text: string, max: number | undefined): number | null {
  if (max === undefined) return null;
  const n = parseInteger(text);
  return n !== null && n >= 1 && n <= max ? n : null;
}

/** 메모는 앞뒤 공백을 떼고 비면 거절 */
export function requiredMemo(text: string): string | null {
  const t = text.trim();
  return t ? t : null;
}
