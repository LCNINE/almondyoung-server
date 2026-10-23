import { getTableName } from 'drizzle-orm';
import { CancellationRefundManager } from './cancellation-refund.manager';
import { calculatePartialCancellationRefund } from './partial-cancellation-refund-calculator';
import type { WalletRefundClient, WalletRefundOutcome } from '../services/wallet-refund.client';

const SO_ID = 'so-1';
const INTENT = 'wi-1';

function makeSo(over: Record<string, unknown> = {}) {
  return {
    id: SO_ID,
    channelOrderId: 'co-1',
    salesChannel: '3pl',
    status: 'cancelled',
    walletIntentId: INTENT,
    totalAmount: 50000,
    shippingFee: 0,
    ...over,
  };
}

const SUCCESS: WalletRefundOutcome = {
  kind: 'success',
  refunds: [
    {
      refundId: 'rf-1',
      intentId: INTENT,
      status: 'SUCCEEDED',
      amount: 50000,
      currency: 'KRW',
      reasonCode: null,
      reasonMessage: null,
      manualConfirmable: false,
    },
  ],
};

type Link = { id: string; metadata: Record<string, unknown> };

/**
 * 읽기만 흉내 낸다. 테이블 이름으로 행을 고르고, createBusinessLink 가 불리면 링크 목록 맨 앞(최신)에 붙인다 —
 * 그래서 «두 번 누르기» 같은 이력 의존 규칙을 실제 쓰기 결과로 확인할 수 있다.
 */
function makeFixture(
  opts: {
    so?: ReturnType<typeof makeSo>;
    links?: Link[];
    orderLines?: Array<{ id: string; quantity: number; unitPrice: number | null }>;
    outcome?: WalletRefundOutcome;
    linkError?: Error;
  } = {},
) {
  const so = opts.so ?? makeSo();
  const links: Link[] = [...(opts.links ?? [])];
  const rowsFor = (table: unknown): unknown[] => {
    const name = getTableName(table as Parameters<typeof getTableName>[0]);
    if (name === 'sales_orders') return [so];
    if (name === 'sales_order_lines') return opts.orderLines ?? [];
    if (name === 'business_links') return links;
    return [];
  };
  const chain = (rows: unknown[]) => {
    const c = {
      orderBy: () => c,
      limit: () => c,
      then: (res: (r: unknown[]) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    };
    return c;
  };
  const dbRaw = {
    select: jest.fn(() => ({ from: (table: unknown) => ({ where: () => chain(rowsFor(table)) }) })),
  };
  const dbMock = { db: dbRaw, run: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(dbRaw)) };
  let seq = 0;
  const salesOrders = {
    createBusinessLink: jest.fn((_id: string, dto: { metadata: Record<string, unknown> }) => {
      if (opts.linkError) return Promise.reject(opts.linkError);
      seq += 1;
      links.unshift({ id: `new-${seq}`, metadata: dto.metadata });
      return Promise.resolve(undefined);
    }),
  };
  const wallet = { refundByIntent: jest.fn().mockResolvedValue(opts.outcome ?? SUCCESS) };
  const manager = new CancellationRefundManager(
    dbMock as never,
    salesOrders as never,
    wallet as unknown as WalletRefundClient,
  );
  return { manager, salesOrders, wallet, links, tx: dbRaw as never, so };
}

const recorded = (f: ReturnType<typeof makeFixture>, n = 0) =>
  (f.salesOrders.createBusinessLink.mock.calls[n] as [string, { metadata: Record<string, unknown> }])[1].metadata;

describe('CancellationRefundManager', () => {
  describe('effectFor — 취소와 같은 트랜잭션에 남길 환불 방침', () => {
    it('즉시 + 전체 → requested, 금액 없음, intent 외부 참조', async () => {
      const f = makeFixture();
      const effect = await f.manager.effectFor('immediate', f.so as never, undefined, 'CHANGE_OF_MIND', f.tx);
      expect(effect).toEqual({
        externalRef: 'wallet:intent:wi-1',
        refundStatus: 'requested',
        metadata: { intentId: INTENT, reasonCode: 'CHANGE_OF_MIND', actor: 'customer' },
      });
      expect(effect.amount).toBeUndefined();
    });

    it('즉시 + 전체 + intent 없음 → wallet:manual:<so>', async () => {
      const f = makeFixture({ so: makeSo({ walletIntentId: null }) });
      const effect = await f.manager.effectFor('immediate', f.so as never, undefined, undefined, f.tx);
      expect(effect.externalRef).toBe('wallet:manual:so-1');
      expect(effect.refundStatus).toBe('requested');
    });

    it('나중 + 전체 → manual_pending, awaitingDecision', async () => {
      const f = makeFixture();
      const effect = await f.manager.effectFor('decide_later', f.so as never, [], undefined, f.tx);
      expect(effect.refundStatus).toBe('manual_pending');
      expect(effect.metadata).toMatchObject({
        awaitingDecision: true,
        note: '관리자 환불 결정 대기',
        intentId: INTENT,
        actor: 'admin',
      });
    });

    it('부분 → 추정액이 계산기 값과 같고 awaitingDecision', async () => {
      const orderLines = [{ id: 'l-1', quantity: 2, unitPrice: 25000 }];
      const f = makeFixture({ orderLines });
      const lines = [{ salesOrderLineId: 'l-1', quantity: 1 }];
      const effect = await f.manager.effectFor('decide_later', f.so as never, lines, 'OTHER', f.tx);
      const expected = calculatePartialCancellationRefund({
        salesChannel: '3pl',
        walletIntentId: INTENT,
        totalAmount: 50000,
        shippingFee: 0,
        allOrderLines: orderLines,
        cancelledLines: lines,
      });
      expect(effect.refundStatus).toBe('manual_pending');
      expect(effect.metadata).toMatchObject({
        cancellationScope: 'partial',
        refundEstimateAmount: expected.refundEstimateAmount,
        manualReason: expected.manualReason,
        cancelledLines: lines,
        awaitingDecision: true,
        note: `부분취소 수동 검토 필요: ${expected.manualReason}`,
        actor: 'admin',
      });
    });

    it('부분은 방침이 즉시여도 manual_pending 이고 actor 만 customer', async () => {
      const f = makeFixture({ orderLines: [{ id: 'l-1', quantity: 2, unitPrice: 25000 }] });
      const effect = await f.manager.effectFor(
        'immediate',
        f.so as never,
        [{ salesOrderLineId: 'l-1', quantity: 1 }],
        undefined,
        f.tx,
      );
      expect(effect.refundStatus).toBe('manual_pending');
      expect(effect.metadata).toMatchObject({ actor: 'customer', awaitingDecision: true });
    });
  });

  describe('executeRequested', () => {
    it('최신이 requested → Wallet 호출(correlationId cancel:<oc>:initial), 결과 링크 succeeded', async () => {
      const f = makeFixture({
        links: [
          { id: 'k-1', metadata: { refundStatus: 'requested', orderCancellationId: 'oc-1', reasonCode: 'OTHER' } },
        ],
      });
      await expect(f.manager.executeRequested(SO_ID)).resolves.toBe('succeeded');
      expect(f.wallet.refundByIntent).toHaveBeenCalledWith(
        INTENT,
        50000,
        expect.objectContaining({ correlationId: 'cancel:oc-1:initial', reasonCode: 'OTHER' }),
      );
      expect(recorded(f)).toMatchObject({ refundStatus: 'succeeded', actor: 'customer', attemptType: 'initial' });
      // 결정 대기 표지는 막힌 기록에만 붙는다 — 성공 행엔 없다
      expect(recorded(f).awaitingDecision).toBeUndefined();
    });

    it.each([[{ kind: 'wallet_unavailable', errorMessage: 'm' }], [{ kind: 'in_flight', errorMessage: 'm' }]] as Array<
      [WalletRefundOutcome]
    >)(
      'Wallet 이 %j 로 막으면 awaitingDecision manual_pending — 목록에서 실행·안 함을 고를 수 있다 (I2)',
      async (outcome) => {
        const f = makeFixture({
          outcome,
          links: [{ id: 'k-1', metadata: { refundStatus: 'requested', orderCancellationId: 'oc-1' } }],
        });
        await expect(f.manager.executeRequested(SO_ID)).resolves.toBe('manual_pending');
        expect(recorded(f)).toMatchObject({ refundStatus: 'manual_pending', awaitingDecision: true });
      },
    );

    it('walletIntentId 가 없어 막혀도 awaitingDecision manual_pending (I2)', async () => {
      const f = makeFixture({
        so: makeSo({ walletIntentId: null }),
        links: [{ id: 'k-1', metadata: { refundStatus: 'requested', orderCancellationId: 'oc-1' } }],
      });
      await expect(f.manager.executeRequested(SO_ID)).resolves.toBe('manual_pending');
      expect(f.wallet.refundByIntent).not.toHaveBeenCalled();
      expect(recorded(f)).toMatchObject({ refundStatus: 'manual_pending', awaitingDecision: true });
    });

    it('최신이 succeeded → Wallet 미호출, null', async () => {
      const f = makeFixture({
        links: [
          { id: 'k-2', metadata: { refundStatus: 'succeeded' } },
          { id: 'k-1', metadata: { refundStatus: 'requested', orderCancellationId: 'oc-1' } },
        ],
      });
      await expect(f.manager.executeRequested(SO_ID)).resolves.toBeNull();
      expect(f.wallet.refundByIntent).not.toHaveBeenCalled();
    });

    it('주문이 아직 cancelled 가 아니면(박스 작업 중이라 대기) Wallet 미호출, null', async () => {
      const f = makeFixture({
        so: makeSo({ status: 'confirmed' }),
        links: [{ id: 'k-1', metadata: { refundStatus: 'requested', orderCancellationId: 'oc-1' } }],
      });
      await expect(f.manager.executeRequested(SO_ID)).resolves.toBeNull();
      expect(f.wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });

  describe('waive — 환불 안 함', () => {
    it('미결 awaitingDecision 링크를 completedRefundLinkId 로 닫는다', async () => {
      const f = makeFixture({
        links: [{ id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } }],
      });
      await expect(f.manager.waive(SO_ID, { adminNote: '고객 철회' })).resolves.toEqual({ refundStatus: 'waived' });
      expect(recorded(f)).toMatchObject({
        refundStatus: 'waived',
        completedRefundLinkId: 'k-1',
        note: '환불 안 함: 고객 철회',
        actor: 'admin',
      });
    });

    it('메모가 없으면 note 는 «환불 안 함»', async () => {
      const f = makeFixture({
        links: [{ id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } }],
      });
      await f.manager.waive(SO_ID, {});
      expect(recorded(f)).toMatchObject({ note: '환불 안 함' });
    });

    it('최신이 requested 여도 대상이 된다', async () => {
      const f = makeFixture({ links: [{ id: 'k-1', metadata: { refundStatus: 'requested' } }] });
      await f.manager.waive(SO_ID, {});
      expect(recorded(f)).toMatchObject({ completedRefundLinkId: 'k-1' });
    });

    it('대상이 없으면 400', async () => {
      const f = makeFixture({ links: [{ id: 'k-1', metadata: { refundStatus: 'succeeded' } }] });
      await expect(f.manager.waive(SO_ID, {})).rejects.toThrow('환불 결정 대기 건이 없습니다.');
      expect(f.salesOrders.createBusinessLink).not.toHaveBeenCalled();
    });

    it('두 번 부르면 두 번째는 쓰지 않고 waived', async () => {
      const f = makeFixture({
        links: [{ id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } }],
      });
      await f.manager.waive(SO_ID, {});
      await expect(f.manager.waive(SO_ID, {})).resolves.toEqual({ refundStatus: 'waived' });
      await expect(f.manager.waive(SO_ID, { refundLinkId: 'k-1' })).resolves.toEqual({ refundStatus: 'waived' });
      expect(f.salesOrders.createBusinessLink).toHaveBeenCalledTimes(1);
    });

    it('명시 대상이 succeeded 로 닫혀 있으면 400 — 모순되는 waived 를 쓰지 않는다', async () => {
      const f = makeFixture({
        links: [
          { id: 'k-2', metadata: { refundStatus: 'succeeded', completedRefundLinkId: 'k-1' } },
          { id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } },
        ],
      });
      await expect(f.manager.waive(SO_ID, { refundLinkId: 'k-1' })).rejects.toThrow('이미 환불이 완료된 건입니다.');
      expect(f.salesOrders.createBusinessLink).not.toHaveBeenCalled();
    });

    it('명시 대상이 결정 대기가 아니면(awaitingDecision 없는 manual_pending·failed) 400', async () => {
      const f = makeFixture({
        links: [
          { id: 'k-2', metadata: { refundStatus: 'failed' } },
          { id: 'k-1', metadata: { refundStatus: 'manual_pending' } },
        ],
      });
      for (const refundLinkId of ['k-1', 'k-2', 'nope']) {
        await expect(f.manager.waive(SO_ID, { refundLinkId })).rejects.toThrow('환불 결정 대기 건이 없습니다.');
      }
      expect(f.salesOrders.createBusinessLink).not.toHaveBeenCalled();
    });

    it('대상보다 새 succeeded 가 있으면 400 — 이미 환불된 주문에 waived 를 쓰지 않는다 (C1)', async () => {
      const f = makeFixture({
        links: [
          { id: 'k-2', metadata: { refundStatus: 'succeeded' } },
          { id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } },
        ],
      });
      await expect(f.manager.waive(SO_ID, {})).rejects.toThrow('이미 환불이 완료된 건입니다.');
      await expect(f.manager.waive(SO_ID, { refundLinkId: 'k-1' })).rejects.toThrow('이미 환불이 완료된 건입니다.');
      expect(f.salesOrders.createBusinessLink).not.toHaveBeenCalled();
    });

    it('기록이 실패하면 삼키지 않고 던진다', async () => {
      const f = makeFixture({
        links: [{ id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } }],
        linkError: new Error('db down'),
      });
      await expect(f.manager.waive(SO_ID, {})).rejects.toThrow('db down');
    });
  });

  describe('retry', () => {
    it('succeeded → Wallet 미호출', async () => {
      const f = makeFixture({ links: [{ id: 'k', metadata: { refundStatus: 'succeeded' } }] });
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'succeeded' });
      expect(f.wallet.refundByIntent).not.toHaveBeenCalled();
    });

    it('pending → Wallet 미호출 (중복 재시도 방지)', async () => {
      const f = makeFixture({ links: [{ id: 'k', metadata: { refundStatus: 'pending' } }] });
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'pending' });
      expect(f.wallet.refundByIntent).not.toHaveBeenCalled();
    });

    it('최신 waived → 400, Wallet 미호출', async () => {
      const f = makeFixture({ links: [{ id: 'k', metadata: { refundStatus: 'waived' } }] });
      await expect(f.manager.retry(SO_ID)).rejects.toThrow('환불하지 않기로 한 주문입니다.');
      expect(f.wallet.refundByIntent).not.toHaveBeenCalled();
    });

    it('walletIntentId 없으면 400', async () => {
      const f = makeFixture({
        so: makeSo({ walletIntentId: null }),
        links: [{ id: 'k', metadata: { refundStatus: 'manual_pending' } }],
      });
      await expect(f.manager.retry(SO_ID)).rejects.toThrow('자동 재시도가 불가합니다');
    });

    it('totalAmount 없으면 400', async () => {
      const f = makeFixture({
        so: makeSo({ totalAmount: null }),
        links: [{ id: 'k', metadata: { refundStatus: 'manual_pending' } }],
      });
      await expect(f.manager.retry(SO_ID)).rejects.toThrow('환불 금액 정보가 없어');
    });

    it('failed → 새 key cancel:{id}:retry:{uuid} 로 Wallet 호출', async () => {
      const f = makeFixture({ links: [{ id: 'k', metadata: { refundStatus: 'failed' } }] });
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'succeeded' });
      const [, , opts] = f.wallet.refundByIntent.mock.calls[0] as [string, number, { correlationId: string }];
      expect(opts.correlationId).toMatch(/^cancel:so-1:retry:[0-9a-f-]{36}$/);
    });

    it('링크 없음(3pl) → Wallet 호출', async () => {
      const f = makeFixture();
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'succeeded' });
      expect(f.wallet.refundByIntent).toHaveBeenCalledTimes(1);
    });

    it('채널(medusa) 주문인데 링크가 없으면 400 — wallet 을 부르지 않는다', async () => {
      const f = makeFixture({ so: makeSo({ salesChannel: 'medusa' }) });
      await expect(f.manager.retry(SO_ID)).rejects.toThrow('채널 주문의 환불은 채널이 처리합니다.');
      expect(f.wallet.refundByIntent).not.toHaveBeenCalled();
    });

    it('결정 대기 manual_pending 을 실행해 성공하면 성공 링크가 그 건을 닫는다 — 뒤의 «환불 안 함» 은 400 (C1)', async () => {
      const f = makeFixture({
        links: [{ id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } }],
      });
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'succeeded' });
      expect(recorded(f)).toMatchObject({ refundStatus: 'succeeded', completedRefundLinkId: 'k-1' });
      await expect(f.manager.waive(SO_ID, { refundLinkId: 'k-1' })).rejects.toThrow('이미 환불이 완료된 건입니다.');
      expect(f.salesOrders.createBusinessLink).toHaveBeenCalledTimes(1);
    });

    it('멈춘 requested 를 실행해 성공하면 성공 링크가 그 요청을 가리킨다 (C1)', async () => {
      const f = makeFixture({ links: [{ id: 'k-1', metadata: { refundStatus: 'requested' } }] });
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'succeeded' });
      expect(recorded(f)).toMatchObject({ refundStatus: 'succeeded', completedRefundLinkId: 'k-1' });
    });

    it('결정 대기 건 실행이 Wallet 장애로 막히면 failed 로 남기고 그 건이 계속 유일한 결정 대기다 — 다음 성공이 그 건을 닫는다 (I2)', async () => {
      const f = makeFixture({
        outcome: { kind: 'wallet_unavailable', errorMessage: 'down' },
        links: [{ id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } }],
      });
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'failed' });
      expect(recorded(f)).toMatchObject({ refundStatus: 'failed', completedRefundLinkId: 'k-1' });
      // 두 번째 manual_pending 이 생기면 성공·안 함이 하나만 닫아 다른 하나가 목록에 영영 남는다
      expect(f.links.filter((l) => l.metadata.refundStatus === 'manual_pending').map((l) => l.id)).toEqual(['k-1']);

      f.wallet.refundByIntent.mockResolvedValueOnce(SUCCESS);
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'succeeded' });
      expect(recorded(f, 1)).toMatchObject({ refundStatus: 'succeeded', completedRefundLinkId: 'k-1' });
    });

    it('failed 뒤 재시도가 Wallet 장애로 막히면 awaitingDecision manual_pending — 결정 버튼이 남는다 (I2)', async () => {
      const f = makeFixture({
        outcome: { kind: 'wallet_unavailable', errorMessage: 'down' },
        links: [{ id: 'k', metadata: { refundStatus: 'failed' } }],
      });
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'manual_pending' });
      expect(recorded(f)).toMatchObject({ refundStatus: 'manual_pending', awaitingDecision: true });
    });

    it('채널(medusa) 주문의 옛 failed 재시도가 막히면 지금처럼 표지 없는 manual_pending — 결정 버튼을 열지 않는다 (N19)', async () => {
      const f = makeFixture({
        so: makeSo({ salesChannel: 'medusa' }),
        outcome: { kind: 'wallet_unavailable', errorMessage: 'down' },
        links: [{ id: 'k', metadata: { refundStatus: 'failed' } }],
      });
      await expect(f.manager.retry(SO_ID)).resolves.toEqual({ refundStatus: 'manual_pending' });
      expect(recorded(f).awaitingDecision).toBeUndefined();
    });

    it('취소되지 않은 주문이면 400', async () => {
      const f = makeFixture({ so: makeSo({ status: 'confirmed' }) });
      await expect(f.manager.retry(SO_ID)).rejects.toThrow('취소된 주문에만 환불 재시도를 할 수 있습니다.');
    });
  });

  describe('completeManually', () => {
    it('열린 manual_pending 을 succeeded(manual) 로 닫는다', async () => {
      const f = makeFixture({ links: [{ id: 'k-1', metadata: { refundStatus: 'manual_pending' } }] });
      await expect(f.manager.completeManually(SO_ID, { adminNote: '입금 확인' })).resolves.toEqual({
        refundStatus: 'succeeded',
        completionType: 'manual',
      });
      expect(recorded(f)).toMatchObject({ completedRefundLinkId: 'k-1', providerRefundExecuted: false });
    });

    const WAIVED_ROWS = [
      { id: 'k-2', metadata: { refundStatus: 'waived', completedRefundLinkId: 'k-1' } },
      { id: 'k-1', metadata: { refundStatus: 'manual_pending', awaitingDecision: true } },
    ];

    it('환불 안 함으로 닫힌 건뿐이면(대상 없음) 400 — succeeded 를 덧쓰지 않는다', async () => {
      const f = makeFixture({ links: WAIVED_ROWS });
      await expect(f.manager.completeManually(SO_ID, {})).rejects.toThrow('환불하지 않기로 한 주문입니다.');
      expect(f.salesOrders.createBusinessLink).not.toHaveBeenCalled();
    });

    it.each(['k-1', 'k-2'])('명시 대상 %s 가 waived 이거나 waived 로 닫혔으면 400', async (refundLinkId) => {
      const f = makeFixture({ links: WAIVED_ROWS });
      await expect(f.manager.completeManually(SO_ID, { refundLinkId })).rejects.toThrow(
        '환불하지 않기로 한 주문입니다.',
      );
      expect(f.salesOrders.createBusinessLink).not.toHaveBeenCalled();
    });

    it('pending → 400', async () => {
      const f = makeFixture({ links: [{ id: 'k-1', metadata: { refundStatus: 'pending' } }] });
      await expect(f.manager.completeManually(SO_ID, { refundLinkId: 'k-1' })).rejects.toThrow('환불이 처리 중입니다');
    });
  });

  describe('requestWalletRefundAfterCancel — Wallet 결과별 기록', () => {
    it.each([
      [{ kind: 'success', refunds: SUCCESS.kind === 'success' ? SUCCESS.refunds : [] }, 'succeeded', 'succeeded'],
      [{ kind: 'partial_pending', refunds: SUCCESS.kind === 'success' ? SUCCESS.refunds : [] }, 'pending', 'pending'],
      [{ kind: 'failed', errorCode: 'E', errorMessage: 'm' }, 'failed', 'failed'],
      [{ kind: 'wallet_unavailable', errorMessage: 'm' }, 'manual_pending', 'manual_pending'],
      [{ kind: 'in_flight', errorMessage: 'm' }, 'manual_pending', 'manual_pending'],
      [{ kind: 'already_refunded', errorCode: 'E', errorMessage: 'm' }, 'succeeded', 'succeeded'],
    ] as Array<[WalletRefundOutcome, string, string]>)('%j → 반환 %s·기록 %s', async (outcome, ret, status) => {
      const f = makeFixture({ outcome });
      await expect(f.manager.requestWalletRefundAfterCancel(f.so as never, {}, { actor: 'admin' })).resolves.toBe(ret);
      expect(recorded(f)).toMatchObject({ refundStatus: status, actor: 'admin' });
    });

    it('walletIntentId 없으면 Wallet 미호출, manual_pending', async () => {
      const f = makeFixture({ so: makeSo({ walletIntentId: null }) });
      await expect(f.manager.requestWalletRefundAfterCancel(f.so as never, {})).resolves.toBe('manual_pending');
      expect(f.wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });
});
