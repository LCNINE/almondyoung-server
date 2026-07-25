import { ConflictError } from './httpClient';

/** 같은 상태 코드라도 화면 문맥에 따라 현장에 필요한 문구가 다르다. */
export type ErrorContext =
  | 'barcode'
  | 'location'
  | 'stocktaking'
  | 'movement'
  | 'inbound'
  | 'inbound-cancel';

const CONTEXTUAL: Record<ErrorContext, Partial<Record<number, string>>> = {
  barcode: { 404: '등록되지 않은 바코드예요.' },
  location: { 404: '로케이션을 찾을 수 없어요.' },
  stocktaking: { 400: '실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.' },
  movement: { 400: '출발지 재고가 부족해요. 다시 확인해 주세요.' },
  inbound: { 400: '입고기본존 재고가 부족해요. 새로고침 후 확인해 주세요.' },
  // 취소는 서버가 "적치 존재"·"당일 아님"·"전량 아님"을 모두 400 으로 낸다.
  // 현장에서 실제로 부딪히는 건 앞의 둘이고, 앱은 전량만 보내므로 셋째는 안 난다.
  'inbound-cancel': { 400: '이미 적치했거나 오늘 입고분이 아니라 취소할 수 없어요.' },
};

export function errorMessage(error: unknown, context?: ErrorContext): string {
  if (error instanceof ConflictError) {
    return '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.';
  }
  if (error instanceof Error) {
    const match = /→\s*(\d{3})/.exec(error.message);
    const status = match ? Number(match[1]) : undefined;
    if (status === 401 || status === 403) return '권한이 없어요. 다시 로그인해 주세요.';
    if (status !== undefined && status >= 500) {
      return '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';
    }
    if (status !== undefined && context) {
      const specific = CONTEXTUAL[context][status];
      if (specific) return specific;
    }
    if (status === 404) return '찾을 수 없어요.';
    if (status === 400) return '요청이 올바르지 않아요.';
  }
  return '알 수 없는 오류가 발생했어요.';
}
