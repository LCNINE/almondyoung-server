import {
  FORCE_DISPATCH_SCOPE,
  canShowForceDispatch,
  inspectionServerDenyMessage,
} from './inspection-view-model';

describe('inspection operation UI policy', () => {
  it('hides force dispatch unless the exact scope is granted', () => {
    expect(canShowForceDispatch([])).toBe(false);
    expect(canShowForceDispatch(['fulfillment.warehouse.operate'])).toBe(false);
    expect(canShowForceDispatch([FORCE_DISPATCH_SCOPE])).toBe(true);
  });

  it('keeps server authorization and conflict denials visible', () => {
    expect(
      inspectionServerDenyMessage({ status: 403, message: 'missing scope' })
    ).toContain('서버가 강제 출고를 거부');
    expect(
      inspectionServerDenyMessage({ status: 409, message: 'manifest changed' })
    ).toContain('충돌');
    expect(inspectionServerDenyMessage({ status: 500 })).toBeNull();
  });
});

describe('inspection domain error guidance', () => {
  it('uses Korean label guidance before the generic 409 explanation', () => {
    expect(
      inspectionServerDenyMessage({
        status: 409,
        code: 'LABEL_REPRINT_REQUIRED',
        message: 'Label has changed or was never printed',
      })
    ).toBe(
      '송장이 바뀌었거나 아직 출력하지 않았어요. 프린터가 있는 창고 앱에서 송장을 출력한 뒤 계속해 주세요.'
    );
  });

  it('keeps the generic conflict guidance when only the message contains a waybill code', () => {
    const input = {
      status: 409,
      code: 'CONFLICT',
      message: 'WAYBILL_STALE: changed',
    };
    expect(inspectionServerDenyMessage(input)).toContain(input.message);
    expect(inspectionServerDenyMessage(input)).toContain('충돌');
    expect(input.code).toBe('CONFLICT');
  });
});

describe('preparation reason message priority', () => {
  const show = (body: { code: string; message?: string; details?: unknown }) =>
    inspectionServerDenyMessage({ status: 409, ...body });

  it.each([
    [
      'BATCH_NOT_STARTED',
      'retry_preparation',
      '배치 화면에서 「피킹 시작」을 먼저 눌러 주세요.',
    ],
    [
      'BATCH_NOT_STARTED',
      'review_batch',
      '배치 화면에서 「피킹 시작」을 먼저 눌러 주세요.',
    ],
    [
      'SOURCE_INSUFFICIENT',
      'retry_preparation',
      '출고할 재고가 부족해요. 재고를 확인한 뒤 다시 준비해 주세요.',
    ],
    [
      'SOURCE_INSUFFICIENT',
      'review_batch',
      '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.',
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
      'PLAN_IDENTITY_CHANGED',
      'review_batch',
      '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.',
    ],
    [
      'PLAN_NOT_DRAFT',
      'review_batch',
      '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.',
    ],
    [
      'SHIPMENT_SNAPSHOT_CHANGED',
      'review_batch',
      '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.',
    ],
    [
      'ALLOCATION_INVALID',
      'review_batch',
      '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.',
    ],
    [
      'ELIGIBILITY_CHANGED',
      'review_batch',
      '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.',
    ],
    [
      'ACTIVE_WORK_REQUIRES_REVIEW',
      'review_batch',
      '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.',
    ],
  ])(
    'uses admin guidance for %s / %s even when the server message is English or absent',
    (reasonCode, recovery, expected) => {
      for (const message of ['Preparation blocked', undefined]) {
        const body = {
          code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
          message,
          details: { reasonCode, recovery },
        };

        expect(show(body)).toBe(expected);
        expect(body.code).toBe('SIMPLE_OUTBOUND_PLAN_INVALIDATED');
      }
    }
  );

  it.each([
    undefined,
    null,
    {},
    'BATCH_NOT_STARTED',
    { reasonCode: '', recovery: 'retry_preparation' },
    { reasonCode: ' ', recovery: 'retry_preparation' },
    { reasonCode: 1, recovery: 'retry_preparation' },
    { reasonCode: 'UNKNOWN_REASON', recovery: 'retry_preparation' },
    { reasonCode: 'BATCH_NOT_STARTED' },
    { reasonCode: 'BATCH_NOT_STARTED', recovery: 'unknown' },
    Object.assign([], {
      reasonCode: 'BATCH_NOT_STARTED',
      recovery: 'retry_preparation',
    }),
  ])(
    'keeps the general mapping for missing or invalid details: %p',
    (details) => {
      expect(
        show({
          code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
          message: 'Preparation blocked',
          details,
        })
      ).toBe('출고 계획이 바뀌었어요. 송장을 다시 확인해 주세요.');
    }
  );

  it('does not let preparation details override another domain code', () => {
    expect(
      show({
        code: 'PICKING_BATCH_NOT_STARTED',
        message: 'English detail',
        details: {
          reasonCode: 'SOURCE_INSUFFICIENT',
          recovery: 'retry_preparation',
        },
      })
    ).toBe('배치 화면에서 「피킹 시작」을 먼저 눌러 주세요.');
  });
});
