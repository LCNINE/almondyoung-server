import type {
  SupplierRowErrorCode,
  SupplierRowVerdictKind,
  SupplierSheetVerdictCounts,
} from '@/lib/types/dto/fulfillment';

// 판정 문구는 입점사가 아니라 운영자가 본다
const VERDICT_LABEL: Record<SupplierRowVerdictKind, string> = {
  ship: '발송',
  merge: '합포장 발송',
  unfulfillable: '못 보냄',
  waiting: '아직',
  correct: '송장 정정',
  unchanged: '변경 없음',
  error: '오류',
};

// Record 로 적어 core 에 코드가 늘면(admin-web 유니언을 따라 늘리면) 빠진 문구를 tsc 가 잡는다
export const ROW_ERROR_TEXT: Record<SupplierRowErrorCode, string> = {
  UNKNOWN_ROW_KEY: '행 키를 찾을 수 없습니다(지웠거나 다른 파일의 줄)',
  OTHER_SUPPLIER: '다른 입점사의 줄입니다',
  CANCELED: '취소된 줄입니다',
  NOT_HANDED_OFF: '아직 넘기지 않은 줄입니다',
  IN_RECOVERY: '되돌리기·복구 중인 상자입니다',
  ROW_MISMATCH: '주문번호나 공급사 상품코드가 행 키와 맞지 않습니다',
  QTY_MISMATCH: '수량을 고쳤습니다(일부 발송은 받지 않습니다)',
  DUPLICATE_ROW: '같은 행 키가 두 번 있습니다',
  UNKNOWN_CARRIER: '택배사 이름을 알 수 없습니다',
  CARRIER_WITHOUT_TRACKING: '택배사만 있고 송장번호가 없습니다',
  TRACKING_WITHOUT_CARRIER: '송장번호만 있고 택배사가 없습니다',
  TRACKING_AND_REASON: '송장번호와 못 보냄 사유가 둘 다 있습니다',
  TRACKING_IN_USE: '이 송장번호를 다른 상자가 쓰고 있습니다',
  MERGE_RECIPIENT_MISMATCH: '합포장한 줄들의 받는 분이 다릅니다',
  CORRECTION_PARTIAL: '발송된 상자의 일부 줄만 송장이 바뀌었습니다',
  REASON_ON_SHIPPED: '이미 발송된 줄에 못 보냄 사유가 있습니다',
  GROUP_HAS_ERROR: '같은 송장의 다른 줄에 오류가 있습니다',
};

export function verdictLabel(kind: SupplierRowVerdictKind): string {
  return VERDICT_LABEL[kind];
}

export function rowErrorText(code: SupplierRowErrorCode): string {
  return ROW_ERROR_TEXT[code];
}

/** 적용하면 실제로 쓰는 줄(N10) — 0 이면 적용 버튼을 막는다. 오류 줄은 서버가 빼고 쓴다. */
export function applicableCount(counts: SupplierSheetVerdictCounts): number {
  return counts.ship + counts.merge + counts.correct + counts.unfulfillable;
}
