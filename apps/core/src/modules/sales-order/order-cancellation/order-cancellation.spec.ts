import { getTableName } from 'drizzle-orm';
import { OrderCancellation } from './order-cancellation';
import type { CancellationRequest } from './order-cancellation.types';
import {
  PrintInProductionError,
  PrintOrderCancellationManager,
  PrintPartialCancelAvailableError,
} from '../../print-order/services/print-order-cancellation.manager';
import { PrintOrderReader } from '../../print-order/services/print-order.reader';

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
    jest.fn(() => {
      callOrder.push('gate');
      return Promise.resolve(PRINTED);
    });
  const printNote = jest.fn().mockResolvedValue(undefined);
  const k = new OrderCancellation(
    db as never,
    salesOrders as never,
    cancelRequests as never,
    printOrders as unknown as PrintOrderReader,
    { cancelForOrder: printCancel, noteSalesCancelFailed: printNote } as unknown as PrintOrderCancellationManager,
  );
  return { k, cancelRequests, printCancel, printNote, callOrder };
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
