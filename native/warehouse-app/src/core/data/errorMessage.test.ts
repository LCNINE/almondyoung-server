import { describe, it, expect } from 'vitest';
import { errorMessage } from './errorMessage';
import { ConflictError } from './httpClient';

describe('errorMessage', () => {
  it('maps a ConflictError to a retry message', () => {
    expect(errorMessage(new ConflictError('x'))).toMatch(/먼저 변경/);
  });
  it('maps a 404 status embedded in the message', () => {
    expect(errorMessage(new Error('GET /x → 404'))).toMatch(/찾을 수 없/);
  });
  it('maps a 500 status to a server message', () => {
    expect(errorMessage(new Error('GET /x → 500'))).toMatch(/서버/);
  });
  it('maps a 400 status to an input message', () => {
    expect(errorMessage(new Error('POST /x → 400'))).toMatch(/올바르지 않/);
  });
  it('maps 401/403 to an auth message', () => {
    expect(errorMessage(new Error('GET /x → 401'))).toMatch(/권한/);
    expect(errorMessage(new Error('GET /x → 403'))).toMatch(/권한/);
  });
  it('falls back for unknown values', () => {
    expect(errorMessage('nope')).toMatch(/알 수 없/);
  });
});

describe('errorMessage with context', () => {
  it('바코드 문맥의 404 는 미등록 바코드로 안내한다', () => {
    expect(errorMessage(new Error('GET /inventory/skus → 404'), 'barcode')).toBe(
      '등록되지 않은 바코드예요.'
    );
  });

  it('로케이션 문맥의 404 는 로케이션으로 안내한다', () => {
    expect(errorMessage(new Error('POST /stocktaking/scan-location → 404'), 'location')).toBe(
      '로케이션을 찾을 수 없어요.'
    );
  });

  it('실사 문맥의 400 은 세션 상태를 짚어준다', () => {
    expect(errorMessage(new Error('POST /stocktaking/scan-product → 400'), 'stocktaking')).toBe(
      '실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.'
    );
  });

  it('이동 문맥의 400 은 출발지 부족을 짚어준다', () => {
    expect(errorMessage(new Error('POST /movement/move → 400'), 'movement')).toBe(
      '출발지 재고가 부족해요. 다시 확인해 주세요.'
    );
  });

  it('문맥이 없으면 기존 문구를 유지한다', () => {
    expect(errorMessage(new Error('GET /x → 404'))).toBe('찾을 수 없어요.');
    expect(errorMessage(new Error('GET /x → 400'))).toBe('요청이 올바르지 않아요.');
  });

  it('문맥이 있어도 401/403/5xx 는 공통 문구를 쓴다', () => {
    expect(errorMessage(new Error('GET /x → 403'), 'barcode')).toBe(
      '권한이 없어요. 다시 로그인해 주세요.'
    );
    expect(errorMessage(new Error('GET /x → 500'), 'stocktaking')).toBe(
      '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.'
    );
  });
});

describe('inbound 문맥', () => {
  it('적치 실패(400)는 입고기본존 재고를 짚어준다', () => {
    expect(errorMessage(new Error('POST /inbound/putaway → 400'), 'inbound')).toBe(
      '입고기본존 재고가 부족해요. 새로고침 후 확인해 주세요.'
    );
  });

  it('취소 실패(400)는 적치/당일 제약을 함께 안내한다', () => {
    expect(errorMessage(new Error('POST /inbound/cancel → 400'), 'inbound-cancel')).toBe(
      '이미 적치했거나 오늘 입고분이 아니라 취소할 수 없어요.'
    );
  });
});

describe('outbound 문맥', () => {
  it('출고 문맥의 403 은 강제출고 권한 안내를 준다', () => {
    expect(errorMessage(new Error('POST /x → 403'), 'outbound')).toBe(
      '강제출고 권한이 없어요. 관리자에게 요청해 주세요.'
    );
  });

  it('출고 문맥의 404 는 운송장 안내를 준다', () => {
    expect(errorMessage(new Error('GET /x → 404'), 'outbound')).toBe(
      '이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.'
    );
  });

  // 리뷰 지적 1: GlobalExceptionFilter 가 도메인 409 코드를 그대로 내보내도록 고친 뒤,
  // 여기서 그 코드를 현장 문구로 바꿔줘야 "다른 작업자가 먼저 변경했어요" 하나로
  // 뭉개지지 않는다 — 스펙 §6.3 문구를 그대로 쓴다.
  it('이 송장에 없는 상품 스캔은 전용 문구를 준다', () => {
    expect(
      errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT'), 'outbound')
    ).toBe('이 송장에 없는 상품이에요');
  });

  it('과다 스캔은 전용 문구를 준다', () => {
    expect(errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_OVERSCAN'), 'outbound')).toBe(
      '이 상품은 이미 필요한 수량을 다 채웠어요'
    );
  });

  it('오늘 배치에 없는 송장은 전용 문구를 준다', () => {
    expect(
      errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_WORK_ITEM_MISSING'), 'outbound')
    ).toBe('이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요');
  });

  it('다른 작업자가 이미 잡은 박스는 전용 문구를 준다', () => {
    expect(
      errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER'), 'outbound')
    ).toBe('다른 작업자가 이 박스를 작업 중이에요');
  });

  it('개별피킹이 아닌 배치는 전용 문구를 준다', () => {
    expect(
      errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_METHOD_UNSUPPORTED'), 'outbound')
    ).toBe('이 배치는 개별 피킹이 아니라 앱에서 처리할 수 없어요 — 관리자에게 문의해 주세요');
  });

  it('모르는 코드는 기존 공용 충돌 문구를 유지한다', () => {
    expect(errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_PLAN_INVALIDATED'), 'outbound')).toBe(
      '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.'
    );
  });

  it('outbound 문맥이 아니면 코드가 있어도 공용 충돌 문구를 유지한다', () => {
    expect(errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_OVERSCAN'))).toBe(
      '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.'
    );
  });
});
