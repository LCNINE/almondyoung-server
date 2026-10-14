import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import {
  UgcAlmondDesignClient,
  type UgcAlmondDesignInfo,
  type UgcPrintLink,
} from '../clients/ugc-almond-design.client';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WowpressClient } from '../wowpress/wowpress.client';
import { type WowpressLineSpec, type WowpressOrderInput, type WowpressTransport } from '../wowpress/wowpress.types';
import { PrintOrderSubmitWorker } from '../workers/print-order-submit.worker';
import {
  PrintOrderRepository,
  isPreservedLastError,
  lateOrdnumError,
  mergeLastError,
  type PrintOrderLineContext,
} from './print-order.repository';
import {
  DESIGN_OWNER_MISMATCH_ERROR,
  ORDER_LOOKUP_DELAY_MS,
  ORDER_LOOKUP_PENDING_ERROR,
  ORDER_UNCONFIRMED_ERROR,
  PRINT_ORDER_MAX_ATTEMPTS,
  PRINT_ORDER_STALE_MS,
  PrintOrderSubmitManager,
  unsavedOrdnumError,
} from './print-order-submit.manager';

const CONFIRMED_VARIANT = '0190f1d2-0000-7000-8000-00000000a001';
const DRAFT_VARIANT = '0190f1d2-0000-7000-8000-00000000a002';
const UNKNOWN_VARIANT = '0190f1d2-0000-7000-8000-00000000a003';
const LINE_ID = '0190f1d2-0000-7000-8000-00000000b001';
const DESIGN_ID = '0190f1d2-0000-7000-8000-00000000c001';
const CUSTOMER_ID = '0190f1d2-0000-7000-8000-00000000d001';
const ATTEMPTED = new Date('2020-01-01T00:00:01Z');
const TEST_MEMO = '테스트 시안입니다. 혹시 이 시안대로 출력이 되나요?';

function mockSpec(confirmed: boolean): WowpressLineSpec {
  return {
    prodno: 40001,
    jobpresetno: '1',
    prsjob: [{ jobno: 1 }],
    awkjob: [],
    qtyPerUnit: 100,
    file: { format: 'jpg', dpi: 350 },
    confirmed,
  };
}

jest.mock('../wowpress/wowpress-products', () => ({
  WOWPRESS_PRODUCTS: {
    '0190f1d2-0000-7000-8000-00000000a001': mockSpec(true),
    '0190f1d2-0000-7000-8000-00000000a002': mockSpec(false),
  },
}));

const noNetwork: WowpressTransport = () => Promise.reject(new Error('real wowpress call in test'));

class FakeWowpress extends WowpressClient {
  quote = jest.fn<Promise<void>, [WowpressLineSpec, number]>(() => Promise.resolve());
  order = jest.fn<Promise<{ ordnum: string }>, [WowpressOrderInput]>(() => Promise.resolve({ ordnum: this.ordnum }));
  uploadFileUrl = jest.fn<Promise<void>, [string, string, string]>(() => Promise.resolve());
  findByOrdkey = jest.fn<Promise<{ ordnum: string } | null>, [string, Date]>(() => Promise.resolve(null));
  constructor(private readonly ordnum = 'W-1') {
    super(new ConfigService({}), noNetwork);
  }
}

class FakeUgc extends UgcAlmondDesignClient {
  design = jest.fn<Promise<UgcAlmondDesignInfo>, [string]>(() =>
    Promise.resolve({ userId: CUSTOMER_ID, productId: 'p', widthMm: 90, heightMm: 50, hasBack: false }),
  );
  printLink = jest.fn<Promise<UgcPrintLink>, [string, 'jpg' | 'pdf' | 'eps', number]>(() =>
    Promise.resolve({ url: 'https://s3/print.jpg', fileName: 'print.jpg' }),
  );
  constructor() {
    super(new ConfigService({}));
  }
}

// 메서드를 전부 덮어써 DB 를 쓰지 않는 가짜라 DbService 자리는 형 변환으로 채운다
const unusedDb = {} as unknown as DbService<typeof wmsSchema>;

// 조건부 쓰기의 WHERE 를 그대로 흉내 내는 메모리 저장소
class FakeRepo extends PrintOrderRepository {
  rows = new Map<string, PrintOrderRow>();
  context: PrintOrderLineContext | null = null;
  constructor() {
    super(unusedDb);
  }
  findLineContext = jest.fn<Promise<PrintOrderLineContext | null>, [string]>(() => Promise.resolve(this.context));
  update = jest.fn((id: string, patch: Partial<PrintOrderRow>) => {
    this.patch(id, () => true, patch);
    return Promise.resolve();
  });
  recordFailure = jest.fn((id: string, lastError: string) => {
    const cur = this.rows.get(id);
    const status = cur?.status;
    const reopens =
      status === 'cancelled' && isPreservedLastError(lastError) && !(cur?.lastError ?? '').includes(lastError);
    if (reopens) {
      return this.update(id, {
        status: 'cancel_refused',
        cancelRefusedAt: new Date(),
        cancelResolvedAt: null,
        cancelResolvedBy: null,
        lastError,
      });
    }
    const keep = status === 'cancelling' || status === 'cancelled' || status === 'cancel_refused';
    return this.update(id, keep ? { lastError } : { status: 'failed', lastError });
  });
  updateOwned = jest.fn((id: string, claimedAt: Date, patch: Partial<PrintOrderRow>) =>
    Promise.resolve(this.patch(id, (r) => this.owns(r, claimedAt), patch)),
  );
  takeOrderRight = jest.fn((id: string, claimedAt: Date, patch: Partial<PrintOrderRow>) =>
    Promise.resolve(
      this.patch(
        id,
        (r) =>
          this.owns(r, claimedAt) &&
          r.orderAttemptedAt === null &&
          r.vendorOrderNumber === null &&
          !isPreservedLastError(r.lastError),
        {
          ...patch,
          orderAttemptedAt: new Date(),
        },
      ),
    ),
  );
  flagLateOrdnum = jest.fn((id: string, ordnum: string) => {
    const cur = this.rows.get(id);
    if (!cur || !['cancelling', 'cancelled', 'cancel_refused'].includes(cur.status)) return Promise.resolve(false);
    const lastError = mergeLastError(cur.lastError, lateOrdnumError(ordnum));
    const fresh = !(cur.lastError ?? '').includes(lateOrdnumError(ordnum));
    this.rows.set(id, {
      ...cur,
      lastError,
      status: cur.status === 'cancelling' ? 'cancelling' : 'cancel_refused',
      cancelRefusedAt: new Date(),
      ...(fresh ? { cancelResolvedAt: null, cancelResolvedBy: null } : {}),
    });
    return Promise.resolve(true);
  });
  findVendorOrderNumber = jest.fn((id: string) => Promise.resolve(this.rows.get(id)?.vendorOrderNumber ?? null));
  saveVendorOrderNumber = jest.fn((id: string, vendorOrderNumber: string) =>
    Promise.resolve(this.patch(id, (r) => r.vendorOrderNumber === null, { vendorOrderNumber })),
  );
  updateStale = jest.fn((id: string, olderThan: Date, patch: Partial<PrintOrderRow>) =>
    Promise.resolve(this.patch(id, (r) => this.isStale(r, olderThan), patch)),
  );
  claimDue = jest.fn((limit: number, now: Date) => {
    const due = [...this.rows.values()]
      .filter((r) => r.status === 'pending' && r.nextAttemptAt.getTime() <= now.getTime())
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .slice(0, limit);
    return Promise.resolve(
      due.map((r) => {
        this.patch(r.id, () => true, { status: 'submitting', submittingAt: now });
        return this.get(r.id);
      }),
    );
  });
  staleSubmitting = jest.fn((olderThan: Date) =>
    Promise.resolve([...this.rows.values()].filter((r) => this.isStale(r, olderThan))),
  );
  get(id: string): PrintOrderRow {
    const r = this.rows.get(id);
    if (!r) throw new Error(`no row ${id}`);
    return { ...r };
  }
  claim(id: string): PrintOrderRow {
    this.patch(id, () => true, { status: 'submitting', submittingAt: new Date() });
    return this.get(id);
  }
  private owns(r: PrintOrderRow, claimedAt: Date): boolean {
    return r.status === 'submitting' && r.submittingAt?.getTime() === claimedAt.getTime();
  }
  private isStale(r: PrintOrderRow, olderThan: Date): boolean {
    return r.status === 'submitting' && r.submittingAt !== null && r.submittingAt.getTime() < olderThan.getTime();
  }
  private patch(id: string, when: (r: PrintOrderRow) => boolean, patch: Partial<PrintOrderRow>): boolean {
    const cur = this.rows.get(id);
    if (!cur || !when(cur)) return false;
    const lastError = patch.lastError === undefined ? cur.lastError : mergeLastError(cur.lastError, patch.lastError);
    this.rows.set(id, { ...cur, ...patch, lastError });
    return true;
  }
}

// 다음 차례에 워커가 pending 행을 다시 선점한 상태
function reclaim(repo: FakeRepo): PrintOrderRow {
  const row = { ...repo.get('po-1'), status: 'submitting' as const, submittingAt: new Date() };
  repo.rows.set(row.id, row);
  return row;
}

function makeRow(overrides: Partial<PrintOrderRow> = {}): PrintOrderRow {
  const now = new Date('2020-01-01T00:00:00Z');
  return {
    id: 'po-1',
    salesOrderId: 'so-1',
    salesOrderLineId: LINE_ID,
    almondDesignId: DESIGN_ID,
    vendor: 'wowpress',
    status: 'submitting',
    testMemo: false,
    vendorOrderNumber: null,
    attemptCount: 0,
    lastError: null,
    nextAttemptAt: now,
    submittingAt: now,
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function context(variantId: string): PrintOrderLineContext {
  return {
    line: { id: LINE_ID, variantId, quantity: 2 },
    order: {
      channelOrderId: 'order_01J',
      customerId: CUSTOMER_ID,
      shippingAddress: {
        recipientName: '홍길동',
        phone: '010-1234-5678',
        postalCode: '06236',
        roadAddress: '서울특별시 강남구 테헤란로 123',
        detailAddress: '4층',
      },
    },
  };
}

function setup(variantId: string, row: PrintOrderRow = makeRow()) {
  const repo = new FakeRepo();
  repo.rows.set(row.id, row);
  repo.context = context(variantId);
  const wowpress = new FakeWowpress();
  const ugc = new FakeUgc();
  const manager = new PrintOrderSubmitManager(repo, wowpress, ugc);
  return { repo, wowpress, ugc, manager };
}

describe('PrintOrderSubmitManager', () => {
  it('submits a confirmed spec without memo and marks submitted', async () => {
    const { repo, wowpress, ugc, manager } = setup(CONFIRMED_VARIANT);

    await manager.submit(repo.get('po-1'));

    expect(ugc.design).toHaveBeenCalledWith(DESIGN_ID);
    expect(ugc.printLink).toHaveBeenCalledWith(DESIGN_ID, 'jpg', 350);
    expect(wowpress.quote).toHaveBeenCalledWith(mockSpec(true), 2);
    expect(wowpress.order).toHaveBeenCalledWith({
      spec: mockSpec(true),
      qty: 2,
      ordtitle: '아몬드영 order_01J',
      ordbody: '',
      ordkey: LINE_ID,
      receiver: {
        name: '홍길동',
        tel: '010-1234-5678',
        zipcode: '06236',
        addr1: '서울특별시 강남구 테헤란로 123',
        addr2: '4층',
        dlvymsg: '',
      },
    });
    expect(wowpress.uploadFileUrl).toHaveBeenCalledWith('W-1', 'print.jpg', 'https://s3/print.jpg');
    expect(repo.get('po-1')).toMatchObject({ status: 'submitted', vendorOrderNumber: 'W-1', testMemo: false });
  });

  it('adds the test memo when spec.confirmed is false and sets testMemo', async () => {
    const { repo, wowpress, manager } = setup(DRAFT_VARIANT);

    await manager.submit(repo.get('po-1'));

    expect(wowpress.order.mock.calls[0]?.[0].ordbody).toBe(TEST_MEMO);
    expect(repo.get('po-1')).toMatchObject({ status: 'submitted', testMemo: true });
  });

  it('fails without ordering when the design belongs to another customer', async () => {
    const { repo, wowpress, ugc, manager } = setup(CONFIRMED_VARIANT);
    ugc.design.mockResolvedValue({ userId: 'someone-else', productId: 'p', widthMm: 90, heightMm: 50, hasBack: false });

    await manager.submit(repo.get('po-1'));

    expect(repo.get('po-1').status).toBe('failed');
    expect(repo.get('po-1').lastError).toBe(DESIGN_OWNER_MISMATCH_ERROR);
    expect(repo.get('po-1').orderAttemptedAt).toBeNull();
    expect(ugc.printLink).not.toHaveBeenCalled();
    expect(wowpress.order).not.toHaveBeenCalled();
  });

  it('marks unsupported without calling wowpress when no spec for the variant', async () => {
    const { repo, wowpress, ugc, manager } = setup(UNKNOWN_VARIANT);

    await manager.submit(repo.get('po-1'));

    expect(repo.get('po-1').status).toBe('unsupported');
    expect(ugc.printLink).not.toHaveBeenCalled();
    expect(wowpress.quote).not.toHaveBeenCalled();
    expect(wowpress.order).not.toHaveBeenCalled();
  });

  it('persists the ordnum before uploading the file', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    let ordnumAtUpload: string | null = null;
    wowpress.uploadFileUrl.mockImplementation(() => {
      ordnumAtUpload = repo.get('po-1').vendorOrderNumber;
      return Promise.reject(new Error('crash'));
    });

    await manager.submit(repo.get('po-1'));

    expect(ordnumAtUpload).toBe('W-1');
  });

  describe('order response arriving after a cancel took the row', () => {
    function cancelDuringOrder(repo: FakeRepo, wowpress: FakeWowpress, patch: Partial<PrintOrderRow>) {
      wowpress.order.mockImplementationOnce(() => {
        repo.rows.set('po-1', { ...repo.get('po-1'), ...patch });
        return Promise.resolve({ ordnum: 'W-LATE' });
      });
    }

    it('records the live order, raises it to cancel_refused and never uploads the file', async () => {
      const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
      cancelDuringOrder(repo, wowpress, {
        status: 'cancel_refused',
        lastError: 'cancelled on channel while submitting',
      });

      await manager.submit(repo.get('po-1'));

      expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
      expect(repo.get('po-1')).toMatchObject({
        status: 'cancel_refused',
        vendorOrderNumber: 'W-LATE',
        lastError: lateOrdnumError('W-LATE'),
      });
      expect(isPreservedLastError(repo.get('po-1').lastError)).toBe(true);
    });

    it('takes back an operator resolution: cancelled + resolved goes back to cancel_refused', async () => {
      const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
      cancelDuringOrder(repo, wowpress, {
        status: 'cancelled',
        cancelResolvedAt: new Date(),
        cancelResolvedBy: 'op-1',
      });

      await manager.submit(repo.get('po-1'));

      expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
      expect(repo.get('po-1')).toMatchObject({
        status: 'cancel_refused',
        cancelResolvedAt: null,
        cancelResolvedBy: null,
      });
    });

    it('leaves a cancelling row as cancelling but records the late order', async () => {
      const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
      cancelDuringOrder(repo, wowpress, { status: 'cancelling' });

      await manager.submit(repo.get('po-1'));

      expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
      expect(repo.get('po-1')).toMatchObject({ status: 'cancelling', lastError: lateOrdnumError('W-LATE') });
    });

    it('does the same when stale recovery finds the order after a cancel', async () => {
      const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
      wowpress.findByOrdkey.mockImplementationOnce(() => {
        repo.rows.set('po-1', { ...repo.get('po-1'), status: 'cancel_refused' });
        return Promise.resolve({ ordnum: 'W-9' });
      });

      await manager.recoverStale(repo.get('po-1'));

      expect(repo.get('po-1')).toMatchObject({ status: 'cancel_refused', lastError: lateOrdnumError('W-9') });
    });
  });

  it('never takes the order right on a row carrying a protected record', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ lastError: lateOrdnumError('W-0') }));

    await manager.submit(repo.get('po-1'));

    expect(wowpress.order).not.toHaveBeenCalled();
  });

  it('keeps ordnum and retries only the file upload when upload fails', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.uploadFileUrl.mockRejectedValueOnce(new Error('upload down'));

    await manager.submit(repo.get('po-1'));
    expect(repo.get('po-1')).toMatchObject({
      status: 'pending',
      vendorOrderNumber: 'W-1',
      attemptCount: 1,
      lastError: 'upload down',
    });

    await manager.submit(repo.claim('po-1'));

    expect(wowpress.order).toHaveBeenCalledTimes(1);
    expect(wowpress.quote).toHaveBeenCalledTimes(1);
    expect(wowpress.findByOrdkey).not.toHaveBeenCalled();
    expect(wowpress.uploadFileUrl).toHaveBeenCalledTimes(2);
    expect(repo.get('po-1')).toMatchObject({ status: 'submitted', vendorOrderNumber: 'W-1' });
  });

  it('schedules retries with exponential delay', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.quote.mockRejectedValue(new Error('quote down'));
    const before = Date.now();

    await manager.submit(repo.get('po-1'));

    const row = repo.get('po-1');
    expect(row).toMatchObject({ status: 'pending', attemptCount: 1 });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 2 * 60_000);
  });

  it('fails after 3 attempts', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.quote.mockRejectedValue(new Error('quote down'));

    for (let i = 0; i < PRINT_ORDER_MAX_ATTEMPTS; i++) {
      await manager.submit(repo.claim('po-1'));
    }

    expect(repo.get('po-1')).toMatchObject({ status: 'failed', attemptCount: 3, lastError: 'quote down' });
    expect(wowpress.order).not.toHaveBeenCalled();
  });

  it('takes the order right once and orders once on the first attempt', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);

    await manager.submit(repo.get('po-1'));

    expect(wowpress.order).toHaveBeenCalledTimes(1);
    expect(repo.takeOrderRight).toHaveBeenCalledTimes(1);
    expect(repo.get('po-1').orderAttemptedAt).not.toBeNull();
  });

  it('defers a lookup instead of failing when order() throws after the right was taken', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.order.mockRejectedValueOnce(new Error('timeout'));

    await manager.submit(repo.get('po-1'));

    const row = repo.get('po-1');
    expect(row).toMatchObject({ status: 'pending', lastError: ORDER_LOOKUP_PENDING_ERROR, vendorOrderNumber: null });
    expect(row.orderAttemptedAt).not.toBeNull();
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + ORDER_LOOKUP_DELAY_MS - 60_000);
    expect(wowpress.order).toHaveBeenCalledTimes(1);
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it('continues with the file when the deferred lookup finds the lost order', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.order.mockRejectedValueOnce(new Error('timeout'));
    await manager.submit(repo.get('po-1'));

    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-LATE' });
    await manager.submit(reclaim(repo));

    expect(wowpress.order).toHaveBeenCalledTimes(1);
    expect(wowpress.uploadFileUrl).toHaveBeenCalledWith('W-LATE', 'print.jpg', 'https://s3/print.jpg');
    expect(repo.get('po-1')).toMatchObject({ status: 'submitted', vendorOrderNumber: 'W-LATE' });
  });

  it('hands the row to the operator when the deferred lookup still finds nothing', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.order.mockRejectedValueOnce(new Error('timeout'));
    await manager.submit(repo.get('po-1'));

    await manager.submit(reclaim(repo));

    expect(wowpress.order).toHaveBeenCalledTimes(1);
    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: ORDER_UNCONFIRMED_ERROR });
  });

  it('confirms a sent order via ordkey on a later run instead of ordering again', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-LOST' });

    await manager.submit(repo.get('po-1'));

    expect(wowpress.findByOrdkey).toHaveBeenCalledWith(LINE_ID, repo.get('po-1').createdAt);
    expect(wowpress.order).not.toHaveBeenCalled();
    expect(wowpress.uploadFileUrl).toHaveBeenCalledWith('W-LOST', 'print.jpg', 'https://s3/print.jpg');
    expect(repo.get('po-1')).toMatchObject({ status: 'submitted', vendorOrderNumber: 'W-LOST' });
  });

  it('marks failed without ordering when the right was taken and ordkey is not found', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));

    await manager.submit(repo.get('po-1'));

    expect(wowpress.order).not.toHaveBeenCalled();
    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: ORDER_UNCONFIRMED_ERROR });
  });

  it('marks failed without ordering when the right was taken and the lookup throws', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    wowpress.findByOrdkey.mockRejectedValueOnce(new Error('ordnum missing for matching ordkey'));

    await manager.submit(repo.get('po-1'));

    expect(wowpress.order).not.toHaveBeenCalled();
    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: ORDER_UNCONFIRMED_ERROR });
  });

  it('recovers a stale submitting row via ordkey instead of ordering again', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-9' });

    await manager.recoverStale(repo.get('po-1'));

    expect(wowpress.findByOrdkey).toHaveBeenCalledWith(LINE_ID, repo.get('po-1').createdAt);
    expect(wowpress.order).not.toHaveBeenCalled();
    expect(repo.get('po-1')).toMatchObject({ status: 'pending', vendorOrderNumber: 'W-9' });

    await manager.submit(repo.claim('po-1'));
    expect(wowpress.order).not.toHaveBeenCalled();
    expect(wowpress.uploadFileUrl).toHaveBeenCalledWith('W-9', 'print.jpg', 'https://s3/print.jpg');
    expect(repo.get('po-1').status).toBe('submitted');
  });

  it('returns a stale row with an ordnum to pending without asking wowpress', async () => {
    const { repo, wowpress, manager } = setup(
      CONFIRMED_VARIANT,
      makeRow({ vendorOrderNumber: 'W-2', orderAttemptedAt: ATTEMPTED }),
    );

    await manager.recoverStale(repo.get('po-1'));

    expect(wowpress.findByOrdkey).not.toHaveBeenCalled();
    expect(repo.get('po-1')).toMatchObject({ status: 'pending', vendorOrderNumber: 'W-2' });
  });

  it('returns a stale row that never took the order right to pending without asking wowpress', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);

    await manager.recoverStale(repo.get('po-1'));

    expect(wowpress.findByOrdkey).not.toHaveBeenCalled();
    expect(repo.get('po-1')).toMatchObject({ status: 'pending', vendorOrderNumber: null, attemptCount: 0 });
  });

  it.each([
    ['not found', () => Promise.resolve(null)],
    ['lookup throws', () => Promise.reject(new Error('ordnum missing for matching ordkey'))],
  ])('marks a stale row with a taken right failed when ordkey is %s', async (_label, lookup) => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    wowpress.findByOrdkey.mockImplementationOnce(lookup);

    await manager.recoverStale(repo.get('po-1'));

    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: ORDER_UNCONFIRMED_ERROR });
    expect(wowpress.order).not.toHaveBeenCalled();
  });
});

describe('ownership of a claimed row', () => {
  it('records a suspected duplicate and stops when another run already stored an ordnum', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.order.mockImplementationOnce(() => {
      repo.rows.set('po-1', { ...repo.get('po-1'), vendorOrderNumber: 'W-OTHER' });
      return Promise.resolve({ ordnum: 'W-1' });
    });

    await manager.submit(repo.get('po-1'));

    expect(repo.get('po-1')).toMatchObject({
      status: 'failed',
      vendorOrderNumber: 'W-OTHER',
      lastError: 'duplicate wowpress order suspected: W-OTHER / W-1',
    });
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it.each(['cancelling', 'cancel_refused'] as const)(
    'records a late duplicate on a %s row without changing its status',
    async (status) => {
      const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
      wowpress.order.mockImplementationOnce(() => {
        repo.rows.set('po-1', { ...repo.get('po-1'), status, vendorOrderNumber: 'W-OTHER' });
        return Promise.resolve({ ordnum: 'W-1' });
      });

      await manager.submit(repo.get('po-1'));

      expect(repo.get('po-1')).toMatchObject({
        status,
        lastError: 'duplicate wowpress order suspected: W-OTHER / W-1',
      });
    },
  );

  it('reopens a cancelled row as cancel_refused when a late different ordnum arrives', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.order.mockImplementationOnce(() => {
      repo.rows.set('po-1', {
        ...repo.get('po-1'),
        status: 'cancelled',
        vendorOrderNumber: 'W-OTHER',
        cancelResolvedAt: new Date(),
        cancelResolvedBy: 'admin-1',
      });
      return Promise.resolve({ ordnum: 'W-1' });
    });

    await manager.submit(repo.get('po-1'));

    expect(repo.get('po-1')).toMatchObject({
      status: 'cancel_refused',
      lastError: 'duplicate wowpress order suspected: W-OTHER / W-1',
      cancelResolvedAt: null,
    });
    expect(repo.get('po-1').cancelRefusedAt).toBeInstanceOf(Date);
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it('keeps both ordnums after a submit-path conflict through stale recovery and later failures', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.order.mockImplementationOnce(() => {
      repo.rows.set('po-1', { ...repo.get('po-1'), vendorOrderNumber: 'W-OTHER' });
      return Promise.resolve({ ordnum: 'W-1' });
    });
    await manager.submit(repo.get('po-1'));
    const duplicate = 'duplicate wowpress order suspected: W-OTHER / W-1';

    expect(await repo.staleSubmitting(new Date(Date.now() + PRINT_ORDER_STALE_MS * 2))).toEqual([]);
    await manager.recoverStale(repo.get('po-1'));
    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: duplicate });

    repo.rows.set('po-1', { ...repo.get('po-1'), status: 'pending' });
    wowpress.uploadFileUrl.mockRejectedValueOnce(new Error('upload down'));
    await manager.submit(repo.claim('po-1'));

    expect(repo.get('po-1').lastError).toBe(duplicate);
    expect(wowpress.order).toHaveBeenCalledTimes(1);
  });

  it('logs the ordnum and records it in lastError when saving it throws', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    const logs: string[] = [];
    const capture = (message: unknown) => {
      logs.push(String(message));
    };
    const spies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(capture),
    ];
    repo.saveVendorOrderNumber.mockRejectedValueOnce(new Error('db down'));

    await manager.submit(repo.get('po-1'));
    spies.forEach((spy) => spy.mockRestore());

    expect(wowpress.order).toHaveBeenCalledTimes(1);
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes('W-1') && line.includes(LINE_ID))).toBe(true);
    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: unsavedOrdnumError('W-1') });
    expect(repo.get('po-1').lastError).toContain('W-1');
  });

  it('leaves the ordnum in the log when recording the unsaved ordnum also fails', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    const logs: string[] = [];
    const capture = (message: unknown) => {
      logs.push(String(message));
    };
    const spies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(capture),
    ];
    repo.saveVendorOrderNumber.mockRejectedValueOnce(new Error('db down'));
    repo.update.mockRejectedValueOnce(new Error('db still down'));

    await expect(manager.submit(repo.get('po-1'))).resolves.toBeUndefined();
    spies.forEach((spy) => spy.mockRestore());

    expect(wowpress.order).toHaveBeenCalledTimes(1);
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
    expect(logs.filter((line) => line.includes('W-1')).length).toBeGreaterThanOrEqual(2);
  });

  it('never lets a later lastError overwrite a duplicate or unsaved-ordnum record', () => {
    const duplicate = 'duplicate wowpress order suspected: W-A / W-B';
    expect(mergeLastError(duplicate, 'upload down')).toBe(duplicate);
    expect(mergeLastError(duplicate, ORDER_UNCONFIRMED_ERROR)).toBe(duplicate);
    expect(mergeLastError(duplicate, null)).toBe(duplicate);
    expect(mergeLastError(unsavedOrdnumError('W-A'), 'upload down')).toBe(unsavedOrdnumError('W-A'));
    expect(mergeLastError(unsavedOrdnumError('W-A'), duplicate)).toBe(`${unsavedOrdnumError('W-A')} | ${duplicate}`);
    expect(mergeLastError(duplicate, duplicate)).toBe(duplicate);
    expect(mergeLastError('upload down', 'quote down')).toBe('quote down');
    expect(mergeLastError(null, 'quote down')).toBe('quote down');
  });

  it('stops without ordering when the row was reclaimed before order()', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT);
    wowpress.quote.mockImplementationOnce(() => {
      repo.rows.set('po-1', { ...repo.get('po-1'), submittingAt: new Date('2021-01-01T00:00:00Z') });
      return Promise.resolve();
    });

    await manager.submit(repo.get('po-1'));

    expect(wowpress.order).not.toHaveBeenCalled();
    expect(repo.get('po-1')).toMatchObject({ status: 'submitting', attemptCount: 0 });
  });

  it('does not overwrite a stored ordnum with one recovered by ordkey on a retry', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    const view = repo.claim('po-1');
    repo.rows.set('po-1', { ...repo.get('po-1'), vendorOrderNumber: 'W-OTHER' });
    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-LOST' });

    await manager.submit(view);

    expect(repo.get('po-1')).toMatchObject({
      status: 'failed',
      vendorOrderNumber: 'W-OTHER',
      lastError: 'duplicate wowpress order suspected: W-OTHER / W-LOST',
    });
    expect(wowpress.order).not.toHaveBeenCalled();
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it('continues when the recovered ordnum equals the stored one', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    const view = repo.claim('po-1');
    repo.rows.set('po-1', { ...repo.get('po-1'), vendorOrderNumber: 'W-LOST' });
    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-LOST' });

    await manager.submit(view);

    expect(wowpress.uploadFileUrl).toHaveBeenCalledWith('W-LOST', 'print.jpg', 'https://s3/print.jpg');
    expect(repo.get('po-1')).toMatchObject({ status: 'submitted', vendorOrderNumber: 'W-LOST', lastError: null });
  });

  it('fails a stale row on an ordnum conflict and never uploads', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    const staleView = repo.get('po-1');
    repo.rows.set('po-1', { ...repo.get('po-1'), vendorOrderNumber: 'W-OTHER' });
    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-9' });

    await manager.recoverStale(staleView);

    expect(repo.get('po-1')).toMatchObject({
      status: 'failed',
      vendorOrderNumber: 'W-OTHER',
      lastError: 'duplicate wowpress order suspected: W-OTHER / W-9',
    });
    expect(await repo.claimDue(1, new Date())).toEqual([]);
    expect(wowpress.order).not.toHaveBeenCalled();
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it('does not let stale recovery take a row that was re-stamped', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    const staleView = repo.get('po-1');
    repo.claim('po-1');
    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-9' });

    await manager.recoverStale(staleView);

    expect(repo.get('po-1').status).toBe('submitting');
  });
});

describe('an ordnum recovered by ordkey is never lost', () => {
  function captureLogs() {
    const logs: string[] = [];
    const capture = (message: unknown) => {
      logs.push(String(message));
    };
    const spies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(capture),
    ];
    return { logs, restore: () => spies.forEach((spy) => spy.mockRestore()) };
  }

  it('marks failed with the number when saving a submit-lookup ordnum throws', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-LOST' });
    repo.saveVendorOrderNumber.mockRejectedValueOnce(new Error('db down'));
    const { logs, restore } = captureLogs();

    await manager.submit(repo.claim('po-1'));
    restore();

    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: unsavedOrdnumError('W-LOST') });
    expect(logs.some((line) => line.includes('W-LOST') && line.includes(LINE_ID))).toBe(true);
    expect(wowpress.order).not.toHaveBeenCalled();
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it('marks failed with the number when saving a stale-lookup ordnum throws', async () => {
    const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
    wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-LOST' });
    repo.saveVendorOrderNumber.mockRejectedValueOnce(new Error('db down'));
    const { logs, restore } = captureLogs();

    await manager.recoverStale(repo.get('po-1'));
    restore();

    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: unsavedOrdnumError('W-LOST') });
    expect(logs.some((line) => line.includes('W-LOST') && line.includes(LINE_ID))).toBe(true);
    expect(await repo.claimDue(1, new Date())).toEqual([]);
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it.each(['submit', 'stale'] as const)(
    'logs both numbers and never uploads when recording a %s-lookup conflict throws',
    async (path) => {
      const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ orderAttemptedAt: ATTEMPTED }));
      const view = path === 'submit' ? repo.claim('po-1') : repo.get('po-1');
      repo.rows.set('po-1', { ...repo.get('po-1'), vendorOrderNumber: 'W-OTHER' });
      wowpress.findByOrdkey.mockResolvedValueOnce({ ordnum: 'W-LOST' });
      repo.update.mockRejectedValue(new Error('db down'));
      const { logs, restore } = captureLogs();

      if (path === 'submit') await manager.submit(view);
      else await manager.recoverStale(view);
      restore();

      expect(logs.some((line) => line.includes('W-OTHER') && line.includes('W-LOST'))).toBe(true);
      expect(repo.get('po-1').status).not.toBe('pending');
      expect(await repo.claimDue(1, new Date())).toEqual([]);
      expect(wowpress.order).not.toHaveBeenCalled();
      expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
    },
  );

  it('ends a stale row that took the order right in failed when recovery throws', async () => {
    const { repo, wowpress, manager } = setup(
      CONFIRMED_VARIANT,
      makeRow({ orderAttemptedAt: ATTEMPTED, vendorOrderNumber: 'W-1' }),
    );
    repo.updateStale.mockRejectedValueOnce(new Error('db blip'));

    await manager.recoverStale(repo.get('po-1'));

    expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: 'db blip', vendorOrderNumber: 'W-1' });
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });
});

describe('abnormal ord_list through the real WowpressClient', () => {
  const ENV = {
    WOWPRESS_AUTH_UID: 'u',
    WOWPRESS_AUTH_PW: 'p',
    WOWPRESS_SENDER_NAME: '아몬드영',
    WOWPRESS_SENDER_TEL: '02-000-0000',
    WOWPRESS_SENDER_ZIPCODE: '06236',
    WOWPRESS_SENDER_ADDR1: '서울특별시 강남구 테헤란로 1',
  };

  function realSetup(row: PrintOrderRow, ordListBody: unknown = { resultCode: '200', resultMap: { rows: [] } }) {
    const urls: string[] = [];
    const transport: WowpressTransport = (req) => {
      urls.push(req.url);
      if (req.url.endsWith('/api/login/issue')) {
        return Promise.resolve({ status: 200, body: { resultCode: '200', token: 't' } });
      }
      if (req.url.endsWith('/ord_list')) {
        return Promise.resolve({ status: 200, body: ordListBody });
      }
      return Promise.resolve({ status: 200, body: { resultCode: '200', resultMap: {} } });
    };
    const repo = new FakeRepo();
    repo.rows.set(row.id, row);
    repo.context = context(CONFIRMED_VARIANT);
    const manager = new PrintOrderSubmitManager(
      repo,
      new WowpressClient(new ConfigService(ENV), transport),
      new FakeUgc(),
    );
    return { repo, manager, urls };
  }

  const unreadable: [string, unknown][] = [
    ['unknown list key', { resultCode: '200', resultMap: { rows: [] } }],
    ['row without ordkey', { resultCode: '200', resultMap: { ord_list: [{ orderKey: LINE_ID, ordnum: 'W-1' }] } }],
  ];

  it.each(unreadable)('never sends cjson_order on a retry when ord_list is unreadable (%s)', async (_label, body) => {
    const { repo, manager, urls } = realSetup(makeRow({ orderAttemptedAt: ATTEMPTED }), body);

    await manager.submit(repo.get('po-1'));

    expect(repo.get('po-1')).toMatchObject({
      status: 'failed',
      lastError: ORDER_UNCONFIRMED_ERROR,
      vendorOrderNumber: null,
    });
    expect(urls.some((u) => u.endsWith('/cjson_order'))).toBe(false);
  });

  it.each(unreadable)(
    'never sends cjson_order after stale recovery when ord_list is unreadable (%s)',
    async (_label, body) => {
      const { repo, manager, urls } = realSetup(makeRow({ orderAttemptedAt: ATTEMPTED }), body);

      await manager.recoverStale(repo.get('po-1'));

      expect(repo.get('po-1')).toMatchObject({
        status: 'failed',
        lastError: ORDER_UNCONFIRMED_ERROR,
        vendorOrderNumber: null,
      });
      expect(urls.some((u) => u.endsWith('/cjson_order'))).toBe(false);
    },
  );
});

describe('PrintOrderSubmitWorker', () => {
  const enabled = new ConfigService({ PRINT_ORDER_SUBMIT_ENABLED: 'true' });

  it('worker does nothing when PRINT_ORDER_SUBMIT_ENABLED is not "true"', async () => {
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      const { repo, wowpress, manager } = setup(CONFIRMED_VARIANT, makeRow({ status: 'pending' }));
      const config = new ConfigService(value === undefined ? {} : { PRINT_ORDER_SUBMIT_ENABLED: value });
      await new PrintOrderSubmitWorker(config, repo, manager).tick();
      expect(repo.staleSubmitting).not.toHaveBeenCalled();
      expect(repo.claimDue).not.toHaveBeenCalled();
      expect(wowpress.order).not.toHaveBeenCalled();
    }
  });

  it('recovers stale rows, then claims one row at a time without one failure blocking the next', async () => {
    const { repo, manager } = setup(CONFIRMED_VARIANT, makeRow({ id: 'po-stale' }));
    const old = new Date('2020-01-01T00:00:00Z');
    repo.rows.set('po-a', makeRow({ id: 'po-a', status: 'pending', createdAt: new Date(old.getTime() + 1) }));
    repo.rows.set('po-b', makeRow({ id: 'po-b', status: 'pending', createdAt: new Date(old.getTime() + 2) }));
    const order: string[] = [];
    jest.spyOn(manager, 'recoverStale').mockImplementation((r) => {
      order.push(`recover:${r.id}`);
      return Promise.resolve();
    });
    jest.spyOn(manager, 'submit').mockImplementation((r) => {
      order.push(`submit:${r.id}`);
      return r.id === 'po-a' ? Promise.reject(new Error('boom')) : Promise.resolve();
    });

    await new PrintOrderSubmitWorker(enabled, repo, manager).runOnce();

    expect(order).toEqual(['recover:po-stale', 'submit:po-a', 'submit:po-b']);
    expect(repo.claimDue.mock.calls.map(([limit]) => limit)).toEqual([1, 1, 1]);
  });

  describe('two instances when processing outlasts the stale window', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-14T00:00:00Z'), doNotFake: ['nextTick', 'queueMicrotask'] });
    });
    afterEach(() => jest.useRealTimers());

    it('never sends a second order when the process that took the right freezes', async () => {
      const repo = new FakeRepo();
      repo.context = context(CONFIRMED_VARIANT);
      repo.rows.set('po-1', makeRow({ status: 'pending', submittingAt: null }));
      const wowA = new FakeWowpress('W-A');
      const wowB = new FakeWowpress('W-B');
      const workerA = new PrintOrderSubmitWorker(enabled, repo, new PrintOrderSubmitManager(repo, wowA, new FakeUgc()));
      const workerB = new PrintOrderSubmitWorker(enabled, repo, new PrintOrderSubmitManager(repo, wowB, new FakeUgc()));
      let bRun!: Promise<void>;
      const bStarted = new Promise<void>((resolve) => {
        wowA.order.mockImplementationOnce(() => {
          jest.setSystemTime(Date.now() + PRINT_ORDER_STALE_MS + 60_000);
          bRun = workerB.runOnce();
          resolve();
          return new Promise<{ ordnum: string }>(() => undefined);
        });
      });

      void workerA.runOnce();
      await bStarted;
      await bRun;
      jest.setSystemTime(Date.now() + 24 * 60 * 60_000);
      await workerB.runOnce();

      expect(wowA.order).toHaveBeenCalledTimes(1);
      expect(wowB.order).not.toHaveBeenCalled();
      expect(wowB.findByOrdkey).toHaveBeenCalledWith(LINE_ID, repo.get('po-1').createdAt);
      expect(repo.get('po-1')).toMatchObject({ status: 'failed', lastError: ORDER_UNCONFIRMED_ERROR });
    });

    it('orders each line at most once', async () => {
      const repo = new FakeRepo();
      repo.context = context(CONFIRMED_VARIANT);
      repo.rows.set('po-1', makeRow({ status: 'pending', submittingAt: null }));
      const wowA = new FakeWowpress('W-A');
      const wowB = new FakeWowpress('W-B');
      const ugcA = new FakeUgc();
      const ugcB = new FakeUgc();
      const workerA = new PrintOrderSubmitWorker(enabled, repo, new PrintOrderSubmitManager(repo, wowA, ugcA));
      const workerB = new PrintOrderSubmitWorker(enabled, repo, new PrintOrderSubmitManager(repo, wowB, ugcB));
      ugcA.printLink.mockImplementationOnce(async () => {
        jest.setSystemTime(Date.now() + PRINT_ORDER_STALE_MS + 60_000);
        await workerB.runOnce();
        return { url: 'https://s3/print.jpg', fileName: 'print.jpg' };
      });

      await workerA.runOnce();

      expect(wowA.order.mock.calls.length + wowB.order.mock.calls.length).toBe(1);
      expect(wowA.order).not.toHaveBeenCalled();
      expect(repo.get('po-1')).toMatchObject({ status: 'submitted', vendorOrderNumber: 'W-B' });
    });
  });
});
