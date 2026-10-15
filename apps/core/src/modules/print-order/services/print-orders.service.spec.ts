import { NotFoundError } from '@app/shared';
import { DbService } from '@app/db';
import { wmsSchema, type DbTx } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../../sales-order/services/sales-orders.service';
import { StoreSalesOrdersService } from '../../sales-order/services/store-sales-orders.service';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { CANCEL_CLAIM_STALE_MS } from './print-order-cancellation.manager';
import {
  PrintOrderAdminManager,
  type PrintCancelResolution,
  type PrintSalesCancelTarget,
} from './print-order-admin.manager';
import { PrintOrderReader, type PrintOrderListItem, type PrintOrderSummary } from './print-order.reader';
import { PrintOrderRepository } from './print-order.repository';
import { PrintOrdersService } from './print-orders.service';
import { PrintCancelRemainingReader } from './print-cancel-remaining.reader';

// 모든 메서드를 덮어써 DB 를 쓰지 않는 가짜라 DbService 자리는 형 변환으로 채운다
const noDb = {} as unknown as DbService<typeof wmsSchema>;
const ADMIN = { userId: 'admin-1', roles: ['admin'] };

class FakeReader extends PrintOrderReader {
  constructor() {
    super(noDb);
  }
  summary = jest.fn<Promise<PrintOrderSummary>, [Date]>(() =>
    Promise.resolve({ cancelRefused: 1, testPending: 0, failed: 0, unsupported: 0, total: 1 }),
  );
  byLine = jest.fn<Promise<PrintOrderListItem | null>, [string]>(() => Promise.resolve(null));
  byDesign = jest.fn<Promise<PrintOrderListItem[]>, [string]>(() => Promise.resolve([]));
}

class FakeManager extends PrintOrderAdminManager {
  constructor() {
    super(new PrintOrderRepository(noDb), new PrintOrderReader(noDb));
  }
  resolveCancel = jest.fn<Promise<PrintCancelResolution>, [string, 'cancelled' | 'proceed', string]>();
  noteSalesCancelFailed = jest.fn(() => Promise.resolve());
  salesCancelTarget = jest.fn<Promise<PrintSalesCancelTarget | null>, [PrintOrderRow]>(() =>
    Promise.resolve({ salesOrderId: 'so-1', salesOrderLineId: 'sol-1', lineQuantity: 3 }),
  );
  get = jest.fn<Promise<PrintOrderRow>, [string]>(() => Promise.resolve(resolvedRow));
  retry = jest.fn();
  confirmTest = jest.fn();
}

function setup() {
  const reader = new FakeReader();
  const manager = new FakeManager();
  const adminCancelRequest = jest.fn<
    ReturnType<StoreSalesOrdersService['adminCancelRequest']>,
    Parameters<StoreSalesOrdersService['adminCancelRequest']>
  >(() => Promise.resolve({ status: 'cancelled', refundStatus: 'requested' }));
  // 이 서비스가 부르는 메서드는 adminCancelRequest 하나뿐이라 나머지 의존성을 만들지 않고 형 변환으로 채운다
  const storeSalesOrders = { adminCancelRequest } as unknown as StoreSalesOrdersService;
  const cancelledByLine = new Map<string, number>();
  let lookupError: Error | null = null;
  const remainingFails = (error: Error) => {
    lookupError = error;
  };
  // 남은 수량 계산은 실제 reader 로 돌리고, DB 트랜잭션과 판매주문 취소 이력만 가짜로 채운다
  const runOnly = { run: <T>(fn: (tx: DbTx) => Promise<T>) => fn({} as DbTx) } as unknown as DbService<
    typeof wmsSchema
  >;
  const salesOrders = {
    getCancelledQuantityByLine: () => (lookupError ? Promise.reject(lookupError) : Promise.resolve(cancelledByLine)),
  } as unknown as SalesOrdersService;
  const remaining = new PrintCancelRemainingReader(runOnly, salesOrders);
  const service = new PrintOrdersService(reader, manager, storeSalesOrders, remaining);
  return { reader, manager, adminCancelRequest, service, cancelledByLine, remainingFails };
}

const resolvedRow: PrintOrderRow = {
  id: 'po-1',
  salesOrderId: 'so-1',
  salesOrderLineId: 'sol-1',
  almondDesignId: 'd-1',
  vendor: 'wowpress',
  status: 'cancelled',
  testMemo: false,
  vendorOrderNumber: 'WP-1',
  vendorBoxNumber: null,
  vendorShippingFee: null,
  attemptCount: 0,
  lastError: null,
  nextAttemptAt: new Date(),
  submittingAt: null,
  orderAttemptedAt: new Date(),
  carrier: null,
  trackingNumber: null,
  shippedAt: null,
  deliveredAt: null,
  testConfirmedAt: null,
  testConfirmedBy: null,
  testNote: null,
  cancelRefusedAt: new Date(),
  cancelResolvedAt: new Date(),
  cancelResolvedBy: 'admin-1',
  salesCancelFailedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PrintOrdersService', () => {
  it('counts stale cancelling rows as of now minus the cancel claim window', async () => {
    const { reader, service } = setup();
    const before = Date.now();
    await service.summary();
    const [staleBefore] = reader.summary.mock.calls[0];
    expect(staleBefore.getTime()).toBeGreaterThanOrEqual(before - CANCEL_CLAIM_STALE_MS);
    expect(staleBefore.getTime()).toBeLessThanOrEqual(Date.now() - CANCEL_CLAIM_STALE_MS);
  });

  it('adds the board flags to every item', async () => {
    const { reader, service } = setup();
    const item = {
      ...resolvedRow,
      status: 'failed' as const,
      vendorOrderNumber: null,
      orderAttemptedAt: new Date(),
      cancelResolvedAt: null,
      channelOrderId: 'order_1',
      displayOrderNo: '3900',
      customerName: '홍길동',
      customerPhone: '010-1234-5678',
      productName: '명함',
      salesCancelFailed: false,
    };
    reader.byDesign.mockResolvedValue([item]);
    await expect(service.byDesign('d-1')).resolves.toEqual([
      { ...item, retryBlocked: false, needsWowpressCheck: true, resolvable: false, salesCancelFailed: false },
    ]);
  });

  it('takes the not-refunded flag from the reader, not from the failure stamp', async () => {
    const { reader, service } = setup();
    const base = {
      ...resolvedRow,
      status: 'cancelled' as const,
      channelOrderId: 'order_1',
      displayOrderNo: null,
      customerName: null,
      customerPhone: null,
      productName: '명함',
    };
    reader.byDesign.mockResolvedValue([
      { ...base, id: 'po-a', salesCancelFailedAt: null, salesCancelFailed: true },
      { ...base, id: 'po-b', salesCancelFailedAt: new Date(), salesCancelFailed: false },
    ]);
    const [left, settled] = await service.byDesign('d-1');
    expect(left).toMatchObject({ salesCancelFailed: true, resolvable: true });
    expect(settled).toMatchObject({ salesCancelFailed: false, resolvable: false });
  });

  it('404s a line without a print order', async () => {
    const { service } = setup();
    await expect(service.byLine('line-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resolve cancelled: cancels exactly the print line in full as the operator, with a stable idempotency key', async () => {
    const { manager, adminCancelRequest, service } = setup();
    manager.resolveCancel.mockResolvedValue({ row: resolvedRow, cancelSales: true });
    const out = await service.resolveCancel('po-1', 'cancelled', ADMIN);
    expect(manager.resolveCancel).toHaveBeenCalledWith('po-1', 'cancelled', 'admin-1');
    expect(adminCancelRequest).toHaveBeenCalledWith('so-1', {
      reasonCode: 'ADMIN_CANCEL',
      lines: [{ salesOrderLineId: 'sol-1', quantity: 3 }],
      fulfillmentCommandContext: {
        idempotencyKey: 'print-order-resolve-cancel:po-1',
        actorId: 'admin-1',
        actorRoles: ['admin'],
      },
    });
    expect(manager.get).toHaveBeenCalledWith('po-1');
    expect(out).toEqual({
      printOrder: resolvedRow,
      salesCancel: { status: 'cancelled', refundStatus: 'requested' },
    });
  });

  it('resolve cancelled: requests only the quantity not cancelled yet', async () => {
    const { manager, adminCancelRequest, service, cancelledByLine } = setup();
    manager.resolveCancel.mockResolvedValue({ row: resolvedRow, cancelSales: true });
    cancelledByLine.set('sol-1', 2);
    cancelledByLine.set('sol-other', 5);
    await service.resolveCancel('po-1', 'cancelled', ADMIN);
    expect(adminCancelRequest.mock.calls[0]?.[1].lines).toEqual([{ salesOrderLineId: 'sol-1', quantity: 1 }]);
  });

  it('resolve cancelled: skips the sales cancel when nothing remains on the line', async () => {
    const { manager, adminCancelRequest, service, cancelledByLine } = setup();
    manager.resolveCancel.mockResolvedValue({ row: resolvedRow, cancelSales: true });
    cancelledByLine.set('sol-1', 3);
    await expect(service.resolveCancel('po-1', 'cancelled', ADMIN)).resolves.toEqual({
      printOrder: resolvedRow,
      salesCancel: null,
    });
    expect(adminCancelRequest).not.toHaveBeenCalled();
    expect(manager.get).toHaveBeenCalledWith('po-1');
  });

  it('stamps the row as not refunded when the remaining-quantity lookup fails after the print was cancelled', async () => {
    const { manager, adminCancelRequest, service, remainingFails } = setup();
    manager.resolveCancel.mockResolvedValue({ row: resolvedRow, cancelSales: true });
    const boom = new Error('db down');
    remainingFails(boom);
    await expect(service.resolveCancel('po-1', 'cancelled', ADMIN)).rejects.toBe(boom);
    expect(manager.noteSalesCancelFailed).toHaveBeenCalledWith('po-1', boom);
    expect(adminCancelRequest).not.toHaveBeenCalled();
  });

  it('stamps the row when the sales line lookup fails', async () => {
    const { manager, service } = setup();
    manager.resolveCancel.mockResolvedValue({ row: resolvedRow, cancelSales: true });
    const boom = new Error('line lookup failed');
    manager.salesCancelTarget.mockRejectedValue(boom);
    await expect(service.resolveCancel('po-1', 'cancelled', ADMIN)).rejects.toBe(boom);
    expect(manager.noteSalesCancelFailed).toHaveBeenCalledWith('po-1', boom);
  });

  it('resolve proceed: never touches the sales order', async () => {
    const { manager, adminCancelRequest, service } = setup();
    manager.resolveCancel.mockResolvedValue({ row: { ...resolvedRow, status: 'submitted' }, cancelSales: false });
    const out = await service.resolveCancel('po-1', 'proceed', ADMIN);
    expect(adminCancelRequest).not.toHaveBeenCalled();
    expect(out.salesCancel).toBeNull();
  });

  it('records the failure on the print row and rethrows when the sales cancel fails', async () => {
    const { manager, adminCancelRequest, service } = setup();
    manager.resolveCancel.mockResolvedValue({ row: resolvedRow, cancelSales: true });
    manager.salesCancelTarget.mockResolvedValue({ salesOrderId: 'so-1', salesOrderLineId: 'sol-1', lineQuantity: 1 });
    const boom = new Error('medusa down');
    adminCancelRequest.mockRejectedValue(boom);
    await expect(service.resolveCancel('po-1', 'cancelled', ADMIN)).rejects.toBe(boom);
    expect(manager.noteSalesCancelFailed).toHaveBeenCalledWith('po-1', boom);
    expect(manager.get).not.toHaveBeenCalled();
  });
});
