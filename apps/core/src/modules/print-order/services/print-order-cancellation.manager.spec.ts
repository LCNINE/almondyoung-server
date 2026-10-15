import { ConfigService } from '@nestjs/config';
import { BadRequestError, ConflictError, UpstreamUnavailableError } from '@app/shared';
import { DbService } from '@app/db';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WowpressApiError, WowpressClient, WowpressUnauthorizedError } from '../wowpress/wowpress.client';
import { type WowpressOrderDetail, type WowpressTransport } from '../wowpress/wowpress.types';
import {
  CANCEL_CLAIM_STALE_MS,
  PRINT_CANCEL_RETRY_MESSAGE,
  PRINT_IN_PRODUCTION_MESSAGE,
  PrintInProductionError,
  PrintOrderCancellationManager,
  SHIPPED_BEFORE_CANCEL_ERROR,
} from './print-order-cancellation.manager';
import { PrintOrderReader } from './print-order.reader';
import { ORDER_LOOKUP_PENDING_ERROR } from './print-order-submit.manager';
import { isPreservedLastError, PrintOrderRepository } from './print-order.repository';

const noNetwork: WowpressTransport = () => Promise.reject(new Error('real wowpress call in test'));
// 모든 메서드를 덮어써 DB 를 쓰지 않는 가짜라 DbService 자리는 형 변환으로 채운다
const noDb = {} as unknown as DbService<typeof wmsSchema>;

class FakeWowpress extends WowpressClient {
  cancel = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
  detail = jest.fn<Promise<WowpressOrderDetail>, [string]>(() =>
    Promise.resolve({ ordstat: 1, jobstat: null, carrierCode: null, trackingNumber: null, boxNumber: null }),
  );
  constructor() {
    super(new ConfigService({}), noNetwork);
  }
}

class Store {
  rows = new Map<string, PrintOrderRow>();
  quantities = new Map<string, number>();
  now = Date.now();
  tick(): Date {
    this.now += 1;
    return new Date(this.now);
  }
  put(r: PrintOrderRow) {
    this.rows.set(r.id, r);
  }
  get(id: string): PrintOrderRow {
    const r = this.rows.get(id);
    if (!r) throw new Error(`no row ${id}`);
    return r;
  }
}

class FakeReader extends PrintOrderReader {
  constructor(private readonly store: Store) {
    super(noDb);
  }
  forSalesOrder = jest.fn((salesOrderId: string) =>
    Promise.resolve(
      [...this.store.rows.values()].filter((r) => r.salesOrderId === salesOrderId).map((r) => ({ ...r })),
    ),
  );
}

class FakeRepo extends PrintOrderRepository {
  // CAS 직전에 끼어드는 다른 프로세스(제출 워커 등)를 흉내낸다
  beforeWrite: ((id: string) => void) | null = null;
  constructor(private readonly store: Store) {
    super(noDb);
  }
  compareAndSet = jest.fn((snapshot: PrintOrderRow, patch: Partial<PrintOrderRow>) => {
    const hook = this.beforeWrite;
    this.beforeWrite = null;
    hook?.(snapshot.id);
    const cur = this.store.get(snapshot.id);
    const same =
      cur.status === snapshot.status &&
      cur.vendorOrderNumber === snapshot.vendorOrderNumber &&
      (cur.orderAttemptedAt === null) === (snapshot.orderAttemptedAt === null);
    if (same) this.store.put({ ...cur, ...patch, updatedAt: this.store.tick() });
    return Promise.resolve(same);
  });
  compareAndSetUnprotected = jest.fn((snapshot: PrintOrderRow, patch: Partial<PrintOrderRow>) => {
    const hook = this.beforeWrite;
    this.beforeWrite = null;
    hook?.(snapshot.id);
    const cur = this.store.get(snapshot.id);
    const same =
      cur.status === snapshot.status &&
      cur.vendorOrderNumber === snapshot.vendorOrderNumber &&
      (cur.orderAttemptedAt === null) === (snapshot.orderAttemptedAt === null) &&
      !isPreservedLastError(cur.lastError);
    if (same) this.store.put({ ...cur, ...patch, updatedAt: this.store.tick() });
    return Promise.resolve(same);
  });
  reclaimCancelling = jest.fn((snapshot: PrintOrderRow) => {
    const cur = this.store.get(snapshot.id);
    const same = cur.status === 'cancelling' && cur.updatedAt.getTime() === snapshot.updatedAt.getTime();
    if (same) this.store.put({ ...cur, updatedAt: this.store.tick() });
    return Promise.resolve(same);
  });
  markVendorCancelled = jest.fn((id: string, ordnum: string) => {
    const cur = this.store.get(id);
    if (cur.vendorOrderNumber !== ordnum || isPreservedLastError(cur.lastError)) return Promise.resolve(false);
    this.store.put({
      ...cur,
      status: 'cancelled',
      cancelResolvedAt: null,
      cancelResolvedBy: null,
      updatedAt: this.store.tick(),
    });
    return Promise.resolve(true);
  });
  update = jest.fn((id: string, patch: Partial<PrintOrderRow>) => {
    this.store.put({ ...this.store.get(id), ...patch, updatedAt: this.store.tick() });
    return Promise.resolve();
  });
  findById = jest.fn((id: string) => Promise.resolve(this.store.rows.has(id) ? { ...this.store.get(id) } : null));
  lineQuantities = jest.fn((salesOrderId: string, lineIds: string[]) => {
    const printLines = new Map(
      [...this.store.rows.values()].filter((r) => r.salesOrderId === salesOrderId).map((r) => [r.salesOrderLineId, 1]),
    );
    const known = new Map([...printLines, ...this.store.quantities]);
    return Promise.resolve(
      new Map(lineIds.flatMap((id): [string, number][] => (known.has(id) ? [[id, known.get(id) ?? 0]] : []))),
    );
  });
}

let seq = 0;
function row(overrides: Partial<PrintOrderRow> = {}): PrintOrderRow {
  seq += 1;
  return {
    id: `po-${seq}`,
    salesOrderId: 'so-1',
    salesOrderLineId: `sol-${seq}`,
    almondDesignId: 'd-1',
    vendor: 'wowpress',
    status: 'pending',
    testMemo: false,
    vendorOrderNumber: null,
    vendorBoxNumber: null,
    vendorShippingFee: null,
    attemptCount: 0,
    lastError: null,
    nextAttemptAt: new Date(),
    submittingAt: null,
    orderAttemptedAt: null,
    carrier: null,
    trackingNumber: null,
    shippedAt: null,
    deliveredAt: null,
    testConfirmedAt: null,
    testConfirmedBy: null,
    testNote: null,
    cancelRefusedAt: null,
    cancelResolvedAt: null,
    cancelResolvedBy: null,
    salesCancelFailedAt: null,
    fileDeliveredAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 14, 0, seq)),
    updatedAt: new Date(),
    ...overrides,
  };
}

const SUBMITTED = { status: 'submitted' as const, vendorOrderNumber: 'WP-1', orderAttemptedAt: new Date() };
const CANCELLABLE: WowpressOrderDetail = {
  ordstat: 1,
  jobstat: null,
  carrierCode: null,
  trackingNumber: null,
  boxNumber: null,
};
const VENDOR_CANCELLED: WowpressOrderDetail = {
  ordstat: 90,
  jobstat: null,
  carrierCode: null,
  trackingNumber: null,
  boxNumber: null,
};
const NOTHING_CANCELLED = { vendorCancelled: [], locallyCancelled: [] };
const IN_PRODUCTION: WowpressOrderDetail = {
  ordstat: 20,
  jobstat: 120,
  carrierCode: null,
  trackingNumber: null,
  boxNumber: null,
};

function setup(...rows: PrintOrderRow[]) {
  const store = new Store();
  rows.forEach((r) => store.put(r));
  const repo = new FakeRepo(store);
  const reader = new FakeReader(store);
  const wowpress = new FakeWowpress();
  const manager = new PrintOrderCancellationManager(reader, repo, wowpress);
  return { store, repo, reader, wowpress, manager };
}

describe('PrintOrderCancellationManager', () => {
  describe('status table (gate)', () => {
    it('passes an order with no print rows', async () => {
      const { manager, wowpress } = setup();
      await expect(manager.cancelForOrder('so-1', 'gate')).resolves.toEqual(NOTHING_CANCELLED);
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it.each([
      ['pending', { status: 'pending' as const }],
      ['unsupported', { status: 'unsupported' as const }],
      ['failed before ordering', { status: 'failed' as const }],
    ])('marks %s cancelled without calling wowpress', async (_label, over) => {
      const r = row(over);
      const { manager, store, wowpress } = setup(r);
      await manager.cancelForOrder('so-1', 'gate');
      expect(store.get(r.id).status).toBe('cancelled');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('refuses with a retry message while the row is submitting', async () => {
      const r = row({ status: 'submitting', submittingAt: new Date() });
      const { manager, store, wowpress } = setup(r);
      const error = await manager.cancelForOrder('so-1', 'gate').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).not.toBeInstanceOf(PrintInProductionError);
      expect((error as Error).message).toBe(PRINT_CANCEL_RETRY_MESSAGE);
      expect(store.get(r.id).status).toBe('submitting');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('passes through when wowpress cancel succeeds and marks cancelled', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      await manager.cancelForOrder('so-1', 'gate');
      expect(wowpress.cancel).toHaveBeenCalledWith('WP-1');
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('cancels a failed row that has an ordnum at wowpress', async () => {
      const r = row({ ...SUBMITTED, status: 'failed' });
      const { manager, store, wowpress } = setup(r);
      await manager.cancelForOrder('so-1', 'gate');
      expect(wowpress.cancel).toHaveBeenCalledWith('WP-1');
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('cancels a pending row waiting for file re-upload (ordnum kept) at wowpress', async () => {
      const r = row({ ...SUBMITTED, status: 'pending' });
      const { manager, store, wowpress } = setup(r);
      await manager.cancelForOrder('so-1', 'gate');
      expect(wowpress.cancel).toHaveBeenCalledWith('WP-1');
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('records cancel_refused and stops with the customer message when wowpress refuses', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new WowpressApiError('취소할 수 없는 상태입니다'));
      wowpress.detail.mockResolvedValue(IN_PRODUCTION);

      const error = await manager.cancelForOrder('so-1', 'gate').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PrintInProductionError);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toBe(PRINT_IN_PRODUCTION_MESSAGE);
      expect((error as PrintInProductionError).getErrorCode()).toBe('PRINT_IN_PRODUCTION');
      expect(store.get(r.id).status).toBe('cancel_refused');
      expect(store.get(r.id).cancelRefusedAt).toBeInstanceOf(Date);
    });

    it('keepOnRefusal (customer cancel) puts a refused row back to submitted instead of cancel_refused', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new WowpressApiError('취소할 수 없는 상태입니다'));
      wowpress.detail.mockResolvedValue(IN_PRODUCTION);

      await expect(manager.cancelForOrder('so-1', 'gate', undefined, { keepOnRefusal: true })).rejects.toBeInstanceOf(
        PrintInProductionError,
      );
      expect(store.get(r.id).status).toBe('submitted');
      expect(store.get(r.id).cancelRefusedAt).toBeNull();
    });

    it('keepOnRefusal hands the row to the operator when duplicate evidence lands while waiting on wowpress', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress, repo } = setup(r);
      wowpress.cancel.mockRejectedValue(new WowpressApiError('취소할 수 없는 상태입니다'));
      wowpress.detail.mockImplementation(() => {
        repo.beforeWrite = (id: string) =>
          store.put({ ...store.get(id), lastError: 'duplicate wowpress order suspected: WP-1 / WP-2' });
        return Promise.resolve(IN_PRODUCTION);
      });

      await expect(manager.cancelForOrder('so-1', 'gate', undefined, { keepOnRefusal: true })).rejects.toBeInstanceOf(
        PrintInProductionError,
      );
      expect(store.get(r.id).status).toBe('cancel_refused');
    });

    it('keepOnRefusal leaves rows untouched when the multi-order precheck finds one in production', async () => {
      const a = row({ ...SUBMITTED, id: 'po-a', salesOrderLineId: 'line-a', vendorOrderNumber: 'WP-A' });
      const b = row({ ...SUBMITTED, id: 'po-b', salesOrderLineId: 'line-b', vendorOrderNumber: 'WP-B' });
      const { manager, store, wowpress } = setup(a, b);
      wowpress.detail.mockResolvedValue(IN_PRODUCTION);

      await expect(manager.cancelForOrder('so-1', 'gate', undefined, { keepOnRefusal: true })).rejects.toBeInstanceOf(
        PrintInProductionError,
      );
      expect(store.get('po-a').status).toBe('submitted');
      expect(store.get('po-b').status).toBe('submitted');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('asks to retry and leaves a row waiting for its ordkey lookup untouched', async () => {
      const r = row({ status: 'pending', orderAttemptedAt: new Date(), lastError: ORDER_LOOKUP_PENDING_ERROR });
      const { manager, store, wowpress } = setup(r);
      const error = await manager
        .cancelForOrder('so-1', 'gate', undefined, { keepOnRefusal: true })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).not.toBeInstanceOf(PrintInProductionError);
      expect((error as Error).message).toBe(PRINT_CANCEL_RETRY_MESSAGE);
      expect(store.get(r.id)).toMatchObject({ status: 'pending', lastError: ORDER_LOOKUP_PENDING_ERROR });
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('keepOnRefusal still hands an order sent but not confirmed to the operator', async () => {
      const r = row({ status: 'failed', orderAttemptedAt: new Date() });
      const { manager, store } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'gate', undefined, { keepOnRefusal: true })).rejects.toBeInstanceOf(
        PrintInProductionError,
      );
      expect(store.get(r.id).status).toBe('cancel_refused');
    });

    it('treats an order sent but not confirmed (no ordnum) as refused without calling wowpress', async () => {
      const r = row({ status: 'failed', orderAttemptedAt: new Date() });
      const { manager, store, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(store.get(r.id).status).toBe('cancel_refused');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('keeps refusing a row already in cancel_refused without calling wowpress again', async () => {
      const r = row({ ...SUBMITTED, status: 'cancel_refused', cancelRefusedAt: new Date() });
      const { manager, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it.each(['shipped', 'delivered'] as const)('blocks a %s row (post-shipment rules)', async (status) => {
      const r = row({ ...SUBMITTED, status, trackingNumber: '123' });
      const { manager, store, wowpress } = setup(r);
      const error = await manager.cancelForOrder('so-1', 'gate').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toBe('이미 출고된 주문은 취소할 수 없습니다. 고객센터로 문의해 주세요.');
      expect(store.get(r.id).status).toBe(status);
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it.each(['shipped', 'delivered'] as const)(
      'record on a %s row keeps status and tracking but flags it for the operator',
      async (status) => {
        const r = row({ ...SUBMITTED, status, trackingNumber: '123', cancelResolvedAt: new Date() });
        const { manager, store, wowpress } = setup(r);
        await expect(manager.cancelForOrder('so-1', 'record')).resolves.toEqual(NOTHING_CANCELLED);
        expect(wowpress.cancel).not.toHaveBeenCalled();
        expect(store.get(r.id)).toMatchObject({
          status,
          trackingNumber: '123',
          lastError: SHIPPED_BEFORE_CANCEL_ERROR,
          cancelResolvedAt: null,
        });
        expect(store.get(r.id).cancelRefusedAt).toBeInstanceOf(Date);
      },
    );

    it('record of a partial quantity on a shipped row flags it too', async () => {
      const r = row({ ...SUBMITTED, status: 'shipped', trackingNumber: '123' });
      const { manager, store } = setup(r);
      store.quantities.set(r.salesOrderLineId, 3);
      await manager.cancelForOrder('so-1', 'record', [{ salesOrderLineId: r.salesOrderLineId, quantity: 1 }]);
      expect(store.get(r.id)).toMatchObject({ status: 'shipped', lastError: SHIPPED_BEFORE_CANCEL_ERROR });
      expect(store.get(r.id).cancelRefusedAt).toBeInstanceOf(Date);
    });

    it('gate on a shipped row does not flag it (the cancel is refused instead)', async () => {
      const r = row({ ...SUBMITTED, status: 'shipped', trackingNumber: '123' });
      const { manager, store } = setup(r);
      await manager.cancelForOrder('so-1', 'gate').catch(() => undefined);
      expect(store.get(r.id).cancelRefusedAt).toBeNull();
    });

    it('passes an already cancelled row (safe to retry)', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelled' });
      const { manager, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'gate')).resolves.toEqual(NOTHING_CANCELLED);
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });
  });

  describe('refusal detection', () => {
    it('treats a network error as retryable, not as refused', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new Error('socket hang up'));

      const error = await manager.cancelForOrder('so-1', 'gate').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UpstreamUnavailableError);
      expect((error as Error).message).toBe(PRINT_CANCEL_RETRY_MESSAGE);
      expect(wowpress.detail).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancelling');
    });

    it('treats 401 on cancel as retryable without consulting detail', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new WowpressUnauthorizedError());
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(UpstreamUnavailableError);
      expect(wowpress.detail).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancelling');
    });

    it('treats an api error as retryable when detail still says cancellable', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new WowpressApiError('resultCode 500'));
      wowpress.detail.mockResolvedValue({
        ordstat: 1,
        jobstat: null,
        carrierCode: null,
        trackingNumber: null,
        boxNumber: null,
      });
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(UpstreamUnavailableError);
      expect(store.get(r.id).status).toBe('cancelling');
    });

    it('treats an api error as retryable when detail itself fails', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new WowpressApiError('resultCode 500'));
      wowpress.detail.mockRejectedValue(new Error('timeout'));
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(UpstreamUnavailableError);
      expect(store.get(r.id).status).toBe('cancelling');
    });
  });

  describe('scope and ordering', () => {
    it('blocks the whole customer cancel when one print line is refused, and leaves non-print orders unchanged', async () => {
      const pending = row({ status: 'pending' });
      const refusedLine = row({ ...SUBMITTED, vendorOrderNumber: 'WP-2' });
      const okLine = row({ ...SUBMITTED, vendorOrderNumber: 'WP-3' });
      const other = row({ salesOrderId: 'so-2', status: 'pending' });
      const { manager, store, wowpress } = setup(pending, refusedLine, okLine, other);
      wowpress.detail.mockImplementation((ordnum) =>
        Promise.resolve(
          ordnum === 'WP-2'
            ? IN_PRODUCTION
            : { ordstat: 1, jobstat: null, carrierCode: null, trackingNumber: null, boxNumber: null },
        ),
      );

      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);

      expect(store.get(refusedLine.id).status).toBe('cancel_refused');
      // 거절을 미리 확인했으므로 다른 줄은 와우프레스에서도 우리 쪽에서도 그대로다
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(store.get(okLine.id).status).toBe('submitted');
      expect(store.get(pending.id).status).toBe('pending');
      expect(store.get(other.id).status).toBe('pending');

      const { manager: plain, wowpress: idle } = setup(row({ salesOrderId: 'so-9' }));
      await expect(plain.cancelForOrder('so-other', 'gate')).resolves.toEqual(NOTHING_CANCELLED);
      expect(idle.cancel).not.toHaveBeenCalled();
    });

    it('checks blocking rows before calling wowpress for any line', async () => {
      const submitted = row(SUBMITTED);
      const busy = row({ status: 'submitting', submittingAt: new Date() });
      const { manager, store, wowpress } = setup(submitted, busy);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toThrow(PRINT_CANCEL_RETRY_MESSAGE);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(store.get(submitted.id).status).toBe('submitted');
    });

    it('only processes print lines in the requested scope', async () => {
      const inScope = row({ status: 'pending' });
      const outOfScope = row({ ...SUBMITTED });
      const { manager, store, wowpress } = setup(inScope, outOfScope);
      await manager.cancelForOrder('so-1', 'gate', [{ salesOrderLineId: inScope.salesOrderLineId, quantity: 1 }]);
      expect(store.get(inScope.id).status).toBe('cancelled');
      expect(store.get(outOfScope.id).status).toBe('submitted');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('rejects cancelling part of a print line quantity', async () => {
      const r = row({ status: 'pending' });
      const { manager, store } = setup(r);
      store.quantities.set(r.salesOrderLineId, 3);
      await expect(
        manager.cancelForOrder('so-1', 'gate', [{ salesOrderLineId: r.salesOrderLineId, quantity: 1 }]),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(store.get(r.id).status).toBe('pending');
    });
  });

  describe('race with the submit worker', () => {
    it('re-reads and cancels at wowpress when the worker submitted the row first', async () => {
      const r = row({ status: 'pending' });
      const { manager, store, repo, wowpress } = setup(r);
      repo.beforeWrite = (id) => store.put({ ...store.get(id), ...SUBMITTED });
      await manager.cancelForOrder('so-1', 'gate');
      expect(wowpress.cancel).toHaveBeenCalledWith('WP-1');
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('asks to retry when the worker claimed the row first', async () => {
      const r = row({ status: 'pending' });
      const { manager, store, repo, wowpress } = setup(r);
      repo.beforeWrite = (id) => store.put({ ...store.get(id), status: 'submitting', submittingAt: new Date() });
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toThrow(PRINT_CANCEL_RETRY_MESSAGE);
      expect(store.get(r.id).status).toBe('submitting');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });
  });

  describe('cancel claim (cancelling)', () => {
    it('calls wowpress cancel once for two concurrent gate calls', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      let release!: () => void;
      wowpress.cancel.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      wowpress.detail.mockResolvedValue(CANCELLABLE);
      const first = manager.cancelForOrder('so-1', 'gate');
      await new Promise((resolve) => setImmediate(resolve));
      expect(store.get(r.id).status).toBe('cancelling');

      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toThrow(PRINT_CANCEL_RETRY_MESSAGE);
      release();
      await expect(first).resolves.toEqual({ vendorCancelled: [r.id], locallyCancelled: [] });

      expect(wowpress.cancel).toHaveBeenCalledTimes(1);
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('does not call cancel again after a lost write when detail says ordstat 90', async () => {
      const r = row(SUBMITTED);
      const { manager, store, repo, wowpress } = setup(r);
      repo.markVendorCancelled.mockRejectedValueOnce(new Error('connection terminated'));
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toThrow('connection terminated');
      expect(store.get(r.id).status).toBe('cancelling');

      wowpress.detail.mockResolvedValue(VENDOR_CANCELLED);
      await expect(manager.cancelForOrder('so-1', 'gate')).resolves.toEqual({
        vendorCancelled: [r.id],
        locallyCancelled: [],
      });
      expect(wowpress.cancel).toHaveBeenCalledTimes(1);
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('treats an api error whose detail shows ordstat 90 as cancelled', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new WowpressApiError('이미 취소된 주문입니다'));
      wowpress.detail.mockResolvedValue(VENDOR_CANCELLED);
      await manager.cancelForOrder('so-1', 'gate');
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('records cancel_refused when a stuck cancelling row turns out to be in production', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelling' });
      const { manager, store, wowpress } = setup(r);
      wowpress.detail.mockResolvedValue(IN_PRODUCTION);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(store.get(r.id).status).toBe('cancel_refused');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('re-claims a stale cancelling row that wowpress still shows as cancellable', async () => {
      const r = row({
        ...SUBMITTED,
        status: 'cancelling',
        updatedAt: new Date(Date.now() - CANCEL_CLAIM_STALE_MS - 1000),
      });
      const { manager, store, repo, wowpress } = setup(r);
      wowpress.detail.mockResolvedValue(CANCELLABLE);
      await manager.cancelForOrder('so-1', 'gate');
      expect(repo.reclaimCancelling).toHaveBeenCalledTimes(1);
      expect(wowpress.cancel).toHaveBeenCalledTimes(1);
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('asks to retry on a fresh cancelling row that wowpress still shows as cancellable', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelling', updatedAt: new Date() });
      const { manager, store, wowpress } = setup(r);
      wowpress.detail.mockResolvedValue(CANCELLABLE);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toThrow(PRINT_CANCEL_RETRY_MESSAGE);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancelling');
    });
  });

  describe('quantity validation and failure notes', () => {
    it.each([
      [4, '취소 수량(4개)이 취소 가능 수량(3개)을 초과합니다.'],
      [0, 'must be positive'],
    ])('rejects asked quantity %i before any wowpress call', async (quantity, message) => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      store.quantities.set(r.salesOrderLineId, 3);
      const error = await manager
        .cancelForOrder('so-1', 'gate', [{ salesOrderLineId: r.salesOrderLineId, quantity }])
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestError);
      expect((error as Error).message).toContain(message);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(wowpress.detail).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('submitted');
    });

    it('validates non-print lines in the same request before any wowpress call', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      store.quantities.set('normal-line', 1);
      const error = await manager
        .cancelForOrder('so-1', 'gate', [
          { salesOrderLineId: r.salesOrderLineId, quantity: 1 },
          { salesOrderLineId: 'normal-line', quantity: 99 },
        ])
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestError);
      expect((error as Error).message).toBe('취소 수량(99개)이 취소 가능 수량(1개)을 초과합니다.');
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('submitted');
    });

    it('rejects a requested line that does not belong to the order before any wowpress call', async () => {
      const r = row(SUBMITTED);
      const { manager, wowpress } = setup(r);
      await expect(
        manager.cancelForOrder('so-1', 'gate', [
          { salesOrderLineId: r.salesOrderLineId, quantity: 1 },
          { salesOrderLineId: 'other-order-line', quantity: 1 },
        ]),
      ).rejects.toThrow('Sales order line other-order-line does not belong to so-1');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('notes on wowpress-cancelled rows that the sales cancel failed, without changing status', async () => {
      const r = row(SUBMITTED);
      const local = row({ status: 'pending' });
      const { manager, store } = setup(r, local);
      const result = await manager.cancelForOrder('so-1', 'gate');
      await manager.noteSalesCancelFailed(result, new Error('채널 줄 번호가 없는 줄'));
      expect(store.get(r.id)).toMatchObject({
        status: 'cancelled',
        lastError: 'wowpress cancelled but sales cancel failed: 채널 줄 번호가 없는 줄',
      });
      expect(store.get(local.id)).toMatchObject({
        status: 'cancelled',
        lastError: 'print order cancelled but sales cancel failed: 채널 줄 번호가 없는 줄',
      });
      expect(store.get(r.id).salesCancelFailedAt).toBeInstanceOf(Date);
      expect(store.get(local.id).salesCancelFailedAt).toBeInstanceOf(Date);
    });

    it('notes rows already cancelled at wowpress when a later line stops the gate', async () => {
      const first = row({ ...SUBMITTED, vendorOrderNumber: 'WP-A' });
      const second = row({ ...SUBMITTED, vendorOrderNumber: 'WP-B' });
      const { manager, store, wowpress } = setup(first, second);
      wowpress.detail.mockResolvedValue(CANCELLABLE);
      wowpress.cancel.mockImplementation((ordnum) =>
        ordnum === 'WP-B' ? Promise.reject(new Error('ETIMEDOUT')) : Promise.resolve(),
      );
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(UpstreamUnavailableError);
      expect(store.get(first.id)).toMatchObject({
        status: 'cancelled',
        lastError: `wowpress cancelled but sales cancel failed: ${PRINT_CANCEL_RETRY_MESSAGE}`,
      });
    });
  });

  describe('suspected duplicate or unsaved wowpress orders', () => {
    const DUPLICATE = 'duplicate wowpress order suspected: WP-1 / WP-2';

    it('refuses in gate mode without calling wowpress when a second ordnum may exist', async () => {
      const r = row({ ...SUBMITTED, lastError: DUPLICATE });
      const { manager, store, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(wowpress.detail).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancel_refused');
      expect(store.get(r.id).lastError).toContain(DUPLICATE);
    });

    it('refuses a row whose received ordnum was not saved', async () => {
      const r = row({
        status: 'failed',
        orderAttemptedAt: new Date(),
        lastError: 'order sent, ordnum W-3 not saved — verify on WowPress',
      });
      const { manager, store, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancel_refused');
    });

    it('records cancel_refused in record mode without calling wowpress', async () => {
      const r = row({ ...SUBMITTED, lastError: DUPLICATE });
      const { manager, store, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'record')).resolves.toEqual(NOTHING_CANCELLED);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancel_refused');
    });
    it('refuses an already cancelled row whose lastError says another wowpress order may exist', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelled', lastError: DUPLICATE });
      const { manager, store, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(wowpress.detail).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancel_refused');
      expect(store.get(r.id).lastError).toBe(DUPLICATE);
    });

    it('checks such a cancelled row before cancelling other lines at wowpress', async () => {
      const blocked = row({
        status: 'cancelled',
        orderAttemptedAt: new Date(),
        lastError: 'order sent, ordnum W-3 not saved',
      });
      const live = row(SUBMITTED);
      const { manager, store, wowpress } = setup(live, blocked);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(store.get(live.id).status).toBe('submitted');
      expect(store.get(blocked.id).status).toBe('cancel_refused');
    });

    it.each(['gate', 'record'] as const)(
      'passes such a row in %s mode once an operator confirmed the cancellation on WowPress',
      async (mode) => {
        const r = row({
          ...SUBMITTED,
          status: 'cancelled',
          lastError: DUPLICATE,
          cancelResolvedAt: new Date(),
          cancelResolvedBy: 'op-1',
        });
        const { manager, store, wowpress } = setup(r);
        await expect(manager.cancelForOrder('so-1', mode)).resolves.toEqual(NOTHING_CANCELLED);
        expect(wowpress.cancel).not.toHaveBeenCalled();
        expect(store.get(r.id)).toMatchObject({ status: 'cancelled', lastError: DUPLICATE });
      },
    );

    it('a redelivered OrderCancelled does not reopen a row the operator resolved with proceed', async () => {
      const r = row({ ...SUBMITTED, status: 'submitted', cancelResolvedAt: new Date(), cancelResolvedBy: 'op-1' });
      const { manager, store, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'record', undefined, { redelivery: true })).resolves.toEqual(
        NOTHING_CANCELLED,
      );
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(wowpress.detail).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('submitted');
    });

    it('a new (not redelivered) record cancel still tries to cancel a row the operator resolved with proceed', async () => {
      const r = row({ ...SUBMITTED, status: 'submitted', cancelResolvedAt: new Date(), cancelResolvedBy: 'op-1' });
      const { manager, store, wowpress } = setup(r);
      await manager.cancelForOrder('so-1', 'record', undefined, { redelivery: false });
      expect(wowpress.cancel).toHaveBeenCalledTimes(1);
      expect(store.get(r.id)).toMatchObject({ status: 'cancelled', cancelResolvedAt: null, cancelResolvedBy: null });
    });

    it('a gate (new admin cancel) still tries to cancel a row the operator resolved with proceed', async () => {
      const r = row({ ...SUBMITTED, status: 'submitted', cancelResolvedAt: new Date(), cancelResolvedBy: 'op-1' });
      const { manager, store, wowpress } = setup(r);
      await manager.cancelForOrder('so-1', 'gate');
      expect(wowpress.cancel).toHaveBeenCalledTimes(1);
      expect(store.get(r.id)).toMatchObject({ status: 'cancelled', cancelResolvedAt: null, cancelResolvedBy: null });
    });

    it('refuses again once new evidence cleared the operator resolution', async () => {
      const r = row({
        ...SUBMITTED,
        status: 'cancelled',
        lastError: DUPLICATE,
        cancelResolvedAt: new Date(),
        cancelResolvedBy: 'op-1',
      });
      const { manager, store } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'gate')).resolves.toEqual(NOTHING_CANCELLED);
      // 저장소는 새 보호 기록을 쓰는 같은 UPDATE 에서 마무리 표시를 지운다
      store.put({
        ...store.get(r.id),
        lastError: `${DUPLICATE} | W-9 not saved`,
        cancelResolvedAt: null,
        cancelResolvedBy: null,
      });
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(store.get(r.id).status).toBe('cancel_refused');
    });

    it('accepts the remaining quantity for a line whose print was cancelled and resolved by an operator', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelled', cancelResolvedAt: new Date(), cancelResolvedBy: 'op-1' });
      const { manager, store, wowpress } = setup(r);
      store.quantities.set(r.salesOrderLineId, 3);
      await expect(
        manager.cancelForOrder('so-1', 'gate', [{ salesOrderLineId: r.salesOrderLineId, quantity: 1 }]),
      ).resolves.toEqual(NOTHING_CANCELLED);
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('still refuses a partial quantity on a print line that is not resolved', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelled' });
      const { manager, store } = setup(r);
      store.quantities.set(r.salesOrderLineId, 3);
      await expect(
        manager.cancelForOrder('so-1', 'gate', [{ salesOrderLineId: r.salesOrderLineId, quantity: 1 }]),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('moves such a cancelled row to cancel_refused in record mode', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelled', lastError: DUPLICATE });
      const { manager, store, wowpress } = setup(r);
      await expect(manager.cancelForOrder('so-1', 'record')).resolves.toEqual(NOTHING_CANCELLED);
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancel_refused');
    });
  });

  describe('protected evidence recorded while the wowpress cancel is in flight', () => {
    const LATE = 'order placed after cancel: WP-9 — verify on WowPress';

    it('gate: does not mark cancelled, moves to cancel_refused keeping lastError, and refuses', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockImplementation(() => {
        store.put({ ...store.get(r.id), lastError: LATE });
        return Promise.resolve();
      });
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(store.get(r.id)).toMatchObject({ status: 'cancel_refused', lastError: LATE });
    });

    it('record: leaves it as cancel_refused without throwing', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockImplementation(() => {
        store.put({ ...store.get(r.id), lastError: LATE });
        return Promise.resolve();
      });
      await expect(manager.cancelForOrder('so-1', 'record')).resolves.toEqual(NOTHING_CANCELLED);
      expect(store.get(r.id)).toMatchObject({ status: 'cancel_refused', lastError: LATE });
    });
  });

  describe('cancelled row whose evidence arrives after the first read', () => {
    const LATE = 'order placed after cancel: WP-9 — verify on WowPress';

    function evidenceAfterRead(reader: FakeReader, store: Store, id: string) {
      reader.forSalesOrder.mockImplementationOnce((salesOrderId: string) => {
        const snapshot = [...store.rows.values()].filter((r) => r.salesOrderId === salesOrderId).map((r) => ({ ...r }));
        store.put({ ...store.get(id), lastError: LATE });
        return Promise.resolve(snapshot);
      });
    }

    it('gate: re-reads before answering done and refuses', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelled' });
      const { manager, store, reader, wowpress } = setup(r);
      evidenceAfterRead(reader, store, r.id);
      await expect(manager.cancelForOrder('so-1', 'gate')).rejects.toBeInstanceOf(PrintInProductionError);
      expect(store.get(r.id)).toMatchObject({ status: 'cancel_refused', lastError: LATE });
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('record: moves it to cancel_refused without throwing', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelled' });
      const { manager, store, reader } = setup(r);
      evidenceAfterRead(reader, store, r.id);
      await expect(manager.cancelForOrder('so-1', 'record')).resolves.toEqual(NOTHING_CANCELLED);
      expect(store.get(r.id)).toMatchObject({ status: 'cancel_refused', lastError: LATE });
    });

    it('gate: still passes a row the operator resolved', async () => {
      const r = row({ ...SUBMITTED, status: 'cancelled', cancelResolvedAt: new Date(), cancelResolvedBy: 'op-1' });
      const { manager, store, reader } = setup(r);
      evidenceAfterRead(reader, store, r.id);
      await expect(manager.cancelForOrder('so-1', 'gate')).resolves.toEqual(NOTHING_CANCELLED);
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('record mode does not touch the sales-cancel failure time', async () => {
      const failedAt = new Date();
      const r = row({ status: 'cancelled', salesCancelFailedAt: failedAt });
      const { manager, store } = setup(r);
      await manager.cancelForOrder('so-1', 'record');
      expect(store.get(r.id).salesCancelFailedAt).toBe(failedAt);
    });
  });

  describe('record mode (OrderCancelled)', () => {
    it('records cancel_refused without throwing on OrderCancelled', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new WowpressApiError('취소할 수 없는 상태입니다'));
      wowpress.detail.mockResolvedValue(IN_PRODUCTION);
      await expect(manager.cancelForOrder('so-1', 'record')).resolves.toEqual(NOTHING_CANCELLED);
      expect(store.get(r.id).status).toBe('cancel_refused');
    });

    it('leaves a wowpress outage on the board as cancel_refused instead of throwing', async () => {
      const r = row(SUBMITTED);
      const { manager, store, wowpress } = setup(r);
      wowpress.cancel.mockRejectedValue(new Error('ECONNRESET'));
      await expect(manager.cancelForOrder('so-1', 'record')).resolves.toEqual(NOTHING_CANCELLED);
      expect(store.get(r.id).status).toBe('cancel_refused');
      expect(store.get(r.id).lastError).toContain('ECONNRESET');
    });

    it('stops a submitting row from being ordered by recording cancel_refused', async () => {
      const r = row({ status: 'submitting', submittingAt: new Date() });
      const { manager, store, wowpress } = setup(r);
      await manager.cancelForOrder('so-1', 'record');
      expect(store.get(r.id).status).toBe('cancel_refused');
      expect(wowpress.cancel).not.toHaveBeenCalled();
    });

    it('is idempotent on redelivery', async () => {
      const done = row({ ...SUBMITTED, status: 'cancelled' });
      const refused = row({ ...SUBMITTED, vendorOrderNumber: 'WP-9', status: 'cancel_refused' });
      const { manager, store, wowpress, repo } = setup(done, refused);
      await manager.cancelForOrder('so-1', 'record');
      expect(wowpress.cancel).not.toHaveBeenCalled();
      expect(repo.compareAndSet).not.toHaveBeenCalled();
      expect(store.get(done.id).status).toBe('cancelled');
      expect(store.get(refused.id).status).toBe('cancel_refused');
    });

    it('cancels pending rows and wowpress orders that are still cancellable', async () => {
      const pending = row({ status: 'pending' });
      const submitted = row(SUBMITTED);
      const { manager, store } = setup(pending, submitted);
      await manager.cancelForOrder('so-1', 'record');
      expect(store.get(pending.id).status).toBe('cancelled');
      expect(store.get(submitted.id).status).toBe('cancelled');
    });
  });
});
