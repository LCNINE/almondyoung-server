import { ApiError, ConflictError } from './httpClient';

/** 같은 상태 코드라도 화면 문맥에 따라 현장에 필요한 문구가 다르다. */
export type ErrorContext =
  | 'barcode'
  | 'location'
  | 'stocktaking'
  | 'movement'
  | 'inbound'
  | 'inbound-cancel'
  | 'po-receive'
  | 'putaway'
  | 'outbound';

const CONTEXTUAL: Record<ErrorContext, Partial<Record<number, string>>> = {
  barcode: { 404: '등록되지 않은 바코드예요.' },
  location: { 404: '로케이션을 찾을 수 없어요.' },
  stocktaking: { 400: '실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.' },
  movement: { 400: '출발지 재고가 부족해요. 다시 확인해 주세요.' },
  inbound: { 400: '입고기본존 재고가 부족해요. 새로고침 후 확인해 주세요.' },
  // 취소는 서버가 "적치 존재"·"당일 아님"·"전량 아님"을 모두 400 으로 낸다.
  // 현장에서 실제로 부딪히는 건 앞의 둘이고, 앱은 전량만 보내므로 셋째는 안 난다.
  'inbound-cancel': {
    400: '이미 적치했거나 오늘 입고분이 아니라 취소할 수 없어요.',
  },
  'po-receive': {
    400: '이 발주는 다른 창고에서 받습니다. 창고 선택을 확인해 주세요.',
    404: '발주를 찾을 수 없어요. 목록을 새로고침 해주세요.',
  },
  // 적치는 출발지가 입고기본존이 아닐 수 있다(반품기본존·재작업존도 시스템 존이다).
  // inbound 문맥의 "입고기본존 재고가 부족해요" 를 그대로 쓰면 거짓말이 된다.
  putaway: {
    400: '출발지 재고가 부족하거나 이미 적치됐어요. 새로고침 후 확인해 주세요.',
    404: '입고 라인을 찾을 수 없어요. 새로고침 해주세요.',
  },
  // 409(낙관락 충돌)는 안 넣는다 — httpClient 가 409 를 ConflictError 로 먼저
  // 던지므로(아래 errorMessage 의 첫 분기) 문맥 표까지 내려오지 않는 죽은
  // 분기가 된다.
  outbound: {
    403: '강제출고 권한이 없어요. 관리자에게 요청해 주세요.',
    404: '이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.',
  },
};

// SimpleOutboundService 의 도메인 409 코드 → 현장 문구 (design spec §6.3). GlobalExceptionFilter
// 는 이 서비스가 실어 보낸 `error` 코드를 그대로 응답에 담고, httpClient 의 ConflictError 가 그
// 코드를 들고 온다(둘 다 이 리뷰에서 함께 고침). outbound 문맥에서만 적용 — 다른 화면(적치·이동
// 등)의 409 는 지금처럼 공용 문구를 유지한다. 목록에 없는 코드도 공용 문구로 떨어진다.
const OUTBOUND_CONFLICT_MESSAGES: Record<string, string> = {
  LOCATION_OUTBOUND_FORCE_PERMISSION_UNAVAILABLE:
    '강제출고 권한을 확인하지 못했어요. 연결과 로그인을 확인해 주세요.',
  LOCATION_OUTBOUND_FORCE_PERMISSION_REQUIRED:
    '스캔 생략 출고는 관리자 권한이 필요해요. 상품 스캔으로 일반 출고를 계속해 주세요.',
  LOCATION_OUTBOUND_FORCE_NOT_APPLIED:
    '스캔 생략 출고가 반영되지 않았어요. 상품을 스캔해 일반 출고를 계속해 주세요.',
  LOCATION_OUTBOUND_WAREHOUSE_MISMATCH:
    '송장의 창고와 선택 창고가 달라요. 창고를 확인해 주세요.',
  LOCATION_OUTBOUND_SOURCE_MISMATCH:
    '선택 위치에 이 상품의 출고 할당이 없어요. 표시된 위치를 확인해 주세요.',
  LOCATION_OUTBOUND_OVERSCAN:
    '선택 위치의 남은 수량을 초과했어요. 수량과 위치를 확인해 주세요.',
  LOCATION_OUTBOUND_PROGRESS_CHANGED:
    '출고 진행이 바뀌었어요. 최신 위치별 수량을 다시 확인해 주세요.',
  SIMPLE_OUTBOUND_BARCODE_UNKNOWN:
    '등록되지 않은 바코드예요. 상품을 확인해 주세요.',
  SIMPLE_OUTBOUND_PLAN_INVALIDATED:
    '출고 계획이 바뀌었어요. 송장을 다시 확인해 주세요.',
  SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT: '이 송장에 없는 상품이에요',
  SIMPLE_OUTBOUND_OVERSCAN: '이 상품은 이미 필요한 수량을 다 채웠어요',
  SIMPLE_OUTBOUND_WORK_ITEM_MISSING:
    '이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요',
  SIMPLE_OUTBOUND_CLAIMED_BY_OTHER: '다른 작업자가 이 박스를 작업 중이에요',
  SIMPLE_OUTBOUND_METHOD_UNSUPPORTED:
    '이 배치는 개별 피킹이 아니라 앱에서 처리할 수 없어요 — 관리자에게 문의해 주세요',
};

const INBOUND_WORKFLOW_MESSAGES: Record<string, string> = {
  INBOUND_ORIGIN_STOCK_PROTECTED:
    '이 상품은 적치 대기 중이에요. 적치에서 처리해 주세요.',
  INBOUND_ORIGIN_STOCK_INCONSISTENT:
    '입고 기록과 현재 재고가 맞지 않아요. 입고내역과 실물을 확인해 주세요.',
  INBOUND_PUTAWAY_DESTINATION_INVALID:
    '같은 창고의 일반 로케이션을 선택해 주세요.',
};

export function errorMessage(error: unknown, context?: ErrorContext): string {
  if (
    error instanceof ApiError &&
    error.outcome === 'rejected' &&
    error.code &&
    INBOUND_WORKFLOW_MESSAGES[error.code]
  )
    return INBOUND_WORKFLOW_MESSAGES[error.code];
  if (
    error instanceof ApiError &&
    context === 'outbound' &&
    error.code &&
    OUTBOUND_CONFLICT_MESSAGES[error.code]
  )
    return OUTBOUND_CONFLICT_MESSAGES[error.code];
  if (error instanceof ConflictError) {
    if (error.code === 'STOCKTAKING_COUNT_REQUIRED')
      return '아직 세지 않은 상품이 있어요. 모든 수량을 확인해 주세요.';
    if (error.code === 'STOCKTAKING_RECOUNT_REQUIRED')
      return '실사 중 재고가 바뀌었어요. 해당 상품을 다시 세어 주세요.';
    if (error.code === 'STOCKTAKING_REVISION_CONFLICT')
      return '다른 작업자가 수량을 변경했어요. 최신 수량을 확인해 주세요.';
    if (error.code === 'STOCKTAKING_PREVIEW_STALE')
      return '검토한 뒤 수량이 바뀌었어요. 조정 내용을 다시 확인해 주세요.';
    if (context === 'outbound' && error.code) {
      const specific = OUTBOUND_CONFLICT_MESSAGES[error.code];
      if (specific) return specific;
    }
    return '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.';
  }
  if (error instanceof Error) {
    const match = /→\s*(\d{3})/.exec(error.message);
    const status = match ? Number(match[1]) : undefined;
    // 문맥 문구가 일반 문구보다 먼저다 — 403 을 "다시 로그인" 으로 뭉개면
    // 강제출고 권한 부족이 로그인 문제로 오인된다.
    if (status !== undefined && context) {
      const specific = CONTEXTUAL[context][status];
      if (specific) return specific;
    }
    if (status === 401 || status === 403)
      return '권한이 없어요. 다시 로그인해 주세요.';
    if (status !== undefined && status >= 500) {
      return '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';
    }
    if (status === 404) return '찾을 수 없어요.';
    if (status === 400) return '요청이 올바르지 않아요.';
  }
  return '알 수 없는 오류가 발생했어요.';
}
