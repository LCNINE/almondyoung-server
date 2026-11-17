import {
  getBatchBlockerGroups,
  getServerDenyMessage,
  parseServerError,
} from './server-error';

describe('server error parser', () => {
  it('preserves Axios 403 code and message', () => {
    const parsed = parseServerError({
      response: {
        status: 403,
        data: { code: 'MISSING_SCOPE', message: 'missing recall scope' },
      },
    });

    expect(parsed).toMatchObject({
      status: 403,
      code: 'MISSING_SCOPE',
      message: 'missing recall scope',
      denied: true,
    });
    expect(
      getServerDenyMessage({
        response: { status: 403, data: { message: 'denied' } },
      })
    ).toContain('권한이 없어 서버가 작업을 거부했습니다. denied');
  });

  it('joins validation messages for Axios 409 and reads normalized CustomError', () => {
    expect(
      parseServerError({
        response: {
          status: 409,
          data: { message: ['manifest stale', 'reload'] },
        },
      })
    ).toMatchObject({
      status: 409,
      message: 'manifest stale, reload',
      conflict: true,
    });
    expect(
      parseServerError({
        statusCode: 409,
        message: 'Request failed',
        response: {
          code: 'STALE_VERSION',
          message: 'reservation version changed',
        },
      })
    ).toMatchObject({
      status: 409,
      code: 'STALE_VERSION',
      message: 'reservation version changed',
    });
  });

  it('explains an under-reserved shipment as a stock shortage instead of a state race', () => {
    const message = getServerDenyMessage({
      response: {
        status: 409,
        data: {
          code: 'SHIPMENT_NOT_FULLY_RESERVED',
          message: 'Under-reserved lines: l-1',
        },
      },
    });

    expect(message).toContain('재고가 부족해');
    expect(message).not.toContain('다른 작업으로 상태가 변경되어');
  });

  it('exposes the unwrapped body details, undefined when absent', () => {
    const details = { boxes: [] };
    expect(
      parseServerError({ statusCode: 409, response: { code: 'X', details } })
        .details
    ).toBe(details);
    expect(
      parseServerError({
        response: { status: 409, data: { code: 'X', details } },
      }).details
    ).toBe(details);
    expect(
      parseServerError({ response: { status: 409, data: { code: 'X' } } })
        .details
    ).toBeUndefined();
  });
});

describe('Korean outbound error guidance', () => {
  it.each([
    ['BATCH_START_BLOCKED', '시작하지 못했어요.'],
    ['BATCH_JOIN_BLOCKED', '넣지 못했어요.'],
    ['SHIPMENT_WITHDRAWN', '빠진 박스예요. 송장은 버려 주세요.'],
    [
      'WAYBILL_STALE',
      '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.',
    ],
  ])(
    'shows Korean for %s in both supported response shapes',
    (code, expected) => {
      const body = { code, message: 'English server message' };
      expect(
        getServerDenyMessage({ response: { status: 409, data: body } })
      ).toBe(expected);
      expect(getServerDenyMessage({ statusCode: 409, response: body })).toBe(
        expected
      );
    }
  );

  it.each([undefined, 'CONFLICT'])(
    'preserves the fallback without inferring a waybill code from the message: %s',
    (code) => {
      const error = {
        statusCode: 409,
        response: { code, message: 'WAYBILL_STALE: manifest changed' },
      };
      expect(parseServerError(error).code).toBe(code ?? null);
      expect(getServerDenyMessage(error)).toContain(
        'WAYBILL_STALE: manifest changed'
      );
    }
  );

  it('prioritizes an explicit domain code over a waybill message prefix', () => {
    const error = {
      statusCode: 409,
      response: {
        code: 'SHIPMENT_WITHDRAWN',
        message: 'WAYBILL_STALE: detail',
      },
    };
    expect(parseServerError(error).code).toBe('SHIPMENT_WITHDRAWN');
    expect(getServerDenyMessage(error)).toBe(
      '빠진 박스예요. 송장은 버려 주세요.'
    );
  });

  it.each([
    [403, 'WAYBILL_STALE: detail'],
    [500, 'WAYBILL_STALE: detail'],
    [409, 'UNKNOWN: detail'],
    [409, 'BATCH_JOIN_BLOCKED: detail'],
  ])(
    'preserves the fallback for status %s and message %s',
    (statusCode, message) => {
      expect(
        getServerDenyMessage({
          statusCode,
          response: { code: 'CONFLICT', message },
        })
      ).toContain(message);
    }
  );

  it('keeps code-based guidance when preparation details are absent', () => {
    expect(
      getServerDenyMessage({
        statusCode: 409,
        response: {
          code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
          message: 'original detail',
        },
      })
    ).toBe('출고 계획이 바뀌었어요. 송장을 다시 확인해 주세요.');
  });
});

describe('preparation reason message priority', () => {
  const show = (body: { code: string; message?: string; details?: unknown }) =>
    getServerDenyMessage({ statusCode: 409, response: body });

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

describe('batch blocker groups', () => {
  function group(errors: unknown, code = 'BATCH_START_BLOCKED') {
    return getBatchBlockerGroups(
      parseServerError({ response: { status: 409, data: { code, errors } } })
    );
  }
  it('사유별로 묶고 송장 번호와 상품별 필요·부족 수량을 보여 준다', () => {
    const result = group([
      {
        shipmentId: 'box-1',
        reason: 'STOCK_SHORT',
        trackingNo: '123456789012',
        skuName: '상품 A',
        requiredQty: 3,
        shortQty: 1,
      },
      {
        shipmentId: 'box-2',
        reason: 'INBOUND_PENDING',
        skuCode: 'SKU-B',
        requiredQty: 2,
        shortQty: 2,
      },
      {
        shipmentId: 'box-3',
        reason: 'WAYBILL_NOT_READY',
        requiredQty: null,
        shortQty: null,
      },
    ]);
    expect(
      result.groups
        .map((g) => [g.title, ...g.rows, g.guidance].join(' '))
        .join(' ')
    ).toContain('1234-5678-9012 · 상품 A 3개 중 1개 부족');
    expect(
      result.groups
        .map((g) => [g.title, ...g.rows, g.guidance].join(' '))
        .join(' ')
    ).toContain('박스 box-2 · SKU-B 2개 중 2개 부족');
    expect(
      result.groups
        .map((g) => [g.title, ...g.rows, g.guidance].join(' '))
        .join(' ')
    ).toContain('박스 box-3 · 송장 재발급 필요');
    expect(result.groups.map((g) => g.reason)).toEqual([
      'INBOUND_PENDING',
      'STOCK_SHORT',
      'WAYBILL_NOT_READY',
    ]);
    expect(
      result.groups
        .map((g) => [g.title, ...g.rows, g.guidance].join(' '))
        .join(' ')
    ).toContain('관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.');
  });

  it('합류 차단에는 합류용 조치 안내를 보여 준다', () => {
    const result = group(
      [
        {
          shipmentId: 'box',
          reason: 'STOCK_SHORT',
          requiredQty: 3,
          shortQty: 1,
        },
      ],
      'BATCH_JOIN_BLOCKED'
    );

    expect(
      result.groups
        .map((g) => [g.title, ...g.rows, g.guidance].join(' '))
        .join(' ')
    ).toContain(
      '재고가 모자라 이 배치에 넣을 수 없어요. 관리자에게 문의해 주세요.'
    );
    expect(
      result.groups
        .map((g) => [g.title, ...g.rows, g.guidance].join(' '))
        .join(' ')
    ).not.toContain('빼고 시작하세요');
  });

  it.each([
    undefined,
    [],
    [null],
    [
      {
        shipmentId: 'box',
        reason: 'NEW_REASON',
        detail: 'private english detail',
      },
    ],
  ])(
    '목록을 읽을 수 없어도 실패 안내를 없애거나 원문을 노출하지 않는다: %p',
    (errors) => {
      const result = group(errors);
      expect(result.incomplete).toBe(true);
      expect(
        result.groups
          .map((g) => [g.title, ...g.rows, g.guidance].join(' '))
          .join(' ')
      ).not.toContain('private english detail');
    }
  );
});
