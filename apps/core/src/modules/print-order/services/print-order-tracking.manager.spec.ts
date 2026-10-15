import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WowpressClient } from '../wowpress/wowpress.client';
import { type WowpressOrderDetail, type WowpressTransport } from '../wowpress/wowpress.types';
import { PRINT_ORDER_TRACK_LIMIT, PrintOrderTrackingWorker } from '../workers/print-order-tracking.worker';
import { PrintOrderRepository } from './print-order.repository';
import { PrintOrderTrackingManager } from './print-order-tracking.manager';

const noNetwork: WowpressTransport = () => Promise.reject(new Error('real wowpress call in test'));

class FakeWowpress extends WowpressClient {
  detail = jest.fn<Promise<WowpressOrderDetail>, [string]>();
  constructor() {
    super(new ConfigService({}), noNetwork);
  }
}

class FakeRepo extends PrintOrderRepository {
  constructor() {
    // 모든 메서드를 덮어써 DB 를 쓰지 않는 가짜라 DbService 자리는 형 변환으로 채운다
    super({} as unknown as DbService<typeof wmsSchema>);
  }
  updateTracked = jest.fn<Promise<boolean>, [string, Partial<PrintOrderRow>]>(() => Promise.resolve(true));
  saveVendorBox = jest.fn<
    Promise<void>,
    [string, { vendorBoxNumber: string | null; vendorShippingFee: number | null }]
  >(() => Promise.resolve());
  touch = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
  trackable = jest.fn<Promise<PrintOrderRow[]>, [number]>(() => Promise.resolve([]));
}

function row(overrides: Partial<PrintOrderRow> = {}): PrintOrderRow {
  return {
    id: 'po-1',
    salesOrderId: 'so-1',
    salesOrderLineId: 'sol-1',
    almondDesignId: 'd-1',
    vendor: 'wowpress',
    status: 'submitted',
    testMemo: false,
    vendorOrderNumber: 'WP-1',
    vendorBoxNumber: null,
    vendorShippingFee: null,
    attemptCount: 1,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup() {
  const repo = new FakeRepo();
  const wowpress = new FakeWowpress();
  return { repo, wowpress, manager: new PrintOrderTrackingManager(repo, wowpress) };
}

describe('PrintOrderTrackingManager', () => {
  it('marks shipped with LOTTE when dlvyinvc appears and dlvyno is 109', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 80,
      jobstat: null,
      carrierCode: 109,
      trackingNumber: '1234567890',
      boxNumber: null,
    });

    await manager.refresh(row());

    expect(wowpress.detail).toHaveBeenCalledWith('WP-1');
    expect(repo.updateTracked).toHaveBeenCalledWith(
      'po-1',
      expect.objectContaining({ status: 'shipped', carrier: 'LOTTE', trackingNumber: '1234567890', deliveredAt: null }),
    );
    expect(repo.updateTracked.mock.calls[0]?.[1].shippedAt).toBeInstanceOf(Date);
  });

  it('marks shipped with CJ from dlvybox', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 80,
      jobstat: null,
      carrierCode: 156,
      trackingNumber: '1234',
      boxNumber: '4-156-1',
    });

    await manager.refresh(row());

    expect(repo.updateTracked).toHaveBeenCalledWith(
      'po-1',
      expect.objectContaining({ status: 'shipped', carrier: 'CJ', trackingNumber: '1234' }),
    );
  });

  it('fills vendor box number when missing', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 80,
      jobstat: null,
      carrierCode: 156,
      trackingNumber: '1234',
      boxNumber: '4-156-1',
    });

    await manager.refresh(row());

    expect(repo.saveVendorBox).toHaveBeenCalledWith('po-1', { vendorBoxNumber: '4-156-1', vendorShippingFee: null });
  });

  it('does not overwrite an existing vendor box number', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 80,
      jobstat: null,
      carrierCode: 156,
      trackingNumber: '1234',
      boxNumber: '4-156-1',
    });

    await manager.refresh(row({ vendorBoxNumber: '4-156-9' }));

    expect(repo.saveVendorBox).not.toHaveBeenCalled();
  });

  it('still writes the invoice when saving the vendor box fails', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 80,
      jobstat: null,
      carrierCode: 156,
      trackingNumber: '1234',
      boxNumber: '4-156-1',
    });
    repo.saveVendorBox.mockRejectedValue(new Error('db down'));

    await manager.refresh(row());

    expect(repo.updateTracked).toHaveBeenCalledTimes(1);
  });

  it('treats a row that left tracking (cancel flow changed it) as a no-op', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 80,
      jobstat: null,
      carrierCode: 109,
      trackingNumber: '1234567890',
      boxNumber: null,
    });
    repo.updateTracked.mockResolvedValue(false);
    await expect(manager.refresh(row())).resolves.toBeUndefined();
    expect(repo.updateTracked).toHaveBeenCalledTimes(1);
  });

  it('keeps tracking number with null carrier for unknown dlvyno', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 84,
      jobstat: null,
      carrierCode: 999,
      trackingNumber: '777',
      boxNumber: null,
    });

    await manager.refresh(row());

    expect(repo.updateTracked).toHaveBeenCalledWith(
      'po-1',
      expect.objectContaining({ status: 'shipped', carrier: null, trackingNumber: '777' }),
    );
  });

  it('marks delivered when ordstat is 85', async () => {
    const { repo, wowpress, manager } = setup();
    const shippedAt = new Date('2026-10-10T00:00:00Z');
    wowpress.detail.mockResolvedValue({
      ordstat: 85,
      jobstat: null,
      carrierCode: 156,
      trackingNumber: '555',
      boxNumber: null,
    });

    await manager.refresh(row({ status: 'shipped', carrier: 'CJ', trackingNumber: '555', shippedAt }));

    const patch = repo.updateTracked.mock.calls[0]?.[1];
    expect(patch).toMatchObject({ status: 'delivered', carrier: 'CJ', trackingNumber: '555', shippedAt });
    expect(patch?.deliveredAt).toBeInstanceOf(Date);
  });

  it('overwrites back to shipped when wowpress reverts the state', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 84,
      jobstat: null,
      carrierCode: 156,
      trackingNumber: '555',
      boxNumber: null,
    });

    await manager.refresh(
      row({
        status: 'delivered',
        carrier: 'CJ',
        trackingNumber: '555',
        shippedAt: new Date(),
        deliveredAt: new Date(),
      }),
    );

    expect(repo.updateTracked).toHaveBeenCalledWith(
      'po-1',
      expect.objectContaining({ status: 'shipped', deliveredAt: null }),
    );
  });

  it('does not write when nothing changed or no invoice yet', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 20,
      jobstat: null,
      carrierCode: null,
      trackingNumber: null,
      boxNumber: null,
    });
    await manager.refresh(row());
    wowpress.detail.mockResolvedValue({
      ordstat: 80,
      jobstat: null,
      carrierCode: 109,
      trackingNumber: '1',
      boxNumber: null,
    });
    await manager.refresh(row({ status: 'shipped', carrier: 'LOTTE', trackingNumber: '1', shippedAt: new Date() }));
    expect(repo.updateTracked).not.toHaveBeenCalled();
    expect(repo.touch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last known tracking when a later poll shows no invoice and is not delivered', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 80,
      jobstat: null,
      carrierCode: null,
      trackingNumber: null,
      boxNumber: null,
    });

    await manager.refresh(row({ status: 'shipped', carrier: 'CJ', trackingNumber: '555', shippedAt: new Date() }));

    expect(repo.updateTracked).not.toHaveBeenCalled();
  });

  it('logs and keeps the status when the poll fails', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockRejectedValue(new Error('timeout'));

    await expect(manager.refresh(row())).resolves.toBeUndefined();
    expect(repo.updateTracked).not.toHaveBeenCalled();
    expect(repo.touch).toHaveBeenCalledWith('po-1');
  });
});

describe('PrintOrderTrackingWorker', () => {
  it('makes no wowpress call when no row qualifies', async () => {
    const { repo, wowpress, manager } = setup();
    await new PrintOrderTrackingWorker(repo, manager).runOnce();
    expect(wowpress.detail).not.toHaveBeenCalled();
  });

  it('rotates through all rows when there are more than the batch limit', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.detail.mockResolvedValue({
      ordstat: 20,
      jobstat: null,
      carrierCode: null,
      trackingNumber: null,
      boxNumber: null,
    });
    let clock = 0;
    const rows = Array.from({ length: PRINT_ORDER_TRACK_LIMIT + 1 }, (_, i) =>
      row({ id: `r${i}`, vendorOrderNumber: `WP-${i}`, updatedAt: new Date(i) }),
    );
    repo.trackable.mockImplementation((limit) =>
      Promise.resolve([...rows].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime()).slice(0, limit)),
    );
    repo.touch.mockImplementation((id) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.updatedAt = new Date(1_000_000 + clock++);
      return Promise.resolve();
    });
    const worker = new PrintOrderTrackingWorker(repo, manager);

    await worker.runOnce();
    await worker.runOnce();

    const polled = new Set(wowpress.detail.mock.calls.map((c) => c[0]));
    expect(polled.size).toBe(PRINT_ORDER_TRACK_LIMIT + 1);
  });

  it('a batch full of failing polls does not starve a healthy row behind it', async () => {
    const { repo, wowpress, manager } = setup();
    let clock = 0;
    const failing = Array.from({ length: PRINT_ORDER_TRACK_LIMIT }, (_, i) =>
      row({ id: `f${i}`, vendorOrderNumber: `WP-F${i}`, updatedAt: new Date(i) }),
    );
    const healthy = row({ id: 'ok', vendorOrderNumber: 'WP-OK', updatedAt: new Date(PRINT_ORDER_TRACK_LIMIT) });
    const rows = [...failing, healthy];
    wowpress.detail.mockImplementation((ordnum) =>
      ordnum === 'WP-OK'
        ? Promise.resolve({ ordstat: 20, jobstat: null, carrierCode: null, trackingNumber: null, boxNumber: null })
        : Promise.reject(new Error('wowpress 500')),
    );
    repo.trackable.mockImplementation((limit) =>
      Promise.resolve([...rows].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime()).slice(0, limit)),
    );
    repo.touch.mockImplementation((id) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.updatedAt = new Date(1_000_000 + clock++);
      return Promise.resolve();
    });
    const worker = new PrintOrderTrackingWorker(repo, manager);

    await worker.runOnce();
    await worker.runOnce();

    expect(wowpress.detail).toHaveBeenCalledWith('WP-OK');
    expect(rows.every((r) => r.status === 'submitted')).toBe(true);
  });

  it('continues the batch when one row throws', async () => {
    const { repo, manager } = setup();
    repo.trackable.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' })]);
    const refresh = jest
      .spyOn(manager, 'refresh')
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);

    await new PrintOrderTrackingWorker(repo, manager).runOnce();

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
