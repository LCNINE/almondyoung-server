import { getTableName } from 'drizzle-orm';
import { OrderCancellation } from './order-cancellation';
import type { CancellationRequest } from './order-cancellation.types';
import {
  PrintInProductionError,
  PrintOrderCancellationManager,
  PrintPartialCancelAvailableError,
} from '../../print-order/services/print-order-cancellation.manager';
import { PrintOrderReader } from '../../print-order/services/print-order.reader';
import { BadRequestError } from '@app/shared';
import type { ChannelCancelSettler } from '../channel-cancel-request/channel-cancel-settler';
import type { OrderCancellationReader } from './order-cancellation.reader';

const PRINTED = { vendorCancelled: ['po-1'], locallyCancelled: [] };
const VIEW = { id: 'req-1', status: 'settling', scope: 'full', convertedFromFull: false };

function makeKernel(
  options: {
    salesChannel?: string;
    noSalesOrder?: boolean;
    replayView?: Record<string, unknown> | null;
    printRows?: Array<Record<string, unknown>>;
    planLines?: Array<{ salesOrderLineId: string; quantity: number }>;
    printCancel?: jest.Mock;
    activePrint?: boolean;
    followUp?: string | null;
    cancelError?: Error;
  } = {},
) {
  const callOrder: string[] = [];
  const so = { id: 'so', salesChannel: options.salesChannel ?? 'medusa', status: 'confirmed' };
  // store-sales-orders.service.spec.ts 의 makeContext 와 같은 모양 — sales_orders 는 limit().then(), 줄은 then()
  const db = {
    db: {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation((table: unknown) => ({
          where: jest.fn().mockImplementation(() => {
            const tableName = getTableName(table as Parameters<typeof getTableName>[0]);
            return {
              limit: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) =>
                  fn(tableName === 'sales_orders' && !options.noSalesOrder ? [so] : []),
                ),
              }),
              then: jest.fn((fn: (r: unknown[]) => unknown) => fn([])),
            };
          }),
        })),
      })),
      transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    },
  };
  const salesOrders = {
    planCancellation: jest.fn().mockResolvedValue({ lines: options.planLines ?? [] }),
    cancel: jest.fn(() => {
      callOrder.push('cancel');
      return options.cancelError ? Promise.reject(options.cancelError) : Promise.resolve(undefined);
    }),
  };
  const cancelRequests = {
    findBySourceKey: jest.fn().mockResolvedValue(options.replayView ?? null),
    precheck: jest.fn(() => {
      callOrder.push('precheck');
      return Promise.resolve(undefined);
    }),
    request: jest.fn(() => {
      callOrder.push('request');
      return Promise.resolve(VIEW);
    }),
  };
  const printOrders = { forSalesOrder: jest.fn().mockResolvedValue(options.printRows ?? []) };
  const printCancel =
    options.printCancel ??
    jest.fn((_id: string, mode: string) => {
      callOrder.push(mode);
      return Promise.resolve(PRINTED);
    });
  const printNote = jest.fn().mockResolvedValue(undefined);
  const holdUnsent = jest.fn(() => {
    callOrder.push('holdUnsent');
    return Promise.resolve(undefined);
  });
  const holdForDecrease = jest.fn().mockResolvedValue(undefined);
  const settler = {
    settleCancelled: jest.fn(() => {
      callOrder.push('settleCancelled');
      return Promise.resolve(undefined);
    }),
  };
  const reader = {
    hasActivePrintOrder: jest.fn().mockResolvedValue(options.activePrint ?? false),
    cancellationNeedsFollowUp: jest.fn().mockResolvedValue(options.followUp ?? null),
  };
  const k = new OrderCancellation(
    db as never,
    salesOrders as never,
    cancelRequests as never,
    printOrders as unknown as PrintOrderReader,
    {
      cancelForOrder: printCancel,
      noteSalesCancelFailed: printNote,
      holdUnsent,
      holdForDecrease,
    } as unknown as PrintOrderCancellationManager,
    settler as unknown as ChannelCancelSettler,
    reader as unknown as OrderCancellationReader,
  );
  return {
    k,
    salesOrders,
    cancelRequests,
    printCancel,
    printNote,
    holdUnsent,
    holdForDecrease,
    settler,
    reader,
    callOrder,
  };
}

/** 문이 넘기는 바깥 트랜잭션. savepoint 는 콜백이 던지면 그 예외를 그대로 내보낸다(=되돌림) */
function makeTx() {
  const savepoint = { savepoint: true };
  const tx = { transaction: jest.fn((fn: (sp: unknown) => Promise<unknown>) => fn(savepoint)) };
  return { tx, savepoint };
}

const lines = [{ salesOrderLineId: 'line-1', quantity: 1 }];
const op: CancellationRequest = { requester: { kind: 'operator', actorId: 'a' }, salesOrderId: 'so', sourceKey: 'k' };

describe('OrderCancellation.request', () => {
  it('판매주문이 없으면 404', async () => {
    const { k } = makeKernel({ noSalesOrder: true });
    await expect(k.request(op)).rejects.toThrow('주문을 찾을 수 없습니다.');
  });

  it('판매자센터 주문은 키가 없어도 판매자센터 문구가 먼저다', async () => {
    const { k } = makeKernel({ salesChannel: 'naver' });
    await expect(
      k.request({ requester: { kind: 'operator', actorId: 'a' }, salesOrderId: 'so', sourceKey: undefined }),
    ).rejects.toThrow('네이버 판매자센터에서 취소해 주세요.');
  });

  it('core 가 직접 취소하는 채널은 명령을 받지 않는다', async () => {
    const { k, printCancel } = makeKernel({ salesChannel: '3pl' });
    await expect(k.request(op)).rejects.toThrow('Sales channel 3pl does not take cancel commands');
    expect(printCancel).not.toHaveBeenCalled();
  });

  it('키가 없으면 400', async () => {
    const { k } = makeKernel({ salesChannel: 'medusa' });
    await expect(
      k.request({ requester: { kind: 'operator', actorId: 'a' }, salesOrderId: 'so', sourceKey: undefined }),
    ).rejects.toThrow('Idempotency-Key header is required');
  });

  it('같은 키의 요청이 있으면 그 view 를 돌려주고 와우프레스를 부르지 않는다', async () => {
    const view = { id: 'req-0', status: 'applied', scope: 'full', convertedFromFull: false };
    const { k, cancelRequests, printCancel } = makeKernel({ replayView: view });
    expect(
      await k.request({ requester: { kind: 'customer', customerId: 'c' }, salesOrderId: 'so', sourceKey: 'k' }),
    ).toBe(view);
    expect(printCancel).not.toHaveBeenCalled();
    expect(cancelRequests.request).not.toHaveBeenCalled();
  });

  it('운영자 요청은 precheck → gate → request 순서로, 상계 금액을 precheck 와 request 에 넘긴다', async () => {
    const { k, cancelRequests, printCancel, callOrder } = makeKernel();
    await k.request({
      requester: { kind: 'operator', actorId: 'a' },
      salesOrderId: 'so',
      sourceKey: 'k',
      lines,
      alreadyRefundedAmount: 1000,
    });
    expect(callOrder).toEqual(['precheck', 'gate', 'request']);
    expect(cancelRequests.precheck).toHaveBeenCalledWith('so', lines, 1000);
    expect(printCancel).toHaveBeenCalledWith('so', 'gate', lines);
    expect(cancelRequests.request).toHaveBeenCalledWith(
      expect.objectContaining({ requester: { kind: 'operator', actorId: 'a' }, alreadyRefundedAmount: 1000 }),
    );
  });

  it('확정이 실패하면 인쇄 행에 남기고 다시 던진다', async () => {
    const { k, cancelRequests, printNote } = makeKernel();
    const boom = new Error('boom');
    cancelRequests.request.mockRejectedValue(boom);
    await expect(k.request(op)).rejects.toBe(boom);
    expect(printNote).toHaveBeenCalledWith(PRINTED, boom);
  });

  it('고객 요청은 거절을 남겨 두는 gate 를 부르고 상계 금액을 넘기지 않는다', async () => {
    const { k, cancelRequests, printCancel } = makeKernel();
    await k.request({ requester: { kind: 'customer', customerId: 'c' }, salesOrderId: 'so', sourceKey: 'k' });
    expect(cancelRequests.precheck).toHaveBeenCalledWith('so', undefined);
    expect(printCancel).toHaveBeenCalledWith('so', 'gate', undefined, { keepOnRefusal: true });
    expect(cancelRequests.request).toHaveBeenCalledWith({
      salesOrderId: 'so',
      requester: { kind: 'customer', customerId: 'c' },
      sourceKey: 'k',
      reasonCode: undefined,
      reasonDetail: undefined,
    });
  });

  it('고객 excludePrint 는 살아 있는 인쇄 줄을 뺀 계획을 줄로 쓴다', async () => {
    const { k, cancelRequests } = makeKernel({
      printRows: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
      planLines: [
        { salesOrderLineId: 'print-line', quantity: 1 },
        { salesOrderLineId: 'normal-line', quantity: 2 },
      ],
    });
    await k.request({
      requester: { kind: 'customer', customerId: 'c' },
      salesOrderId: 'so',
      sourceKey: 'k',
      excludePrint: true,
    });
    expect(cancelRequests.request).toHaveBeenCalledWith(
      expect.objectContaining({ lines: [{ salesOrderLineId: 'normal-line', quantity: 2 }] }),
    );
  });

  it('고객 excludePrint 인데 남은 게 인쇄뿐이면 제작 중 안내로 막는다', async () => {
    const { k, cancelRequests } = makeKernel({
      printRows: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
      planLines: [{ salesOrderLineId: 'print-line', quantity: 1 }],
    });
    await expect(
      k.request({
        requester: { kind: 'customer', customerId: 'c' },
        salesOrderId: 'so',
        sourceKey: 'k',
        excludePrint: true,
      }),
    ).rejects.toBeInstanceOf(PrintInProductionError);
    expect(cancelRequests.precheck).not.toHaveBeenCalled();
  });

  it('고객 gate 가 제작 중으로 거절하고 다른 상품이 남으면 인쇄 제외 취소를 묻는다', async () => {
    const { k, cancelRequests } = makeKernel({
      printCancel: jest.fn().mockRejectedValue(new PrintInProductionError()),
      printRows: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
      planLines: [
        { salesOrderLineId: 'print-line', quantity: 1 },
        { salesOrderLineId: 'normal-line', quantity: 2 },
      ],
    });
    await expect(
      k.request({ requester: { kind: 'customer', customerId: 'c' }, salesOrderId: 'so', sourceKey: 'k' }),
    ).rejects.toBeInstanceOf(PrintPartialCancelAvailableError);
    expect(cancelRequests.request).not.toHaveBeenCalled();
  });

  it('운영자 gate 거절은 그대로 던진다 — 인쇄 제외 취소를 묻지 않는다', async () => {
    const { k } = makeKernel({
      printCancel: jest.fn().mockRejectedValue(new PrintInProductionError()),
      planLines: [{ salesOrderLineId: 'normal-line', quantity: 2 }],
    });
    await expect(k.request(op)).rejects.toBeInstanceOf(PrintInProductionError);
  });
});

describe('OrderCancellation.notice / afterCommit', () => {
  const t = new Date('2026-10-07T00:00:01.000Z');
  const view = VIEW;

  it('채널 취소 통보는 tx 없이 부르면 던진다', async () => {
    const { k } = makeKernel();
    await expect(
      k.notice({ source: 'channel_cancelled', salesOrderId: 'so', lines: undefined, metadata: {} }),
    ).rejects.toThrow();
  });

  it('채널 전체취소 통보 — 같은 tx 로 cancel → holdUnsent → settle, 커밋 뒤 할 일을 돌려준다', async () => {
    const { k, salesOrders, holdUnsent, settler, printCancel, callOrder } = makeKernel();
    const { tx } = makeTx();
    const o = await k.notice(
      { source: 'channel_cancelled', salesOrderId: 'so', lines: undefined, metadata: { sourceEventId: 'e' } },
      tx as never,
    );
    expect(callOrder).toEqual(['cancel', 'holdUnsent', 'settleCancelled']);
    expect(o).toEqual({ applied: true, followUp: { salesOrderId: 'so', lines: undefined } });
    expect(printCancel).not.toHaveBeenCalled();
    expect(salesOrders.cancel).toHaveBeenCalledWith('so', { metadata: { sourceEventId: 'e' } }, tx);
    expect(holdUnsent).toHaveBeenCalledWith('so', undefined, tx);
    expect(settler.settleCancelled).toHaveBeenCalledWith('so', tx);
  });

  it('채널 부분취소 통보는 정산을 닫지 않는다', async () => {
    const { k, salesOrders, settler, callOrder } = makeKernel();
    const { tx } = makeTx();
    const o = await k.notice(
      { source: 'channel_cancelled', salesOrderId: 'so', lines, reasonCode: 'CUSTOMER_REQUEST', metadata: {} },
      tx as never,
    );
    expect(callOrder).toEqual(['cancel', 'holdUnsent']);
    expect(settler.settleCancelled).not.toHaveBeenCalled();
    expect(salesOrders.cancel).toHaveBeenCalledWith(
      'so',
      expect.objectContaining({ lines, reasonCode: 'CUSTOMER_REQUEST' }),
      tx,
    );
    expect(o).toEqual({ applied: true, followUp: { salesOrderId: 'so', lines } });
  });

  it('afterCommit 은 record 로 재수신 시각을 넘긴다', async () => {
    const { k, printCancel } = makeKernel();
    await k.afterCommit({ salesOrderId: 'so', lines, redeliveredSince: t });
    expect(printCancel).toHaveBeenCalledWith('so', 'record', lines, { redeliveredSince: t });
  });

  it('무통장 승인 통보는 record 먼저, 확정 나중 (N4)', async () => {
    const { k, cancelRequests, callOrder } = makeKernel();
    const o = await k.notice({
      source: 'wallet_refund_approval',
      salesOrderId: 'so',
      intentId: 'i',
      reasonCode: 'CUSTOMER_REFUND_REQUEST',
    });
    expect(callOrder).toEqual(['record', 'request']);
    expect(cancelRequests.request).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'wallet-refund-approval:i',
        requester: { kind: 'wallet-refund-approval', intentId: 'i' },
      }),
    );
    expect(o).toEqual({ applied: true, requestView: view });
  });

  it('무통장 승인 통보는 tx 를 받지 않는다 — 커널이 트랜잭션을 가진다', async () => {
    const { k, printCancel } = makeKernel();
    const { tx } = makeTx();
    await expect(
      k.notice({ source: 'wallet_refund_approval', salesOrderId: 'so', intentId: 'i', reasonCode: 'R' }, tx as never),
    ).rejects.toThrow();
    expect(printCancel).not.toHaveBeenCalled();
  });

  describe('채널 수량 감소', () => {
    const line = { salesOrderLineId: 'line-1', quantity: 1 };
    const decrease = {
      salesOrderId: 'so',
      line,
      reasonCode: 'CHANNEL_ORDER_MODIFIED',
      occurredAt: '2026-10-07T00:00:00.000Z',
      sourceEventId: 'amend-1:line-1',
      attempt: true,
    };

    it('savepoint 안에서 그 줄만 채널 취소로 줄인다', async () => {
      const { k, salesOrders, reader } = makeKernel();
      const { tx, savepoint } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({ applied: true });
      expect(tx.transaction).toHaveBeenCalledTimes(1);
      expect(reader.hasActivePrintOrder).toHaveBeenCalledWith('line-1', savepoint);
      expect(salesOrders.cancel).toHaveBeenCalledWith(
        'so',
        {
          lines: [line],
          cancelledBy: 'channel',
          reasonCode: 'CHANNEL_ORDER_MODIFIED',
          occurredAt: '2026-10-07T00:00:00.000Z',
          metadata: { sourceEventId: 'amend-1:line-1' },
        },
        savepoint,
      );
      expect(reader.cancellationNeedsFollowUp).toHaveBeenCalledWith('so', 'amend-1:line-1', savepoint);
    });

    it('시도 전에 savepoint 밖에서 그 줄의 인쇄를 붙잡는다', async () => {
      const { k, holdForDecrease } = makeKernel();
      const { tx } = makeTx();
      await k.noticeChannelDecrease(decrease, tx as never);
      // 거절이 savepoint 를 되돌려도 붙잡기는 남아야 한다 — 바깥 tx 로, savepoint 를 열기 전에
      expect(holdForDecrease).toHaveBeenCalledWith('line-1', tx);
      expect(holdForDecrease.mock.invocationCallOrder[0]).toBeLessThan(tx.transaction.mock.invocationCallOrder[0]);
    });

    it('attempt: false 면 붙잡기만 하고 시도하지 않는다', async () => {
      const { k, holdForDecrease, salesOrders } = makeKernel();
      const { tx } = makeTx();
      const o = await k.noticeChannelDecrease({ ...decrease, attempt: false }, tx as never);
      expect(o).toEqual({ applied: false, refusal: 'deferred by the channel change rule' });
      expect(holdForDecrease).toHaveBeenCalledTimes(1);
      expect(holdForDecrease).toHaveBeenCalledWith('line-1', tx);
      expect(tx.transaction).not.toHaveBeenCalled();
      expect(salesOrders.cancel).not.toHaveBeenCalled();
    });

    it('인쇄 줄이면 취소하지 않고 거절한다', async () => {
      const { k, salesOrders } = makeKernel({ activePrint: true });
      const { tx } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({
        applied: false,
        refusal: 'print order on this line — decide on WowPress',
      });
      expect(salesOrders.cancel).not.toHaveBeenCalled();
    });

    it('인쇄 줄 거절이어도 붙잡기는 이미 끝났다', async () => {
      const { k, holdForDecrease } = makeKernel({ activePrint: true });
      const { tx } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({
        applied: false,
        refusal: 'print order on this line — decide on WowPress',
      });
      expect(holdForDecrease).toHaveBeenCalledTimes(1);
    });

    it('도메인 거절은 그 문구로 거절한다', async () => {
      const { k } = makeKernel({ cancelError: new BadRequestError('nope') });
      const { tx } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({ applied: false, refusal: 'nope' });
    });

    it('그 자리에서 끝나지 않은 취소는 savepoint 를 되돌리고 거절한다', async () => {
      const { k } = makeKernel({ followUp: 'shipment cancellation would wait' });
      const { tx } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({
        applied: false,
        refusal: 'shipment cancellation would wait',
      });
      // savepoint 콜백이 던졌다 = 되돌렸다
      await expect(tx.transaction.mock.results[0].value).rejects.toBeDefined();
    });

    it('도메인 거절이 아닌 예외는 그대로 던진다', async () => {
      const boom = new Error('deadlock');
      const { k } = makeKernel({ cancelError: boom });
      const { tx } = makeTx();
      await expect(k.noticeChannelDecrease(decrease, tx as never)).rejects.toBe(boom);
    });
  });
});
