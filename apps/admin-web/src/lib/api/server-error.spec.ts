import {
  getBatchBlockerGroups,
  getServerDenyMessage,
  knownConflictMessage,
  parseServerError,
} from './server-error';

describe('server error parser', () => {
  it('셀메이트가 내보내는 상자는 두고 넘어가도록 안내한다', () => {
    const error = {
      response: {
        status: 409,
        data: {
          code: 'SHIPMENT_HANDED_OVER_TO_SELLMATE',
          message: 'Shipment s-1 belongs to an order Sellmate ships',
        },
      },
    };
    const message =
      '셀메이트가 내보내는 주문의 상자예요. 이 상자는 두고 넘어가 주세요.';

    expect(getServerDenyMessage(error)).toBe(message);
    expect(knownConflictMessage(parseServerError(error).code)).toBe(message);
  });

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
  it('translates a shipment already in recovery instead of the raw server text', () => {
    const message = getServerDenyMessage({
      statusCode: 409,
      message: 'Shipment s-1 is already in recovery',
      response: { success: false, code: 'SHIPMENT_RECOVERY_IN_PROGRESS', message: 'Shipment s-1 is already in recovery' },
    });

    expect(message).toContain('같은 상자의 다른 취소를 처리하고 있어요');
    expect(message).not.toContain('Shipment s-1');
  });
});

describe('Korean outbound error guidance', () => {
  it.each([
    ['PICKING_BATCH_EMPTY', '배치에 박스가 없어서 시작할 수 없어요. 배치 상세에서 박스를 먼저 넣어 주세요.'],
    ['PICKING_BATCH_NOT_STARTED', '피킹 화면에서 「피킹 시작」을 먼저 눌러 주세요.'],
    ['WAYBILL_LABEL_NOT_ALLOCATED', '작업이 시작되지 않은 박스예요. 피킹 화면에서 「피킹 시작」을 먼저 눌러 주세요.'],
    ['PICKING_SESSION_NOT_ACTIVE', '배치 재고 작업이 진행 가능한 상태가 아니에요. 배치 상세에서 재고 작업 상태를 확인해 주세요.'],
    ['SHIPMENT_ALREADY_WITHDRAWING', '이미 빼는 중인 박스예요. 창고 담당자에게 뺄 상품의 되돌림 처리를 요청해 주세요.'],
    ['LABEL_REPRINT_REQUIRED', '송장이 바뀌었거나 아직 출력하지 않았어요. 창고 담당자에게 프린터가 있는 창고 앱에서 송장을 출력하도록 요청해 주세요.'],
    ['WAYBILL_NOT_DISPATCHABLE', '한진 등록이 끝나지 않은 송장이에요. 출고 상세에서 운송장 발급 상태를 확인해 주세요.'],
    ['SHORT_PICK_WORK_ITEM_WAITING', '이 박스는 지금 결품을 보고할 수 없어요. 창고 담당자에게 송장을 다시 스캔하도록 요청해 주세요.'],
    ['SHORT_PICK_INVOICE_NOT_VOIDABLE', '송장을 지금 무효화할 수 없어 결품을 보고하지 못했어요. 출고 상세에서 송장 상태를 확인해 주세요.'],
  ])('shows administrator action for %s', (code, expected) => {
    expect(getServerDenyMessage({ statusCode: 409, response: { code, message: 'English server message' } })).toBe(expected);
  });

  it.each([
    ['SHIPMENT_WITHDRAWN', '배치에서 빠졌거나 빠지는 중인 박스예요. 창고 담당자에게 해당 송장을 사용하지 않도록 알려 주세요.'],
    [
      'WAYBILL_STALE',
      '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 출고 상세에서 송장 상태를 확인해 주세요. 재발급이 가능한 상태라면 재발급해 주세요.',
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
      '배치에서 빠졌거나 빠지는 중인 박스예요. 창고 담당자에게 해당 송장을 사용하지 않도록 알려 주세요.'
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
    ).toBe('출고 준비를 진행할 수 없어요. 배치와 송장 상태를 확인해 주세요.');
  });
});

describe('batch blocker toast fallback', () => {
  const { startBlocked, joinBlocked } = jest.requireActual(
    'apps/core/src/modules/fulfillment/picking/allocation/allocation.errors'
  );
  const blockers = [
    {
      shipmentId: 'shipment-full-id',
      reason: 'STOCK_SHORT',
      shipmentLineId: 'line-a',
      skuId: 'sku-a',
      requiredQty: 3,
      shortQty: 1,
      detail: null,
      trackingNo: null,
      skuCode: 'SKU-A',
      skuName: '상품 A',
    },
    {
      shipmentId: 'shipment-full-id',
      reason: 'STOCK_SHORT',
      shipmentLineId: 'line-b',
      skuId: 'sku-b',
      requiredQty: 2,
      shortQty: 0,
      detail: null,
      trackingNo: null,
      skuCode: 'SKU-B',
      skuName: null,
    },
  ];

  it.each([
    ['start', startBlocked('batch-1', blockers)],
    ['join', joinBlocked('shipment-full-id', blockers)],
  ])(
    'keeps the real core %s response details in a toast',
    (_operation, exception) => {
      const body = exception.getResponse() as {
        message: string;
        errors: unknown[];
      };
      const message = getServerDenyMessage({ statusCode: 409, response: body });
      expect(message).toContain('차단 항목 2건');
      expect(message).toContain('shipment-full-id');
      expect(message).toContain('상품 A');
      expect(message).toContain('SKU-A');
      expect(message).toContain('SKU-B');
      expect(message).toContain('3개 중 1개 부족');
      expect(message).toContain('2개 중 0개 부족');
      expect(message).toContain('재고 부족');
      expect(message).not.toContain(body.message);
      expect(message).not.toContain('박스 2개');
    }
  );

  it('keeps an unknown reason and every readable field', () => {
    const message = getServerDenyMessage({
      statusCode: 409,
      response: {
        code: 'BATCH_JOIN_BLOCKED',
        message: 'Shipment shipment-full-id cannot join: 1 blocker(s)',
        errors: [
          {
            shipmentId: 'shipment-full-id',
            reason: 'NEW_REASON',
            trackingNo: '123456789012',
            skuName: '상품 A',
            skuCode: 'SKU-A',
            requiredQty: 3,
            shortQty: null,
          },
        ],
      },
    });

    expect(message).toContain('123456789012');
    expect(message).toContain('상품 A');
    expect(message).toContain('SKU-A');
    expect(message).toContain('3개 중 ?개 부족');
    expect(message).toContain('NEW_REASON');
  });

  it('shows Korean guidance for a core waybill blocker', () => {
    const exception = joinBlocked('shipment-full-id', [
      {
        shipmentId: 'shipment-full-id',
        reason: 'WAYBILL_NOT_READY',
        shipmentLineId: null,
        skuId: null,
        requiredQty: null,
        shortQty: null,
        detail: 'WAYBILL_STALE: manifest changed',
        trackingNo: '123456789012',
        skuCode: null,
        skuName: null,
      },
    ]);
    const message = getServerDenyMessage({
      statusCode: 409,
      response: exception.getResponse(),
    });

    expect(message).toContain('송장 123456789012');
    expect(message).toContain('송장 미발급·재발급 필요');
    expect(message).not.toContain('WAYBILL_STALE: manifest changed');
    expect(message).not.toContain('?개');
  });

  it.each([null, {}])('keeps server-only identifiers when a blocker row is %p', (unreadable) => {
    const body = joinBlocked('shipment-full-id', blockers).getResponse() as {
      code: string;
      message: string;
      errors: unknown[];
    };
    const message = getServerDenyMessage({
      statusCode: 409,
      response: { ...body, errors: [body.errors[0], unreadable] },
    });

    expect(message).toContain('차단 항목 2건');
    expect(message).toContain('SKU-A');
    expect(message).toContain('일부 박스의 상세 사유를 확인하지 못했어요.');
    expect(message).toContain(body.message);
  });

  it.each([undefined, [], 'invalid'])(
    'keeps Korean guidance when errors are %p',
    (errors) => {
      const message = getServerDenyMessage({
        statusCode: 409,
        response: {
          code: 'BATCH_START_BLOCKED',
          message: 'Batch batch-1 cannot start: 0 blocker(s)',
          errors,
        },
      });

      expect(message).toContain('배치를 시작하지 못했어요.');
      expect(message).toContain('일부 박스의 상세 사유를 확인하지 못했어요.');
      expect(message).toContain('Batch batch-1 cannot start: 0 blocker(s)');
      if (Array.isArray(errors)) expect(message).toContain('차단 항목 0건');
    }
  );
});

describe('preparation reason message priority', () => {
  const show = (body: { code: string; message?: string; details?: unknown }) =>
    getServerDenyMessage({ statusCode: 409, response: body });

  // Current callers emit BATCH_NOT_STARTED and ACTIVE_WORK_REQUIRES_REVIEW;
  // the remaining reasons are compatibility contracts retained in core.
  it.each([
    [
      'BATCH_NOT_STARTED',
      'retry_preparation',
      '피킹 화면에서 「피킹 시작」을 먼저 눌러 주세요.',
    ],
    [
      'SOURCE_INSUFFICIENT',
      'retry_preparation',
      '출고할 재고가 부족해요. 재고를 확인한 뒤 다시 준비해 주세요.',
    ],
    [
      'REPLAN_LIMIT_REACHED',
      'retry_preparation',
      '출고 준비의 자동 재시도 한도에 도달했어요. 재고를 확인한 뒤 다시 준비해 주세요.',
    ],
    [
      'SOURCE_STOCK_CHANGED',
      'review_batch',
      '출고에 사용할 재고 상태가 바뀌었어요. 배치와 재고 상태를 확인해 주세요.',
    ],
    [
      'PLAN_IDENTITY_CHANGED',
      'review_batch',
      '출고 계획이 바뀌었어요. 배치와 송장 상태를 확인해 주세요.',
    ],
    [
      'PLAN_NOT_DRAFT',
      'review_batch',
      '현재 출고 계획은 초안 상태가 아니에요. 배치의 진행 상태를 확인해 주세요.',
    ],
    [
      'SHIPMENT_SNAPSHOT_CHANGED',
      'review_batch',
      '박스의 출고 정보가 바뀌었어요. 주문과 송장 상태를 확인해 주세요.',
    ],
    [
      'ALLOCATION_INVALID',
      'review_batch',
      '출고 재고 배정이 유효하지 않아요. 배치와 재고 배정 상태를 확인해 주세요.',
    ],
    [
      'ELIGIBILITY_CHANGED',
      'review_batch',
      '박스의 출고 가능 상태가 바뀌었어요. 주문과 배치 상태를 확인해 주세요.',
    ],
    [
      'ACTIVE_WORK_REQUIRES_REVIEW',
      'review_batch',
      '배치의 진행 중인 재고 작업을 확인할 수 없어요. 배치 상세에서 재고 작업 상태를 확인해 주세요.',
    ],
  ])(
    'translates the real core HTTP contract for %s / %s in both response shapes',
    (reasonCode, expectedRecovery, expectedMessage) => {
      const { preparationBlocked } = jest.requireActual(
        'apps/core/src/modules/fulfillment/services/outbound-preparation-result'
      );
      const { unwrapPreparedOutbound } = jest.requireActual(
        'apps/core/src/modules/fulfillment/controllers/outbound-preparation-http'
      );
      const body = (() => {
        try {
          unwrapPreparedOutbound(
            preparationBlocked('batch-1', null, reasonCode)
          );
        } catch (error) {
          return (
            error as {
              getResponse: () => {
                code: string;
                message: string;
                details: unknown;
              };
            }
          ).getResponse();
        }

        throw new Error(
          'Expected preparationBlocked to produce an HTTP exception'
        );
      })();

      expect(body.details).toEqual({ reasonCode, recovery: expectedRecovery });
      expect(getServerDenyMessage({ statusCode: 409, response: body })).toBe(
        expectedMessage
      );
      expect(
        getServerDenyMessage({ response: { status: 409, data: body } })
      ).toBe(expectedMessage);
      expect(body.code).toBe('SIMPLE_OUTBOUND_PLAN_INVALIDATED');
    }
  );

  it.each([
    ['BATCH_NOT_STARTED', 'review_batch'],
    ['SOURCE_INSUFFICIENT', 'review_batch'],
    ['SOURCE_STOCK_CHANGED', 'retry_preparation'],
  ])(
    'uses general guidance for an invalid reason/recovery pair: %s / %s',
    (reasonCode, recovery) => {
      expect(
        show({
          code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
          details: { reasonCode, recovery },
        })
      ).toBe('출고 준비를 진행할 수 없어요. 배치와 송장 상태를 확인해 주세요.');
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
      ).toBe('출고 준비를 진행할 수 없어요. 배치와 송장 상태를 확인해 주세요.');
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
    ).toBe('피킹 화면에서 「피킹 시작」을 먼저 눌러 주세요.');
  });
});

describe('batch blocker groups', () => {
  function group(errors: unknown, code = 'BATCH_START_BLOCKED') {
    return getBatchBlockerGroups(
      parseServerError({ response: { status: 409, data: { code, errors } } })
    );
  }
  it.each([
    ['INBOUND_PENDING', 'BATCH_START_BLOCKED', '창고 담당자에게 적치 완료를 요청한 뒤 다시 「피킹 시작」을 누르거나, 배치 상세에서 이 박스를 빼고 시작하세요.'],
    ['INBOUND_PENDING', 'BATCH_JOIN_BLOCKED', '창고 담당자에게 적치 완료를 요청한 뒤 다시 넣어 주세요.'],
    ['STOCK_SHORT', 'BATCH_START_BLOCKED', '배치 상세에서 이 박스를 빼고 시작하세요.'],
    ['STOCK_SHORT', 'BATCH_JOIN_BLOCKED', '재고가 모자라 이 배치에 넣을 수 없어요. 재고를 확인해 주세요.'],
    ['WAYBILL_NOT_READY', 'BATCH_START_BLOCKED', '출고 상세에서 송장 상태를 확인하고 발급(재발급)한 뒤 다시 시작하거나, 배치 상세에서 이 박스를 빼고 시작하세요.'],
    ['WAYBILL_NOT_READY', 'BATCH_JOIN_BLOCKED', '출고 상세에서 송장 상태를 확인하고 발급(재발급)한 뒤 다시 넣어 주세요.'],
    ['CANCEL_REQUESTED', 'BATCH_START_BLOCKED', '취소 처리가 끝날 때까지 이 박스는 출고할 수 없어요. 배치 상세에서 이 박스를 빼고 시작하세요.'],
  ])('guides the administrator for %s in %s', (reason, code, expected) => {
    const result = group([{ shipmentId: 'box-1', reason, requiredQty: 1, shortQty: 1 }], code);
    expect(result.groups[0].guidance).toBe(expected);
  });

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
    ).toContain('배치 상세에서 이 박스를 빼고 시작하세요.');
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
      '재고가 모자라 이 배치에 넣을 수 없어요. 재고를 확인해 주세요.'
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
