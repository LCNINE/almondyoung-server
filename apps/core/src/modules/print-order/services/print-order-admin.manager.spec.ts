import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService } from '@app/db';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { CANCEL_CLAIM_STALE_MS } from './print-order-cancellation.manager';
import { ORDER_UNCONFIRMED_ERROR, PRINT_ORDER_STALE_MS, unsavedOrdnumError } from './print-order-submit.manager';
import { PrintOrderAdminManager } from './print-order-admin.manager';
import { PrintOrderReader, type PrintSalesLineState } from './print-order.reader';
import {
  DUPLICATE_ORDER_ERROR_PREFIX,
  isPreservedLastError,
  lateOrdnumError,
  PrintOrderRepository,
} from './print-order.repository';

// 모든 메서드를 덮어써 DB 를 쓰지 않는 가짜라 DbService 자리는 형 변환으로 채운다
const noDb = {} as unknown as DbService<typeof wmsSchema>;
const ACTOR = '0190f1d2-0000-7000-8000-00000000e001';

class Store {
  rows = new Map<string, PrintOrderRow>();
  lines = new Map<string, PrintSalesLineState>();
  refundNotOpened = new Set<string>();
  now = Date.now();
  put(r: PrintOrderRow) {
    this.rows.set(r.id, r);
  }
  get(id: string): PrintOrderRow {
    const r = this.rows.get(id);
    if (!r) throw new Error(`no row ${id}`);
    return r;
  }
}

class FakeRepo extends PrintOrderRepository {
  beforeWrite: (() => void) | null = null;
  constructor(private readonly store: Store) {
    super(noDb);
  }
  findById = jest.fn((id: string) => Promise.resolve(this.store.rows.has(id) ? { ...this.store.get(id) } : null));
  compareAndSetUnprotected = jest.fn((snapshot: PrintOrderRow, patch: Partial<PrintOrderRow>) => {
    this.beforeWrite?.();
    this.beforeWrite = null;
    const cur = this.store.get(snapshot.id);
    const same =
      cur.status === snapshot.status &&
      cur.vendorOrderNumber === snapshot.vendorOrderNumber &&
      (cur.orderAttemptedAt === null) === (snapshot.orderAttemptedAt === null) &&
      !isPreservedLastError(cur.lastError);
    if (same) this.store.put({ ...cur, ...patch, updatedAt: new Date() });
    return Promise.resolve(same);
  });
  updateIfUntouched = jest.fn((snapshot: PrintOrderRow, patch: Partial<PrintOrderRow>) => {
    this.beforeWrite?.();
    this.beforeWrite = null;
    const cur = this.store.get(snapshot.id);
    const same = cur.status === snapshot.status && cur.updatedAt.getTime() === snapshot.updatedAt.getTime();
    if (same) this.store.put({ ...cur, ...patch, updatedAt: new Date(cur.updatedAt.getTime() + 1) });
    return Promise.resolve(same);
  });
  confirmTest = jest.fn((id: string, actorId: string, note: string) => {
    const cur = this.store.get(id);
    if (cur.testConfirmedAt) return Promise.resolve(false);
    this.store.put({ ...cur, testConfirmedAt: new Date(), testConfirmedBy: actorId, testNote: note });
    return Promise.resolve(true);
  });
  update = jest.fn((id: string, patch: Partial<PrintOrderRow>) => {
    this.store.put({ ...this.store.get(id), ...patch });
    return Promise.resolve();
  });
}

class FakeReader extends PrintOrderReader {
  constructor(private readonly store: Store) {
    super(noDb);
  }
  salesLine = jest.fn((lineId: string) => Promise.resolve(this.store.lines.get(lineId) ?? null));
  refundNotOpened = jest.fn((id: string) => Promise.resolve(this.store.refundNotOpened.has(id)));
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup() {
  const store = new Store();
  const repo = new FakeRepo(store);
  const reader = new FakeReader(store);
  const manager = new PrintOrderAdminManager(repo, reader);
  const add = (overrides: Partial<PrintOrderRow> = {}) => {
    const r = row(overrides);
    store.put(r);
    store.lines.set(r.salesOrderLineId, { salesOrderStatus: 'confirmed', lineStatus: 'pending', quantity: 2 });
    return r;
  };
  return { store, repo, manager, add };
}

describe('PrintOrderAdminManager', () => {
  describe('retry', () => {
    it('puts a failed row back to pending and resets attempts', async () => {
      const { store, manager, add } = setup();
      const r = add({ status: 'failed', attemptCount: 3, lastError: 'quote failed', nextAttemptAt: new Date(0) });
      const out = await manager.retry(r.id, ACTOR, false);
      expect(out).toMatchObject({ status: 'pending', attemptCount: 0, lastError: null });
      expect(store.get(r.id).nextAttemptAt.getTime()).toBeGreaterThan(0);
    });

    it('puts an unsupported row back to pending', async () => {
      const { manager, add } = setup();
      const r = add({ status: 'unsupported', lastError: 'no wowpress spec' });
      await expect(manager.retry(r.id, ACTOR, false)).resolves.toMatchObject({ status: 'pending' });
    });

    it.each([
      'pending',
      'submitting',
      'submitted',
      'shipped',
      'delivered',
      'cancelling',
      'cancelled',
      'cancel_refused',
    ])('refuses to retry a %s row', async (status) => {
      const { manager, add } = setup();
      const r = add({ status: status as PrintOrderRow['status'] });
      await expect(manager.retry(r.id, ACTOR, false)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('404s an unknown row', async () => {
      const { manager } = setup();
      await expect(manager.retry('nope', ACTOR, false)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('requires the operator to confirm no wowpress order exists when an order may have been sent', async () => {
      const { store, repo, manager, add } = setup();
      const r = add({ status: 'failed', orderAttemptedAt: new Date(), lastError: ORDER_UNCONFIRMED_ERROR });
      await expect(manager.retry(r.id, ACTOR, false)).rejects.toBeInstanceOf(BadRequestError);
      expect(repo.compareAndSetUnprotected).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('failed');
    });

    it('clears the order right only with the explicit confirmation', async () => {
      const { manager, add } = setup();
      const r = add({ status: 'failed', orderAttemptedAt: new Date(), lastError: ORDER_UNCONFIRMED_ERROR });
      await expect(manager.retry(r.id, ACTOR, true)).resolves.toMatchObject({
        status: 'pending',
        orderAttemptedAt: null,
      });
    });

    it('keeps the ordnum and order right so the worker only re-sends the file', async () => {
      const { manager, add } = setup();
      const attempted = new Date();
      const r = add({ status: 'failed', vendorOrderNumber: 'WP-1', orderAttemptedAt: attempted });
      const out = await manager.retry(r.id, ACTOR, true);
      expect(out).toMatchObject({ status: 'pending', vendorOrderNumber: 'WP-1', orderAttemptedAt: attempted });
    });

    it.each([`${DUPLICATE_ORDER_ERROR_PREFIX}: WP-1 / WP-2`, unsavedOrdnumError('WP-3')])(
      'refuses rows holding a protected record (%s)',
      async (lastError) => {
        const { repo, manager, add } = setup();
        const r = add({ status: 'failed', orderAttemptedAt: new Date(), lastError });
        await expect(manager.retry(r.id, ACTOR, true)).rejects.toBeInstanceOf(ConflictError);
        expect(repo.compareAndSetUnprotected).not.toHaveBeenCalled();
      },
    );

    it('fails and leaves the row untouched when a protected record lands between the read and the update', async () => {
      const { store, repo, manager, add } = setup();
      const r = add({ status: 'failed', orderAttemptedAt: new Date(), lastError: ORDER_UNCONFIRMED_ERROR });
      const late = unsavedOrdnumError('WP-LATE');
      repo.beforeWrite = () => store.put({ ...store.get(r.id), lastError: late });
      await expect(manager.retry(r.id, ACTOR, true)).rejects.toBeInstanceOf(ConflictError);
      expect(store.get(r.id)).toMatchObject({ status: 'failed', lastError: late });
      expect(store.get(r.id).orderAttemptedAt).not.toBeNull();
    });

    it('reports a conflict when the row changed underneath', async () => {
      const { store, repo, manager, add } = setup();
      const r = add({ status: 'failed' });
      repo.beforeWrite = () => store.put({ ...store.get(r.id), status: 'cancelled' });
      await expect(manager.retry(r.id, ACTOR, false)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('confirmTest', () => {
    it('records who confirmed and the note', async () => {
      const { manager, add } = setup();
      const r = add({ status: 'submitted', testMemo: true });
      const out = await manager.confirmTest(r.id, ACTOR, '  출력 가능  ');
      expect(out).toMatchObject({ testConfirmedBy: ACTOR, testNote: '출력 가능' });
      expect(out.testConfirmedAt).toBeInstanceOf(Date);
    });

    it('is idempotent and keeps the first confirmation', async () => {
      const { manager, add } = setup();
      const r = add({ status: 'submitted', testMemo: true });
      const first = await manager.confirmTest(r.id, ACTOR, '출력 가능');
      const second = await manager.confirmTest(r.id, 'someone-else', '수정 필요');
      expect(second).toMatchObject({ testConfirmedBy: ACTOR, testNote: '출력 가능' });
      expect(second.testConfirmedAt).toEqual(first.testConfirmedAt);
    });

    it('rejects an empty note', async () => {
      const { manager, add } = setup();
      const r = add({ status: 'submitted', testMemo: true });
      await expect(manager.confirmTest(r.id, ACTOR, '   ')).rejects.toBeInstanceOf(BadRequestError);
    });

    it('rejects a row that was not sent with the test memo', async () => {
      const { manager, add } = setup();
      const r = add({ status: 'submitted', testMemo: false });
      await expect(manager.confirmTest(r.id, ACTOR, '출력 가능')).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('resolveCancel', () => {
    const refused = {
      status: 'cancel_refused' as const,
      vendorOrderNumber: 'WP-1',
      orderAttemptedAt: new Date(),
      fileDeliveredAt: new Date(),
    };

    it('cancelled: marks the row cancelled with who resolved it and returns the full line to cancel', async () => {
      const { store, manager, add } = setup();
      const r = add(refused);
      const out = await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      expect(store.get(r.id)).toMatchObject({ status: 'cancelled', cancelResolvedBy: ACTOR });
      expect(store.get(r.id).cancelResolvedAt).toBeInstanceOf(Date);
      expect(out.cancelSales).toBe(true);
      await expect(manager.salesCancelTarget(out.row)).resolves.toEqual({
        salesOrderId: 'so-1',
        salesOrderLineId: r.salesOrderLineId,
        lineQuantity: 2,
      });
    });

    it('cancelled: skips the sales cancel when the sales order is already cancelled (channel cancel)', async () => {
      const { store, manager, add } = setup();
      const r = add(refused);
      store.lines.set(r.salesOrderLineId, { salesOrderStatus: 'cancelled', lineStatus: 'cancelled', quantity: 2 });
      const out = await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      expect(store.get(r.id).status).toBe('cancelled');
      await expect(manager.salesCancelTarget(out.row)).resolves.toBeNull();
    });

    it('cancelled: hands back the same line again while the sales line still has quantity left', async () => {
      const { store, manager, add } = setup();
      const r = add(refused);
      const first = await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      store.refundNotOpened.add(r.id);
      const second = await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      expect(first.cancelSales).toBe(true);
      expect(second.cancelSales).toBe(true);
    });

    it('cancelled: a second click after the sales line was fully cancelled opens nothing', async () => {
      const { manager, add } = setup();
      const r = add(refused);
      await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).resolves.toMatchObject({ cancelSales: false });
    });

    it('cancelled: keeps a protected lastError as is', async () => {
      const { store, manager, add } = setup();
      const lastError = `${DUPLICATE_ORDER_ERROR_PREFIX}: WP-1 / WP-2`;
      const r = add({ ...refused, lastError });
      await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      expect(store.get(r.id)).toMatchObject({ status: 'cancelled', lastError });
    });

    it('proceed: returns the row to submitted', async () => {
      const { store, manager, add } = setup();
      const r = add(refused);
      const out = await manager.resolveCancel(r.id, 'proceed', ACTOR);
      expect(store.get(r.id).status).toBe('submitted');
      // 생산 진행도 운영자 마무리로 남겨 같은 취소 이벤트의 재전달이 뒤집지 못하게 한다
      expect(store.get(r.id).cancelResolvedAt).toBeInstanceOf(Date);
      expect(store.get(r.id).cancelResolvedBy).toBe(ACTOR);
      expect(out.cancelSales).toBe(false);
    });

    it('proceed: sends a row whose file never reached WowPress back to the worker to deliver it', async () => {
      const { store, manager, add } = setup();
      const r = add({ ...refused, fileDeliveredAt: null });
      await manager.resolveCancel(r.id, 'proceed', ACTOR);
      expect(store.get(r.id)).toMatchObject({ status: 'pending', vendorOrderNumber: 'WP-1' });
      expect(store.get(r.id).nextAttemptAt).toBeInstanceOf(Date);
    });

    it('proceed: returns the row to shipped when it already has a tracking number', async () => {
      const { store, manager, add } = setup();
      const r = add({ ...refused, trackingNumber: '1234' });
      await manager.resolveCancel(r.id, 'proceed', ACTOR);
      expect(store.get(r.id).status).toBe('shipped');
    });

    it('proceed: a row without a wowpress ordnum goes to failed, never back to the order queue', async () => {
      const { store, manager, add } = setup();
      const r = add({ status: 'cancel_refused', orderAttemptedAt: new Date(), lastError: ORDER_UNCONFIRMED_ERROR });
      await manager.resolveCancel(r.id, 'proceed', ACTOR);
      expect(store.get(r.id).status).toBe('failed');
    });

    it.each(['shipped', 'delivered'] as const)(
      'proceed: acknowledges a %s row cancelled after shipping without changing its status',
      async (status) => {
        const { store, manager, add } = setup();
        const r = add({ status, vendorOrderNumber: 'WP-1', trackingNumber: '1234', cancelRefusedAt: new Date() });
        const out = await manager.resolveCancel(r.id, 'proceed', ACTOR);
        expect(store.get(r.id)).toMatchObject({ status, trackingNumber: '1234', cancelResolvedBy: ACTOR });
        expect(store.get(r.id).cancelResolvedAt).toBeInstanceOf(Date);
        expect(out.cancelSales).toBe(false);
      },
    );

    it('cancelled: refuses a row that already shipped', async () => {
      const { manager, add } = setup();
      const r = add({
        status: 'shipped',
        vendorOrderNumber: 'WP-1',
        trackingNumber: '1234',
        cancelRefusedAt: new Date(),
      });
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('proceed: a second click on an already resolved row is a no-op', async () => {
      const { repo, manager, add } = setup();
      const r = add(refused);
      await manager.resolveCancel(r.id, 'proceed', ACTOR);
      repo.updateIfUntouched.mockClear();
      await expect(manager.resolveCancel(r.id, 'proceed', ACTOR)).resolves.toMatchObject({ cancelSales: false });
      expect(repo.updateIfUntouched).not.toHaveBeenCalled();
    });

    it('accepts a cancelling row whose outcome is unknown (stale)', async () => {
      const { store, manager, add } = setup();
      const r = add({
        ...refused,
        status: 'cancelling',
        updatedAt: new Date(Date.now() - CANCEL_CLAIM_STALE_MS - 1000),
      });
      await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('refuses a cancelling row that may still be in flight', async () => {
      const { manager, add } = setup();
      const r = add({ ...refused, status: 'cancelling', updatedAt: new Date() });
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).rejects.toBeInstanceOf(BadRequestError);
    });

    it.each(['pending', 'submitted', 'failed', 'unsupported'])(
      'refuses cancelled outcome on a %s row',
      async (status) => {
        const { manager, add } = setup();
        const r = add({ status: status as PrintOrderRow['status'] });
        await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).rejects.toBeInstanceOf(BadRequestError);
      },
    );

    it('cancelled on a row cancelled by the normal path is a no-op without a sales cancel', async () => {
      const { manager, add } = setup();
      const r = add({ status: 'cancelled' });
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).resolves.toMatchObject({ cancelSales: false });
    });

    it('records on the row when the sales cancel after resolution failed', async () => {
      const { store, manager, add } = setup();
      const r = add({ ...refused, status: 'cancelled' });
      await manager.noteSalesCancelFailed(r.id, new Error('medusa down'));
      expect(store.get(r.id).lastError).toBe('print order cancelled but sales cancel failed: medusa down');
    });

    it('refuses (409) while a WowPress order may still be in flight', async () => {
      const { store, repo, manager, add } = setup();
      const r = add({ ...refused, submittingAt: new Date(Date.now() - 60_000) });
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).rejects.toBeInstanceOf(ConflictError);
      expect(repo.updateIfUntouched).not.toHaveBeenCalled();
      expect(store.get(r.id).status).toBe('cancel_refused');
    });

    it('checks the in-flight window before the replay path of an already resolved row', async () => {
      const { manager, add } = setup();
      const r = add({
        ...refused,
        status: 'cancelled',
        cancelResolvedAt: new Date(),
        cancelResolvedBy: ACTOR,
        submittingAt: new Date(Date.now() - 60_000),
      });
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).rejects.toBeInstanceOf(ConflictError);
    });

    it('accepts once the submit window has passed', async () => {
      const { store, manager, add } = setup();
      const r = add({ ...refused, submittingAt: new Date(Date.now() - PRINT_ORDER_STALE_MS - 1000) });
      await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      expect(store.get(r.id).status).toBe('cancelled');
    });

    it('re-opens a cancelled row whose sales line still has quantity left and marks it resolved', async () => {
      const { store, manager, add } = setup();
      const r = add({ status: 'cancelled', lastError: 'print order cancelled but sales cancel failed: x' });
      store.refundNotOpened.add(r.id);
      const out = await manager.resolveCancel(r.id, 'cancelled', ACTOR);
      expect(store.get(r.id)).toMatchObject({ status: 'cancelled', cancelResolvedBy: ACTOR });
      expect(out.cancelSales).toBe(true);
    });

    it('will not put a cancelled row back into production', async () => {
      const { store, manager, add } = setup();
      const r = add({ status: 'cancelled' });
      store.refundNotOpened.add(r.id);
      await expect(manager.resolveCancel(r.id, 'proceed', ACTOR)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('does not re-open a protected cancelled row the operator has not resolved', async () => {
      const { store, manager, add } = setup();
      const r = add({ status: 'cancelled', lastError: lateOrdnumError('W-1') });
      store.refundNotOpened.add(r.id);
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('stamps the last sales-cancel failure time', async () => {
      const { store, manager, add } = setup();
      const r = add({ ...refused, status: 'cancelled' });
      await manager.noteSalesCancelFailed(r.id, new Error('down'));
      expect(store.get(r.id).salesCancelFailedAt).toBeInstanceOf(Date);
    });

    it('a failure stamp without quantity left on the sales line opens nothing', async () => {
      const { store, repo, manager, add } = setup();
      const r = add({ status: 'cancelled', salesCancelFailedAt: new Date(), cancelResolvedAt: new Date() });
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).resolves.toMatchObject({ cancelSales: false });
      expect(repo.updateIfUntouched).not.toHaveBeenCalled();
      expect(store.get(r.id).salesCancelFailedAt).toBeInstanceOf(Date);
    });

    it('reports a conflict when another process touched the row first', async () => {
      const { store, repo, manager, add } = setup();
      const r = add(refused);
      repo.beforeWrite = () => store.put({ ...store.get(r.id), updatedAt: new Date(Date.now() + 5000) });
      await expect(manager.resolveCancel(r.id, 'cancelled', ACTOR)).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
