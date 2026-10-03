import { describe, it, expect } from 'vitest';
import { errorMessage } from './errorMessage';
import { ApiError, ConflictError } from './httpClient';

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
    expect(
      errorMessage(new Error('GET /inventory/skus → 404'), 'barcode')
    ).toBe('등록되지 않은 바코드예요.');
  });

  it('로케이션 문맥의 404 는 로케이션으로 안내한다', () => {
    expect(
      errorMessage(
        new Error('POST /stocktaking/scan-location → 404'),
        'location'
      )
    ).toBe('로케이션을 찾을 수 없어요.');
  });

  it('실사 문맥의 400 은 세션 상태를 짚어준다', () => {
    expect(
      errorMessage(
        new Error('POST /stocktaking/scan-product → 400'),
        'stocktaking'
      )
    ).toBe('실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.');
  });

  it('이동 문맥의 400 은 출발지 부족을 짚어준다', () => {
    expect(
      errorMessage(new Error('POST /movement/move → 400'), 'movement')
    ).toBe('출발지 재고가 부족해요. 다시 확인해 주세요.');
  });

  it('비활성 이동 목적지는 다른 목적지를 다시 고르게 안내한다', () => {
    expect(
      errorMessage(
        new ApiError(
          'inactive destination',
          409,
          'MOVEMENT_DESTINATION_INACTIVE'
        ),
        'movement'
      )
    ).toBe('사용 중지된 위치예요. 다른 도착 위치를 선택해 주세요.');
  });

  it('문맥이 없으면 기존 문구를 유지한다', () => {
    expect(errorMessage(new Error('GET /x → 404'))).toBe('찾을 수 없어요.');
    expect(errorMessage(new Error('GET /x → 400'))).toBe(
      '요청이 올바르지 않아요.'
    );
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
    expect(
      errorMessage(new Error('POST /inbound/putaway → 400'), 'inbound')
    ).toBe('입고기본존 재고가 부족해요. 새로고침 후 확인해 주세요.');
  });

  it('취소 실패(400)는 적치/당일 제약을 함께 안내한다', () => {
    expect(
      errorMessage(new Error('POST /inbound/cancel → 400'), 'inbound-cancel')
    ).toBe('이미 적치했거나 오늘 입고분이 아니라 취소할 수 없어요.');
  });
});

describe('po-receive 문맥', () => {
  it('발주 수령 400 은 창고 선택을 확인하게 한다', () => {
    expect(
      errorMessage(
        new Error('POST /purchase-orders/po-1/receipts → 400'),
        'po-receive'
      )
    ).toBe('이 발주는 다른 창고에서 받습니다. 창고 선택을 확인해 주세요.');
  });

  it('발주 수령 404 는 목록 새로고침을 안내한다', () => {
    expect(
      errorMessage(
        new Error('POST /purchase-orders/po-1/receipts → 404'),
        'po-receive'
      )
    ).toBe('발주를 찾을 수 없어요. 목록을 새로고침 해주세요.');
  });

  it('발주 수령 충돌은 내부 식별자 없이 안내한다', () => {
    expect(
      errorMessage(
        new ConflictError('이미 전량 입고된 품목입니다: sku-1'),
        'po-receive'
      )
    ).toBe('다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.');
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
      errorMessage(
        new ConflictError('x', 'SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT'),
        'outbound'
      )
    ).toBe('이 송장에 없는 상품이에요');
  });

  it('과다 스캔은 전용 문구를 준다', () => {
    expect(
      errorMessage(
        new ConflictError('x', 'SIMPLE_OUTBOUND_OVERSCAN'),
        'outbound'
      )
    ).toBe('이 상품은 이미 필요한 수량을 다 채웠어요');
  });

  it('오늘 배치에 없는 송장은 전용 문구를 준다', () => {
    expect(
      errorMessage(
        new ConflictError('x', 'SIMPLE_OUTBOUND_WORK_ITEM_MISSING'),
        'outbound'
      )
    ).toBe('이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요');
  });

  it('다른 작업자가 이미 잡은 박스는 전용 문구를 준다', () => {
    expect(
      errorMessage(
        new ConflictError('x', 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER'),
        'outbound'
      )
    ).toBe('다른 작업자가 이 박스를 작업 중이에요');
  });

  it('이미 다른 박스를 잡고 있으면 전용 문구를 준다', () => {
    expect(
      errorMessage(
        new ConflictError('x', 'WORKER_ACTIVE_CLAIM_EXISTS'),
        'outbound'
      )
    ).toBe(
      '다른 박스를 아직 작업 중이에요. 그 박스를 마치거나 내려놓은 뒤 다시 찍어 주세요.'
    );
  });

  it('개별피킹이 아닌 배치는 전용 문구를 준다', () => {
    expect(
      errorMessage(
        new ConflictError('x', 'SIMPLE_OUTBOUND_METHOD_UNSUPPORTED'),
        'outbound'
      )
    ).toBe(
      '이 배치는 개별 피킹이 아니라 앱에서 처리할 수 없어요 — 관리자에게 문의해 주세요'
    );
  });

  it('모르는 코드는 기존 공용 충돌 문구를 유지한다', () => {
    expect(
      errorMessage(
        new ConflictError('x', 'UNRECOGNIZED_DOMAIN_CONFLICT'),
        'outbound'
      )
    ).toBe('다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.');
  });

  it('outbound 문맥이 아니면 코드가 있어도 공용 충돌 문구를 유지한다', () => {
    expect(
      errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_OVERSCAN'))
    ).toBe('다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.');
  });
});

it.each([
  [
    'SOURCE_INSUFFICIENT',
    'retry_preparation',
    '출고할 재고가 부족해요. 재고를 확인한 뒤 다시 준비해 주세요.',
  ],
  [
    'SOURCE_STOCK_CHANGED',
    'retry_preparation',
    '재고가 변경됐어요. 현재 재고를 확인한 뒤 다시 준비해 주세요.',
  ],
  [
    'REPLAN_LIMIT_REACHED',
    'retry_preparation',
    '재고가 변경됐어요. 현재 재고를 확인한 뒤 다시 준비해 주세요.',
  ],
  [
    'SHIPMENT_SNAPSHOT_CHANGED',
    'review_batch',
    '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.',
  ],
] as const)(
  'gives actionable preparation guidance for %s',
  (reasonCode, recovery, message) => {
    expect(
      errorMessage(
        new ApiError('blocked', 409, 'SIMPLE_OUTBOUND_PLAN_INVALIDATED', {
          reasonCode,
          recovery,
        }),
        'outbound'
      )
    ).toBe(message);
  }
);

describe('errorMessage outbound 작업 시작·재출력 게이트 (#987)', () => {
  it.each([
    [
      new ApiError('작업이 반영되지 않았어요.', 400, 'SIMPLE_OUTBOUND_PLAN_INVALIDATED', {
        reasonCode: 'BATCH_NOT_STARTED',
        recovery: 'retry_preparation',
      }),
      '배치 화면에서 「작업 시작」을 먼저 눌러 주세요.',
    ],
    [
      new ConflictError('m', 'LABEL_REPRINT_REQUIRED'),
      '송장이 바뀌었거나 아직 출력하지 않았어요. 송장을 다시 스캔해 출력한 뒤 계속해 주세요.',
    ],
    [
      new ConflictError('m', 'WAYBILL_STALE'),
      '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.',
    ],
    [
      new ConflictError('m', 'WAYBILL_LABEL_NOT_ALLOCATED'),
      '작업이 시작되지 않은 박스예요. 배치 화면에서 「작업 시작」을 먼저 눌러 주세요.',
    ],
  ])('출고 문구 %#', (error, expected) => {
    expect(errorMessage(error, 'outbound')).toBe(expected);
  });
});

describe('합류·이탈 거절 문구 (#988)', () => {
  it.each([
    ['BATCH_NOT_JOINABLE', '이 배치에는 더 넣을 수 없어요(끝났거나 멈춘 배치). 다른 배치를 골라 주세요.'],
    ['SHIPMENT_ACTIVE_WORK_ITEM', '이미 다른 배치에 들어 있는 박스예요.'],
    ['OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED', '이 배치의 카트 바구니가 다 찼어요.'],
    ['WORK_ITEM_TOTE_RELEASE_REQUIRED', '바구니 배정을 먼저 풀어야 뺄 수 있어요. 관리자에게 문의해 주세요.'],
    ['WORK_ITEM_DISPATCH_EXISTS', '이미 출고 처리된 박스라 뺄 수 없어요.'],
    ['WORK_ITEM_ALLOCATED', '결품 처리 중인 박스예요. 관리자에게 문의해 주세요.'],
    ['OUTBOUND_BATCH_STARTED_RETRY', '방금 작업이 시작된 배치예요. 다시 넣어 주세요.'],
    ['PICKING_SESSION_NOT_ACTIVE', '배치 재고 기록을 확인해야 해요. 관리자에게 문의해 주세요.'],
  ])('%s 문구', (code, text) => {
    expect(errorMessage(new ConflictError('m', code), 'outbound')).toBe(text);
  });
});

describe('이탈·되돌림 문구 (#989)', () => {
  it.each([
    ['SHIPMENT_WITHDRAWN', '빠진 박스예요. 송장은 버려 주세요.'],
    ['SHIPMENT_ALREADY_WITHDRAWING', '이미 빼는 중인 박스예요. 송장을 스캔해 뺄 상품을 되돌림 바구니에 넣어 주세요.'],
    ['SHIPMENT_NOT_WITHDRAWING', '빼는 중인 박스가 아니에요. 송장을 다시 스캔해 주세요.'],
    ['REMOVAL_NOT_PENDING', '이 상품은 이 박스에서 뺄 게 없어요.'],
    ['WITHDRAWAL_WAYBILL_NOT_VOIDABLE', '이 박스의 송장을 지금 처리할 수 없어요. 이 상품은 아직 빠지지 않았어요. 관리자에게 송장 처리를 요청해 주세요.'],
    ['SHIPMENT_LINE_INSPECTION_STALE', '검수 기록이 맞지 않아요. 관리자에게 문의해 주세요.'],
  ])('출고 %s', (code, text) => {
    expect(errorMessage(new ConflictError('m', code), 'outbound')).toBe(text);
  });

  it.each([
    ['RETURN_BIN_UNKNOWN', '등록되지 않았거나 폐기된 되돌림 바구니예요. 설정에서 바구니를 확인해 주세요.'],
    ['RETURN_BIN_WAREHOUSE_MISMATCH', '다른 창고의 되돌림 바구니예요.'],
    ['RETURN_BIN_ITEM_NOT_FOUND', '이 바구니에 없는 상품이에요.'],
    ['RETURN_BIN_ITEM_SHORT', '바구니에 남은 수량보다 많아요.'],
    ['RETURN_LOCATION_MISMATCH', '원래 로케이션이 아니에요. 화면에 보이는 로케이션에 넣어 주세요.'],
  ])('되돌림 %s — 출고·되돌림 화면 둘 다', (code, text) => {
    expect(errorMessage(new ConflictError('m', code), 'returns')).toBe(text);
    expect(errorMessage(new ConflictError('m', code), 'outbound')).toBe(text);
  });
});
