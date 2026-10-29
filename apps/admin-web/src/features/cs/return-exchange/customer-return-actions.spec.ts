import type {
  CustomerReturnPickup,
  CustomerReturnPickupStatus,
  CustomerReturnPrepayment,
  CustomerReturnSettlement,
  CustomerReturnStatus,
  CustomerReturnView,
} from '@/lib/types/dto/customer-returns';
import {
  availableCustomerReturnActions,
  releaseExchangeLabel,
  releaseExchangeSuccessMessage,
} from './customer-return-actions';

const settlement = (
  o: Partial<CustomerReturnSettlement> = {}
): CustomerReturnSettlement => ({
  state: 'refused',
  refundMode: 'auto',
  startedAt: '2026-10-01T00:00:00Z',
  lastIssuedAt: '2026-10-01T00:00:00Z',
  attempts: 1,
  lastFailure: null,
  ...o,
});
const failure = (code: string) => ({
  code,
  message: 'm',
  retryable: false,
  received: false,
  at: '2026-10-01T00:00:00Z',
});

const prepayment = (
  o: Partial<CustomerReturnPrepayment> = {}
): CustomerReturnPrepayment => ({
  state: 'refused',
  refundMode: 'auto',
  requestedAmount: 1000,
  memo: '',
  requestedBy: 'u',
  startedAt: '2026-10-01T00:00:00Z',
  lastIssuedAt: '2026-10-01T00:00:00Z',
  attempts: 1,
  issues: 0,
  lastFailure: null,
  outcome: null,
  ...o,
});
const pfail = (code: string) => ({
  code,
  message: 'm',
  retryable: false,
  at: '2026-10-01T00:00:00Z',
});

function view(
  status: CustomerReturnStatus,
  o: {
    arrived?: number;
    expected?: number;
    missing?: number;
  } & Partial<CustomerReturnView> = {}
): CustomerReturnView {
  const { arrived = 2, expected = 2, missing = 0, ...rest } = o;
  return {
    id: 'r1',
    salesOrderId: 'so1',
    order: { orderNo: 'N1', channelOrderId: 'c1', salesChannel: 'medusa' },
    channelReturnId: 'cr1',
    status,
    kind: 'return',
    exchangeReleasedAt: null,
    reason: 'defective',
    note: null,
    feeBearer: 'seller',
    requestedBy: 'u',
    warehouseId: null,
    windowOverrideReason: null,
    requestedAt: '2026-10-01T00:00:00Z',
    cancelledAt: null,
    arrivedAt: null,
    refundDueAt: null,
    inspectedAt: null,
    settledAt: null,
    settlement: null,
    settlementOutcome: null,
    prepayment: null,
    csResolution: null,
    pickup: null,
    lines: [
      {
        id: 'l1',
        salesOrderLineId: 'sol1',
        channelOrderItemId: 'i1',
        productName: 'p',
        quantity: expected,
        missingQty: missing,
        items: [
          {
            id: 'it1',
            skuId: 's',
            skuName: 'n',
            skuCode: 'c',
            qtyPerUnit: 1,
            expectedQty: expected,
            arrivedQty: arrived,
            acceptedQty: null,
            rejectedQty: null,
            heldQty: null,
          },
        ],
      },
    ],
    ...rest,
  };
}

const kinds = (v: CustomerReturnView) =>
  availableCustomerReturnActions(v).map((a) => a.kind);
const find = (v: CustomerReturnView, kind: string) =>
  availableCustomerReturnActions(v).find((a) => a.kind === kind);

describe('availableCustomerReturnActions', () => {
  describe('cancel', () => {
    it('expected 이고 선환불이 없으면 보인다', () => {
      expect(kinds(view('expected', { arrived: 0 }))).toContain('cancel');
    });
    it('선환불 done 이면 취소도 선환불도 없다', () => {
      const v = view('expected', {
        arrived: 0,
        prepayment: prepayment({ state: 'done' }),
      });
      expect(kinds(v)).not.toContain('cancel');
      expect(kinds(v)).not.toContain('prepay');
    });
    it('arrived 에서는 안 보인다', () => {
      expect(kinds(view('arrived'))).not.toContain('cancel');
    });
  });

  describe('closeMissing', () => {
    it('arrived 덜 도착이면 보인다', () => {
      expect(kinds(view('arrived', { arrived: 1, expected: 2 }))).toContain(
        'closeMissing'
      );
    });
    it('다 도착했으면 안 보인다', () => {
      expect(kinds(view('arrived'))).not.toContain('closeMissing');
    });
    it('이미 missingQty 가 있으면 안 보인다', () => {
      expect(kinds(view('arrived', { arrived: 1, missing: 1 }))).not.toContain(
        'closeMissing'
      );
    });
    it('선환불 in_progress 이면 안 보인다', () => {
      const v = view('arrived', {
        arrived: 1,
        prepayment: prepayment({ state: 'in_progress' }),
      });
      expect(kinds(v)).not.toContain('closeMissing');
    });
    it('선환불 stalled·done 이어도 안 보인다', () => {
      expect(
        kinds(
          view('arrived', {
            arrived: 1,
            prepayment: prepayment({ state: 'stalled' }),
          })
        )
      ).not.toContain('closeMissing');
      expect(
        kinds(
          view('arrived', {
            arrived: 1,
            prepayment: prepayment({ state: 'done' }),
          })
        )
      ).not.toContain('closeMissing');
    });
    it('선환불 refused 면 보인다', () => {
      expect(
        kinds(
          view('arrived', {
            arrived: 1,
            prepayment: prepayment({ state: 'refused' }),
          })
        )
      ).toContain('closeMissing');
    });
    it('expected 에서는 안 보인다', () => {
      expect(kinds(view('expected', { arrived: 0 }))).not.toContain(
        'closeMissing'
      );
    });
  });

  describe('settleHeld', () => {
    it('held 에서 보인다', () => {
      expect(kinds(view('held'))).toContain('settleHeld');
    });
    it('refund_pending 에서는 안 보인다', () => {
      expect(kinds(view('refund_pending'))).not.toContain('settleHeld');
    });
  });

  describe('prepay', () => {
    it('expected·arrived 에 선환불이 없으면 보인다', () => {
      expect(kinds(view('expected', { arrived: 0 }))).toContain('prepay');
      expect(kinds(view('arrived'))).toContain('prepay');
    });
    it('missingQty 합이 0 이 아니면 안 보인다', () => {
      expect(kinds(view('arrived', { arrived: 1, missing: 1 }))).not.toContain(
        'prepay'
      );
    });
    it('inspected 에서는 안 보인다', () => {
      expect(kinds(view('inspected'))).not.toContain('prepay');
    });
    it('refused + return_prepay_rejected: 면 선환불이 있고 다시 시도는 없다', () => {
      const v = view('arrived', {
        prepayment: prepayment({
          lastFailure: pfail(
            'return_prepay_rejected:prepay_exceeds_item_value'
          ),
        }),
      });
      expect(kinds(v)).toContain('prepay');
      expect(kinds(v)).not.toContain('retryPrepayment');
      expect(kinds(v)).not.toContain('manualPrepayment');
    });
    it('refused + 그 밖의 코드면 선환불이 없다', () => {
      const v = view('arrived', {
        prepayment: prepayment({
          lastFailure: pfail('wallet_refund_refused:x'),
        }),
      });
      expect(kinds(v)).not.toContain('prepay');
    });
    it('선환불이 in_progress 면 안 보인다', () => {
      expect(
        kinds(
          view('arrived', { prepayment: prepayment({ state: 'in_progress' }) })
        )
      ).not.toContain('prepay');
    });
  });

  describe('retrySettlement · manualSettlement', () => {
    it.each(['inspected', 'refund_pending'] as const)(
      '%s + refused 에서 둘 다 보인다',
      (status) => {
        const v = view(status, { settlement: settlement() });
        expect(kinds(v)).toEqual(
          expect.arrayContaining(['retrySettlement', 'manualSettlement'])
        );
      }
    );
    it('stalled 에서도 보인다', () => {
      expect(
        kinds(
          view('inspected', { settlement: settlement({ state: 'stalled' }) })
        )
      ).toContain('retrySettlement');
    });
    it('in_progress·done 이면 안 보인다', () => {
      expect(
        kinds(
          view('inspected', {
            settlement: settlement({ state: 'in_progress' }),
          })
        )
      ).not.toContain('retrySettlement');
      expect(
        kinds(view('inspected', { settlement: settlement({ state: 'done' }) }))
      ).not.toContain('retrySettlement');
    });
    it('held 에서는 안 보인다', () => {
      expect(kinds(view('held', { settlement: settlement() }))).not.toContain(
        'retrySettlement'
      );
    });
    it('정산이 manual 이면 계좌 송금만 빠진다', () => {
      const v = view('refund_pending', {
        settlement: settlement({ refundMode: 'manual' }),
      });
      expect(kinds(v)).toContain('retrySettlement');
      expect(kinds(v)).not.toContain('manualSettlement');
    });
    it('외부 환불 거절이면 «이미 환불한 금액» 칸', () => {
      const v = view('refund_pending', {
        settlement: settlement({
          lastFailure: failure(
            'return_settle_rejected:external_refund_unresolved'
          ),
        }),
      });
      expect(find(v, 'retrySettlement')?.needs).toBe('alreadyRefundedAmount');
    });
    it('배송 방법 없는 거절이면 «보류 차감 빼기»', () => {
      const v = view('refund_pending', {
        settlement: settlement({
          lastFailure: failure(
            'return_settle_rejected:no_charge_shipping_option'
          ),
        }),
      });
      expect(find(v, 'retrySettlement')?.needs).toBe('dropHoldDeduction');
    });
    it('no_charge_shipping_option 은 정확히 같을 때만', () => {
      const v = view('refund_pending', {
        settlement: settlement({
          lastFailure: failure(
            'return_settle_rejected:no_charge_shipping_option_x'
          ),
        }),
      });
      expect(find(v, 'retrySettlement')?.needs).toBeUndefined();
    });
    it('모르는 코드·실패 없음이면 needs 없음', () => {
      expect(
        find(
          view('refund_pending', { settlement: settlement() }),
          'retrySettlement'
        )?.needs
      ).toBeUndefined();
      const v = view('refund_pending', {
        settlement: settlement({ lastFailure: failure('foo') }),
      });
      expect(find(v, 'retrySettlement')?.needs).toBeUndefined();
    });
  });

  describe('retryPrepayment · manualPrepayment', () => {
    it('refused + wallet_refund_refused: 면 둘 다 보이고 선환불은 없다', () => {
      const v = view('arrived', {
        prepayment: prepayment({
          lastFailure: pfail('wallet_refund_refused:x'),
        }),
      });
      expect(kinds(v)).toEqual(
        expect.arrayContaining(['retryPrepayment', 'manualPrepayment'])
      );
      expect(kinds(v)).not.toContain('prepay');
    });
    it('stalled 에서도 보인다', () => {
      expect(
        kinds(
          view('expected', {
            arrived: 0,
            prepayment: prepayment({ state: 'stalled' }),
          })
        )
      ).toContain('retryPrepayment');
    });
    it('선환불이 manual 이면 계좌 송금만 빠진다', () => {
      const v = view('arrived', {
        prepayment: prepayment({ refundMode: 'manual' }),
      });
      expect(kinds(v)).toContain('retryPrepayment');
      expect(kinds(v)).not.toContain('manualPrepayment');
    });
    it('in_progress·done 이면 안 보인다', () => {
      expect(
        kinds(
          view('arrived', { prepayment: prepayment({ state: 'in_progress' }) })
        )
      ).not.toContain('retryPrepayment');
      expect(
        kinds(
          view('expected', {
            arrived: 0,
            prepayment: prepayment({ state: 'done' }),
          })
        )
      ).not.toContain('retryPrepayment');
    });
    it('inspected 에서는 안 보인다', () => {
      expect(
        kinds(view('inspected', { prepayment: prepayment() }))
      ).not.toContain('retryPrepayment');
    });
  });

  it('settled·cancelled 는 버튼이 없다', () => {
    expect(availableCustomerReturnActions(view('settled'))).toEqual([]);
    expect(availableCustomerReturnActions(view('cancelled'))).toEqual([]);
  });

  it('표의 행 순서를 지킨다', () => {
    const v = view('arrived', {
      arrived: 1,
      prepayment: prepayment({ lastFailure: pfail('wallet_refund_refused:x') }),
    });
    expect(kinds(v)).toEqual([
      'closeMissing',
      'retryPrepayment',
      'manualPrepayment',
    ]);
  });
});

describe('retryPickup', () => {
  const pickup = (
    status: CustomerReturnPickupStatus
  ): CustomerReturnPickup => ({
    status,
    waybillNo: null,
    originalWaybillNo: null,
    lastError: null,
    attempts: 1,
    reservedAt: null,
    pickedUpAt: null,
    cancelledAt: null,
    createdAt: '2026-10-01T00:00:00Z',
  });
  const has = (v: CustomerReturnView) => kinds(v).includes('retryPickup');

  it('expected + failed 면 보인다', () => {
    expect(
      has(view('expected', { arrived: 0, pickup: pickup('failed') }))
    ).toBe(true);
  });
  it('expected + 회수 행 없음이면 보인다', () => {
    expect(has(view('expected', { arrived: 0, pickup: null }))).toBe(true);
  });
  it('expected + cancelled 면 보인다', () => {
    expect(
      has(view('expected', { arrived: 0, pickup: pickup('cancelled') }))
    ).toBe(true);
  });
  it('expected + void 면 보인다 — 회수만 놓아주고 반품 취소가 실패한 경우(R8)', () => {
    expect(has(view('expected', { arrived: 0, pickup: pickup('void') }))).toBe(
      true
    );
  });
  it('expected + 활성 회수(reserved·pending·cancel_pending)면 안 보인다', () => {
    for (const s of ['reserved', 'pending', 'cancel_pending'] as const)
      expect(has(view('expected', { arrived: 0, pickup: pickup(s) }))).toBe(
        false
      );
  });
  it('arrived + failed 면 안 보인다', () => {
    expect(has(view('arrived', { pickup: pickup('failed') }))).toBe(false);
  });
});

describe('교환 (K8 PR11b N13)', () => {
  const RELEASED = '2026-10-02T00:00:00Z';
  const ex = (
    status: CustomerReturnStatus,
    o: Parameters<typeof view>[1] = {}
  ): CustomerReturnView => view(status, { kind: 'exchange', ...o });

  it('expected·열림 없음 → cancel·releaseExchange(교환품 보내기)·retryPickup, prepay 없음', () => {
    const v = ex('expected', { arrived: 0 });
    expect(kinds(v)).toEqual(['cancel', 'releaseExchange', 'retryPickup']);
    expect(releaseExchangeLabel(v)).toBe('교환품 보내기');
  });

  it('expected·열림 있음 → cancel 없음·releaseExchange 없음', () => {
    const v = ex('expected', { arrived: 0, exchangeReleasedAt: RELEASED });
    expect(kinds(v)).not.toContain('cancel');
    expect(kinds(v)).not.toContain('releaseExchange');
    expect(kinds(v)).not.toContain('prepay');
  });

  it('arrived·열림 없음 → releaseExchange 가 있고 선환불은 없다', () => {
    const v = ex('arrived');
    expect(kinds(v)).toEqual(['releaseExchange']);
  });

  it('arrived·덜 도착 → closeMissing 없음', () => {
    const v = ex('arrived', { arrived: 1, expected: 2 });
    expect(kinds(v)).not.toContain('closeMissing');
    expect(kinds(v)).toContain('releaseExchange');
  });

  it('held·열림 없음 → releaseExchange(교환품 보내기), settleHeld 없음', () => {
    const v = ex('held');
    expect(kinds(v)).toEqual(['releaseExchange']);
    expect(releaseExchangeLabel(v)).toBe('교환품 보내기');
  });

  it('held·열림 있음 → releaseExchange(교환 정산 열기) 만 — 도착 전 취소·보류 정산 없음', () => {
    const v = ex('held', { exchangeReleasedAt: RELEASED });
    expect(kinds(v)).toEqual(['releaseExchange']);
    expect(releaseExchangeLabel(v)).toBe('교환 정산 열기');
  });

  it('refund_pending + 외부 환불 거절 → retrySettlement needs 없음, manualSettlement 없음', () => {
    const v = ex('refund_pending', {
      exchangeReleasedAt: RELEASED,
      settlement: settlement({
        lastFailure: failure('return_settle_rejected:external_refund_unresolved'),
      }),
    });
    expect(kinds(v)).toEqual(['retrySettlement']);
    expect(find(v, 'retrySettlement')?.needs).toBeUndefined();
  });

  it('refund_pending + 배송 방법 없는 거절도 needs 없음', () => {
    const v = ex('refund_pending', {
      settlement: settlement({
        lastFailure: failure('return_settle_rejected:no_charge_shipping_option'),
      }),
    });
    expect(find(v, 'retrySettlement')?.needs).toBeUndefined();
    expect(kinds(v)).not.toContain('manualSettlement');
  });

  it('선환불 기록이 있어도 선환불 다시 시도·계좌 송금은 없다', () => {
    const v = ex('arrived', {
      prepayment: prepayment({ lastFailure: pfail('wallet_refund_refused:x') }),
    });
    expect(kinds(v)).not.toContain('retryPrepayment');
    expect(kinds(v)).not.toContain('manualPrepayment');
    expect(kinds(v)).not.toContain('prepay');
  });

  it('arrived 이고 이미 보냈으면 버튼이 하나도 없다', () => {
    expect(kinds(ex('arrived', { exchangeReleasedAt: RELEASED }))).toEqual([]);
  });

  it('inspected·settled → releaseExchange 없음', () => {
    expect(kinds(ex('inspected', { exchangeReleasedAt: RELEASED }))).not.toContain('releaseExchange');
    expect(kinds(ex('inspected'))).not.toContain('releaseExchange');
    expect(kinds(ex('settled', { exchangeReleasedAt: RELEASED }))).toEqual([]);
    expect(kinds(ex('cancelled'))).toEqual([]);
  });

  it('반품 → releaseExchange 없음', () => {
    for (const s of ['expected', 'arrived', 'held', 'inspected'] as const)
      expect(kinds(view(s, { arrived: s === 'expected' ? 0 : 2 }))).not.toContain('releaseExchange');
  });

  it('성공 문구 — 열기 전이면 출고 지시, 열린 보류면 정산 열기', () => {
    expect(releaseExchangeSuccessMessage(ex('arrived'))).toBe(
      '교환품 출고를 지시했습니다 — 상자는 출고 화면에 나타납니다'
    );
    expect(releaseExchangeSuccessMessage(ex('held', { exchangeReleasedAt: RELEASED }))).toBe(
      '교환 정산을 열었습니다'
    );
  });
});
