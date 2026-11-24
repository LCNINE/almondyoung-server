import { describe, it, expect } from 'vitest';
import { errorMessage } from './errorMessage';
import {
  ApiError,
  ConflictError,
  NetworkError,
  type PreparationRejection,
} from './httpClient';

describe('errorMessage', () => {
  it('maps a ConflictError to a retry message', () => {
    expect(errorMessage(new ConflictError('x'))).toMatch(/먼저 변경/);
  });
  it('응답을 받지 못한 요청은 연결을 확인하라고 안내한다', () => {
    for (const context of [undefined, 'barcode', 'outbound'] as const)
      expect(errorMessage(new NetworkError(new TypeError('Failed to fetch')), context)).toBe(
        '서버에 연결하지 못했어요. 네트워크를 확인해 주세요.'
      );
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
  it('401 은 로그인 만료로, 403 은 관리자 확인으로 안내한다', () => {
    expect(errorMessage(new Error('GET /x → 401'))).toBe(
      '로그인이 만료됐어요. 다시 로그인해 주세요.'
    );
    expect(errorMessage(new Error('GET /x → 403'))).toBe(
      '이 작업을 할 권한이 없어요. 관리자에게 확인해 주세요.'
    );
  });
  it('403 이 요구 권한을 알려 주면 그 이름으로 안내한다', () => {
    const denied = new ApiError(
      'POST /inventory/stocks/adjust → 403',
      403,
      'FORBIDDEN',
      undefined,
      undefined,
      ['inventory.stock.adjust']
    );
    expect(errorMessage(denied)).toBe(
      '이 작업에는 ‘재고 조정’ 권한이 필요해요. 관리자에게 권한을 요청해 주세요.'
    );
    expect(errorMessage(denied, 'inbound')).toBe(errorMessage(denied));
  });
  it('요구 권한이 여럿이면 어느 하나면 된다고 안내하고, 목록에 없는 키는 그대로 보여 준다', () => {
    const denied = new ApiError('GET /x → 403', 403, 'FORBIDDEN', undefined, undefined, [
      'inventory.stock.adjust',
      'unknown.permission',
    ]);
    expect(errorMessage(denied)).toBe(
      '이 작업에는 ‘재고 조정’ 또는 ‘unknown.permission’ 권한이 필요해요. 관리자에게 권한을 요청해 주세요.'
    );
  });
  it('falls back for unknown values', () => {
    expect(errorMessage('nope')).toMatch(/알 수 없/);
  });
});

describe('errorMessage with context', () => {
  it('셀메이트가 내보내는 박스는 두고 다음으로 넘어가도록 안내한다', () => {
    const error = new ConflictError(
      'Shipment s-1 belongs to an order Sellmate ships',
      'SHIPMENT_HANDED_OVER_TO_SELLMATE'
    );

    expect(error.status).toBe(409);
    expect(errorMessage(error, 'outbound')).toBe(
      '셀메이트가 내보내는 주문의 박스예요. 이 박스는 두고 다음으로 넘어가 주세요.'
    );
  });

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
      '이 작업을 할 권한이 없어요. 관리자에게 확인해 주세요.'
    );
    expect(errorMessage(new Error('GET /x → 401'), 'barcode')).toBe(
      '로그인이 만료됐어요. 다시 로그인해 주세요.'
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

  it('취소 실패(400)는 적치·취소된 입고를 함께 안내한다', () => {
    expect(
      errorMessage(new Error('POST /inbound/cancel → 400'), 'inbound-cancel')
    ).toBe('이미 적치했거나 취소된 입고라 취소할 수 없어요. 목록을 다시 확인해 주세요.');
  });

  it.each([
    ['바로 온 거절', new ConflictError('x', 'CONFLICT')],
    ['저장된 거절', new ApiError('x', 409, 'CONFLICT')],
  ])('취소 실패(409)는 재고를 잡은 주문을 안내한다 — %s', (_name, error) => {
    expect(errorMessage(error, 'inbound-cancel')).toBe(
      '이 재고를 잡은 주문 때문에 취소하지 못했어요. 입고내역에서 다시 열어 확인해 주세요.'
    );
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
    ['PICKING_BATCH_EMPTY', '배치에 박스가 없어서 시작할 수 없어요. 관리자 화면에서 박스를 먼저 넣어 주세요.'],
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
    ['RETURN_BIN_UNKNOWN', '되돌림 바구니를 사용할 수 없어요. 관리자에게 문의해 주세요.'],
    ['RETURN_BIN_WAREHOUSE_MISMATCH', '다른 창고의 되돌림 바구니예요.'],
    ['RETURN_BIN_ITEM_NOT_FOUND', '이 바구니에 없는 상품이에요.'],
    ['RETURN_BIN_ITEM_SHORT', '바구니에 남은 수량보다 많아요.'],
    ['RETURN_LOCATION_REQUIRED', '원래 로케이션이 여러 곳이에요. 로케이션을 스캔해 주세요.'],
    ['RETURN_LOCATION_MISMATCH', '원래 로케이션이 아니에요. 화면에 보이는 로케이션에 넣어 주세요.'],
  ])('되돌림 %s — 출고·되돌림 화면 둘 다', (code, text) => {
    expect(errorMessage(new ConflictError('m', code), 'returns')).toBe(text);
    expect(errorMessage(new ConflictError('m', code), 'outbound')).toBe(text);
  });
});

describe('출고 판정 거절 문구', () => {
  it.each([
    [
      'SHIPMENT_NOT_DISPATCHABLE',
      '지금 출고할 수 없는 박스예요. 주문이 취소되거나 바뀌었을 수 있어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.',
    ],
    [
      'SHIPMENT_NOT_INSPECTION_READY',
      '아직 검수할 수 없는 박스예요. 관리자에게 확인해 주세요.',
    ],
    [
      'SHIPMENT_SESSION_NOT_ACTIVE',
      '배치 재고 기록을 확인해야 해요. 관리자에게 문의해 주세요.',
    ],
    [
      'SHIPMENT_PACKER_LEASE_REQUIRED',
      '이 박스의 작업자 확인이 맞지 않아요. 관리자에게 확인해 주세요.',
    ],
  ])('%s', (code, text) => {
    // 실행기는 저장된 거절을 ConflictError 가 아닌 ApiError 로 다시 만든다
    expect(errorMessage(new ApiError('m', 409, code), 'outbound')).toBe(text);
    expect(errorMessage(new ConflictError('m', code), 'outbound')).toBe(text);
  });
});

describe('출고 저장 경로에서 반영되지 않은 409 문구', () => {
  const scanPath = '/shipments/s1/simple-outbound-scans';
  const rejectedAt = (code: string) => [
    // 실행기가 저장된 거절으로 다시 만든 오류와 처음 받은 오류 둘 다
    new ApiError('m', 409, code, undefined, undefined, undefined, undefined, scanPath),
    new ConflictError('m', code, undefined, undefined, scanPath),
  ];

  it.each([
    ['PICKING_COMPONENT_CHANGED_RETRY', '방금 박스 상태가 바뀌어 반영하지 못했어요. 한 번 더 해 주세요.'],
    ['SHIPMENT_COMPONENT_CHANGED_RETRY', '방금 박스 상태가 바뀌어 반영하지 못했어요. 한 번 더 해 주세요.'],
    ['SHIPMENT_WORK_ITEM_CHANGED', '방금 박스 상태가 바뀌어 반영하지 못했어요. 한 번 더 해 주세요.'],
    ['SHIPMENT_SESSION_CHANGED', '방금 박스 상태가 바뀌어 반영하지 못했어요. 한 번 더 해 주세요.'],
    ['FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY', '방금 박스 상태가 바뀌어 반영하지 못했어요. 한 번 더 해 주세요.'],
    ['WORK_ITEM_STALE_LEASE_VERSION', '방금 박스 상태가 바뀌어 반영하지 못했어요. 한 번 더 해 주세요.'],
    ['SHIPMENT_WORK_ITEM_MISSING', '이 박스의 배치 작업 기록을 찾지 못했어요. 송장을 다시 스캔하고, 같으면 관리자에게 확인해 주세요.'],
    ['SHIPMENT_SESSION_MISSING', '배치 재고 기록을 확인해야 해요. 관리자에게 문의해 주세요.'],
    ['WORK_ITEM_NOT_CLAIMABLE', '이 박스의 배치 작업 기록을 찾지 못했어요. 송장을 다시 스캔하고, 같으면 관리자에게 확인해 주세요.'],
    ['SHIPMENT_INSPECTION_LINE_UNKNOWN', '검수 기록이 맞지 않아 반영하지 못했어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.'],
    ['SHIPMENT_LINE_OVER_INSPECTED', '검수 기록이 맞지 않아 반영하지 못했어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.'],
    ['SHIPMENT_INSPECTION_BARCODE_UNKNOWN', '검수 기록이 맞지 않아 반영하지 못했어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.'],
    ['SHIPMENT_INSPECTION_SKU_MISMATCH', '검수 기록이 맞지 않아 반영하지 못했어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.'],
    ['SHIPMENT_INSPECTION_CUSTODY_SHORT', '검수 기록이 맞지 않아 반영하지 못했어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.'],
    ['SHIPMENT_INSPECTION_INCOMPLETE', '검수 기록이 맞지 않아 반영하지 못했어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.'],
    ['SHIPMENT_DISPATCH_ALLOCATION_MISMATCH', '출고 수량과 재고 기록이 맞지 않아 출고하지 못했어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.'],
    ['SHIPMENT_DISPATCH_CUSTODY_MISMATCH', '출고 수량과 재고 기록이 맞지 않아 출고하지 못했어요. 담은 상품은 그대로 두고 관리자에게 확인해 주세요.'],
    ['SHIPMENT_TOTE_NOT_RELEASED', '바구니 배정이 남아 있어 출고하지 못했어요. 관리자에게 바구니 배정을 풀어 달라고 해 주세요.'],
    ['SHIPMENT_INVOICE_NOT_READY', '이 박스의 송장이 출고할 상태가 아니에요. 관리자에게 송장 상태를 확인해 달라고 해 주세요.'],
    ['WORK_ITEM_HANDOFF_REQUIRED', '다른 작업자가 맡은 박스예요. 관리자에게 넘겨 달라고 해 주세요.'],
    ['PICKING_BATCH_STRATEGY_MISMATCH', '이 배치의 피킹 방식을 확인해야 해요. 관리자에게 문의해 주세요.'],
    ['PICKING_STRATEGY_PROVIDER_MISMATCH', '이 배치의 피킹 방식을 확인해야 해요. 관리자에게 문의해 주세요.'],
    ['WORK_ITEM_WAITING_OPERATION_CONFLICT', '이 박스에 처리 중인 변경(취소·합포장 등)이 있어요. 관리자에게 확인해 주세요.'],
    ['WORK_ITEM_WAITING_OPERATION_MISSING', '이 박스에 처리 중인 변경(취소·합포장 등)이 있어요. 관리자에게 확인해 주세요.'],
  ])('%s', (code, text) => {
    for (const error of rejectedAt(code)) {
      expect(error.outcome).toBe('rejected');
      expect(errorMessage(error, 'outbound')).toBe(text);
    }
  });

  it('문구가 없는 코드는 반영되지 않았다고 알리고 코드를 보인다', () => {
    for (const error of rejectedAt('SOMETHING_NEW'))
      expect(errorMessage(error, 'outbound')).toBe(
        '반영되지 않았어요. 관리자에게 이 코드를 알려 주세요: SOMETHING_NEW'
      );
  });

  it('다른 경로의 모르는 409 문구는 그대로다', () => {
    expect(errorMessage(new ConflictError('m', 'SOMETHING_NEW'), 'outbound')).toBe(
      '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.'
    );
  });
});

describe('관리자 화면에 남은 출고 저장 거절 문구', () => {
  const scanPath = '/shipments/s1/simple-outbound-scans';
  const notice = '관리자 화면에 이 박스가 표시됐어요. 관리자를 불러 주세요.';
  const recorded = (code: string, preparation?: PreparationRejection) => [
    new ApiError('m', 409, code, preparation, undefined, undefined, undefined, scanPath, true),
    new ConflictError('m', code, preparation, undefined, scanPath, true),
  ];

  it.each([
    ['SHIPMENT_TOTE_NOT_RELEASED', '바구니 배정이 남아 있어 출고하지 못했어요.'],
    ['SHIPMENT_INVOICE_NOT_READY', '이 박스의 송장이 출고할 상태가 아니에요.'],
    ['WORK_ITEM_HANDOFF_REQUIRED', '다른 작업자가 맡은 박스예요.'],
    ['SIMPLE_OUTBOUND_CLAIMED_BY_OTHER', '다른 작업자가 맡은 박스예요.'],
    ['SHIPMENT_WORK_ITEM_MISSING', '이 박스의 배치 작업 기록을 찾지 못했어요.'],
    ['SIMPLE_OUTBOUND_WORK_ITEM_MISSING', '이 박스의 배치 작업 기록을 찾지 못했어요.'],
    ['SHIPMENT_INSPECTION_INCOMPLETE', '검수 기록이 맞지 않아 반영하지 못했어요. 담은 상품은 그대로 두세요.'],
    ['SHIPMENT_DISPATCH_CUSTODY_MISMATCH', '출고 수량과 재고 기록이 맞지 않아 출고하지 못했어요. 담은 상품은 그대로 두세요.'],
    ['PICKING_BATCH_STRATEGY_MISMATCH', '이 배치의 피킹 방식을 확인해야 해요.'],
    ['SIMPLE_OUTBOUND_METHOD_UNSUPPORTED', '이 배치의 피킹 방식을 확인해야 해요.'],
    ['WORK_ITEM_WAITING_OPERATION_CONFLICT', '이 박스에 처리 중인 변경(취소·합포장 등)이 있어요.'],
    ['SHIPMENT_NOT_DISPATCHABLE', '지금 출고할 수 없는 박스예요. 주문이 취소되거나 바뀌었을 수 있어요. 담은 상품은 그대로 두세요.'],
    ['SHIPMENT_NOT_INSPECTION_READY', '아직 검수할 수 없는 박스예요.'],
    ['SHIPMENT_SESSION_MISSING', '배치 재고 기록을 확인해야 해요.'],
    ['SHIPMENT_SESSION_NOT_ACTIVE', '배치 재고 기록을 확인해야 해요.'],
    ['PICKING_SESSION_NOT_ACTIVE', '배치 재고 기록을 확인해야 해요.'],
    ['SHIPMENT_PACKER_LEASE_REQUIRED', '이 박스의 작업자 확인이 맞지 않아요.'],
    ['WAYBILL_STALE', '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요.'],
    ['WAYBILL_NOT_DISPATCHABLE', '한진 등록이 끝나지 않은 송장이에요.'],
    ['SIMPLE_OUTBOUND_PLAN_INVALIDATED', '출고 계획이 바뀌었어요.'],
    ['SOMETHING_NEW', '반영되지 않았어요.'],
  ])('%s', (code, reason) => {
    for (const error of recorded(code))
      expect(errorMessage(error, 'outbound')).toBe(`${reason} ${notice}`);
  });

  it.each([
    [{ reasonCode: 'SOURCE_STOCK_CHANGED', recovery: 'review_batch' }, '출고 대상이나 작업 상태가 바뀌었어요.'],
    [{ reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'retry_preparation' }, '출고할 재고가 부족해요.'],
    [{ reasonCode: 'REPLAN_LIMIT_REACHED', recovery: 'retry_preparation' }, '출고 준비를 여러 번 다시 했지만 맞추지 못했어요.'],
  ] as const)('준비가 막힌 거절도 남았으면 같은 꼬리를 단다: %o', (preparation, reason) => {
    for (const error of recorded('SIMPLE_OUTBOUND_PLAN_INVALIDATED', preparation))
      expect(errorMessage(error, 'outbound')).toBe(`${reason} ${notice}`);
  });

  it.each([
    'SHIPMENT_COMPONENT_CHANGED_RETRY',
    'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY',
    'SHIPMENT_HANDED_OVER_TO_SELLMATE',
    'LOCATION_OUTBOUND_FORCE_PERMISSION_REQUIRED',
  ])('작업자가 그 자리에서 할 일이 있는 %s 는 원래 안내를 둔다', (code) => {
    const plain = errorMessage(
      new ApiError('m', 409, code, undefined, undefined, undefined, undefined, scanPath),
      'outbound'
    );
    expect(plain).not.toContain('관리자 화면');
    for (const error of recorded(code)) expect(errorMessage(error, 'outbound')).toBe(plain);
  });

  it('남기지 않은 거절은 지금 문구 그대로다', () => {
    expect(
      errorMessage(new ConflictError('m', 'SOMETHING_NEW', undefined, undefined, scanPath), 'outbound')
    ).toBe('반영되지 않았어요. 관리자에게 이 코드를 알려 주세요: SOMETHING_NEW');
    expect(
      errorMessage(new ConflictError('m', 'SHIPMENT_TOTE_NOT_RELEASED', undefined, undefined, scanPath), 'outbound')
    ).toBe('바구니 배정이 남아 있어 출고하지 못했어요. 관리자에게 바구니 배정을 풀어 달라고 해 주세요.');
  });
});
