import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import type { DbService } from '@app/db';
import { ConflictError, UpstreamUnavailableError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedWorld } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { insertCustomerReturn, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { CarrierGatewayRegistry } from '../../fulfillment/waybill/carrier/carrier-gateway.registry';
import {
  CarrierError,
  CarrierGateway,
  type AllocateResult,
  type PickupCancelOutcome,
  type PickupRequest,
  type PickupReserveOutcome,
  type RegisterOutcome,
} from '../../fulfillment/waybill/carrier/carrier-gateway.interface';
import type { HanjinConfig } from '../../fulfillment/waybill/carrier/hanjin/hanjin.config';
import { newPickupRow } from './customer-return-pickup.types';
import {
  CustomerReturnPickupManager,
  PICKUP_ATTEMPTS_CAP,
  PICKUP_LEASE_MS,
  nextPickupAttemptAt,
} from './customer-return-pickup.manager';

/**
 * 반품 회수 워커 (K8 PR9 Task 4). 한진은 가짜 게이트웨이(호출 기록 + 정해 둔 결과).
 * 매니저는 «트랜잭션마다 따로 커밋»하지만, 스펙은 그 run 을 전부 rollback 트랜잭션 하나에 묶어 흔적을 남기지 않는다.
 * 실행: DATABASE_URL=<scratch core DB> npx jest customer-return-pickup.manager --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const MINUTE = 60_000;

describe('nextPickupAttemptAt — min(2^(attempts−1), 60)분', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [6, 32],
    [7, 60],
    [12, 60],
  ])('attempts %i → %i분 뒤', (attempts, minutes) => {
    expect(nextPickupAttemptAt(now, attempts).getTime() - now.getTime()).toBe(minutes * MINUTE);
  });
});

type ReserveScript = (req: PickupRequest) => Promise<PickupReserveOutcome>;
type CancelScript = (custOrdNo: string) => Promise<PickupCancelOutcome>;

class FakePickupGateway extends CarrierGateway {
  readonly carrier = 'HANJIN' as const;
  readonly capabilities = { allocatesExternally: true, registersSeparately: true, canTrack: true, canCancel: true };
  configured = true;
  reserveCalls: PickupRequest[] = [];
  cancelCalls: string[] = [];
  reserveScript: ReserveScript = () => Promise.resolve({ kind: 'reserved', waybillNo: '560000175571' });
  cancelScript: CancelScript = () => Promise.resolve({ kind: 'cancelled' });

  isConfigured(): boolean {
    return true;
  }
  allocate(): Promise<AllocateResult> {
    throw new Error('not used');
  }
  register(): Promise<RegisterOutcome> {
    throw new Error('not used');
  }
  override isPickupConfigured(): boolean {
    return this.configured;
  }
  override async reservePickup(req: PickupRequest): Promise<PickupReserveOutcome> {
    this.reserveCalls.push(req);
    return this.reserveScript(req);
  }
  override async cancelPickup(custOrdNo: string): Promise<PickupCancelOutcome> {
    this.cancelCalls.push(custOrdNo);
    return this.cancelScript(custOrdNo);
  }
}

const config = {
  sender: {
    name: '부천출고지',
    zip: '14523',
    baseAddress: '경기 부천시 오정구 1',
    detailAddress: '창고',
    tel: '032-000-0000',
  },
  boxType: 'A',
  returnPayType: 'CT',
} as HanjinConfig;

// 회수지(고객) 개인정보 — 한진 본문에만 실려야 하고 last_error·로그에 나오면 안 된다
const PII = { name: '홍길동회수', phone: '010-9876-5432', road: '서울 종로구 세종대로 209', detail: '비밀동 707호' };
const snapshot = {
  recipientName: PII.name,
  phone: PII.phone,
  postalCode: '03154',
  roadAddress: PII.road,
  detailAddress: PII.detail,
};

/** run 을 바깥 rollback 트랜잭션에 묶는다 — 매니저의 «짧은 트랜잭션 여럿»이 한 트랜잭션 안 연속 문장이 된다 */
function scopedDbService(tx: DbTx): DbService<typeof wmsSchema> {
  return {
    db: tx,
    run: <T>(fn: (t: DbTx) => Promise<T>, t?: DbTx): Promise<T> => fn(t ?? tx),
  } as unknown as DbService<typeof wmsSchema>;
}

describeIfDb('CustomerReturnPickupManager — 반품 회수 워커 (K8 PR9)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  let logged: string[] = [];
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    logged = [];
    const capture =
      () =>
      (...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
      };
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(capture());
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture());
    jest.spyOn(Logger.prototype, 'log').mockImplementation(capture());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function wire(tx: DbTx) {
    const gateway = new FakePickupGateway();
    const manager = new CustomerReturnPickupManager(scopedDbService(tx), new CarrierGatewayRegistry([gateway]), config);
    return { gateway, manager };
  }

  async function seedPickup(
    tx: DbTx,
    opts: { delivered?: boolean; snapshot?: unknown; originalWaybillNo?: string | null } = {},
  ) {
    const w = await seedWorld(tx);
    const line = await seedDeliveredLine(tx, w, {
      quantity: 2,
      composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
      parcels: [{ qtyBySku: { [w.skuId]: 2 }, delivered: opts.delivered ?? true }],
      customerId: randomUUID(),
    });
    const shipmentId = line.parcels[0].shipmentId;
    await tx
      .update(wmsTables.shipments)
      .set({ recipientSnapshot: opts.snapshot === undefined ? snapshot : opts.snapshot })
      .where(eq(wmsTables.shipments.id, shipmentId));
    const originalWaybillNo = opts.originalWaybillNo === undefined ? 'WB-ORIG-1' : opts.originalWaybillNo;
    if (originalWaybillNo) {
      await tx.insert(wmsTables.waybills).values({
        shipmentId,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'used',
        trackingNo: originalWaybillNo,
        manifestVersion: 1,
        recipientHash: 'x'.repeat(64),
        issuedAt: new Date(),
      });
    }
    const { customerReturnId } = await insertCustomerReturn(tx, {
      salesOrderId: line.salesOrderId,
      status: 'expected',
      lines: [{ salesOrderLineId: line.lineId, quantity: 2 }],
    });
    const row = newPickupRow(customerReturnId, null);
    await tx.insert(wmsTables.customerReturnPickups).values(row);
    return { pickupId: row.id, custOrdNo: row.custOrdNo, customerReturnId };
  }

  const rowOf = async (tx: DbTx, id: string) => {
    const [row] = await tx
      .select()
      .from(wmsTables.customerReturnPickups)
      .where(eq(wmsTables.customerReturnPickups.id, id));
    return row;
  };

  const setRow = (tx: DbTx, id: string, set: Partial<typeof wmsTables.customerReturnPickups.$inferInsert>) =>
    tx.update(wmsTables.customerReturnPickups).set(set).where(eq(wmsTables.customerReturnPickups.id, id));

  const now = new Date('2026-10-28T03:00:00.000Z');

  describe('claim', () => {
    it('리스를 잡으며 attempts 를 올리고, 리스가 살아 있으면 null', () =>
      inRollbackTx(db, async (tx) => {
        const { manager } = wire(tx);
        const { pickupId } = await seedPickup(tx);

        const claimed = await manager.claim(tx, pickupId, now);
        expect(claimed).toMatchObject({ id: pickupId, status: 'pending', attempts: 1 });
        expect(claimed?.leaseUntil?.getTime()).toBe(now.getTime() + PICKUP_LEASE_MS);

        expect(await manager.claim(tx, pickupId, now)).toBeNull();
        expect(await manager.claim(tx, pickupId, new Date(now.getTime() + PICKUP_LEASE_MS + 1))).not.toBeNull();
      }));

    it('끝난 행(failed)은 잡지 않는다', () =>
      inRollbackTx(db, async (tx) => {
        const { manager } = wire(tx);
        const { pickupId } = await seedPickup(tx);
        await setRow(tx, pickupId, { status: 'failed' });
        expect(await manager.claim(tx, pickupId, now)).toBeNull();
        expect(await manager.claimDue(tx, pickupId, now)).toBeNull();
      }));

    it('claimDue 는 기한 전 pending·reserved 를 id 로 불러도 잡지 않고, claim 은 잡는다', () =>
      inRollbackTx(db, async (tx) => {
        const { manager } = wire(tx);
        const later = await seedPickup(tx, { originalWaybillNo: 'WB-A' });
        await setRow(tx, later.pickupId, { attempts: 1, nextAttemptAt: new Date(now.getTime() + MINUTE) });
        const reserved = await seedPickup(tx, { originalWaybillNo: 'WB-B' });
        await setRow(tx, reserved.pickupId, { status: 'reserved', attempts: 1, waybillNo: '560000999999' });

        expect(await manager.claimDue(tx, later.pickupId, now)).toBeNull();
        expect(await manager.claimDue(tx, reserved.pickupId, now)).toBeNull();
        expect(await rowOf(tx, later.pickupId)).toMatchObject({ attempts: 1, leaseUntil: null });

        expect(await manager.claimDue(tx, later.pickupId, new Date(now.getTime() + MINUTE))).toMatchObject({
          status: 'pending',
          attempts: 2,
        });
        expect(await manager.claim(tx, reserved.pickupId, now)).toMatchObject({ status: 'reserved', attempts: 2 });
      }));
  });

  describe('예약(pending)', () => {
    it('reserved → 행 reserved, 회수 운송장·원운송장·reserved_at, 리스 풀림', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId, custOrdNo } = await seedPickup(tx);

        expect(await manager.dispatchDue(now)).toEqual({ sent: 1, cancelled: 0 });

        expect(gateway.reserveCalls).toHaveLength(1);
        expect(gateway.reserveCalls[0]).toMatchObject({
          custOrdNo,
          originalWaybillNo: 'WB-ORIG-1',
          sender: { name: PII.name, baseAddress: PII.road, mobile: PII.phone },
          recipient: { name: '부천출고지' },
          payType: 'CT',
        });
        const row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({
          status: 'reserved',
          waybillNo: '560000175571',
          originalWaybillNo: 'WB-ORIG-1',
          attempts: 1,
          leaseUntil: null,
          nextAttemptAt: null,
          lastError: null,
        });
        expect(row.reservedAt?.getTime()).toBe(now.getTime());
      }));

    it('already_reserved(ERROR-03 + 번호) 도 같은 결과', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        gateway.reserveScript = () => Promise.resolve({ kind: 'already_reserved', waybillNo: '560000175571' });
        const { pickupId } = await seedPickup(tx);

        expect(await manager.dispatchDue(now)).toEqual({ sent: 1, cancelled: 0 });
        expect(await rowOf(tx, pickupId)).toMatchObject({
          status: 'reserved',
          waybillNo: '560000175571',
          originalWaybillNo: 'WB-ORIG-1',
          leaseUntil: null,
        });
      }));

    it('원운송장이 없으면 original_waybill_no 는 null', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId } = await seedPickup(tx, { originalWaybillNo: null });

        await manager.dispatchDue(now);
        expect(gateway.reserveCalls[0].originalWaybillNo).toBeUndefined();
        expect(await rowOf(tx, pickupId)).toMatchObject({ status: 'reserved', originalWaybillNo: null });
      }));

    it('unknown_outcome → pending·attempts 1·1분 뒤, 기한 전에는 다시 안 보내고, 12번째 실패면 attempts_exhausted', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        gateway.reserveScript = () =>
          Promise.reject(
            new CarrierError('Hanjin request did not produce a definitive response', 'unknown_outcome', {
              carrier: 'hanjin',
              code: 'timeout',
            }),
          );
        const { pickupId } = await seedPickup(tx);

        expect(await manager.dispatchDue(now)).toEqual({ sent: 0, cancelled: 0 });
        let row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'pending', attempts: 1, leaseUntil: null });
        expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + MINUTE);
        expect(row.lastError).toContain('timeout');

        await manager.dispatchDue(now);
        expect(gateway.reserveCalls).toHaveLength(1);

        for (let i = 2; i < PICKUP_ATTEMPTS_CAP; i++) {
          await manager.dispatchDue(new Date(now.getTime() + i * 120 * MINUTE));
        }
        row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'pending', attempts: PICKUP_ATTEMPTS_CAP - 1 });

        await manager.dispatchDue(new Date(now.getTime() + PICKUP_ATTEMPTS_CAP * 120 * MINUTE));
        row = await rowOf(tx, pickupId);
        expect(gateway.reserveCalls).toHaveLength(PICKUP_ATTEMPTS_CAP);
        expect(row).toMatchObject({ status: 'failed', attempts: PICKUP_ATTEMPTS_CAP, leaseUntil: null });
        expect(row.lastError).toMatch(/^attempts_exhausted:/);
      }));

    it('transient_rejection(-103) 도 같은 행·같은 번호로 다시 보낸다', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        let first = true;
        gateway.reserveScript = () => {
          if (first) {
            first = false;
            return Promise.reject(
              new CarrierError('Hanjin rejected the request: -103 Too many request', 'transient_rejection', {
                carrier: 'hanjin',
                code: '-103',
              }),
            );
          }
          return Promise.resolve({ kind: 'already_reserved', waybillNo: '560000175571' });
        };
        const { pickupId, custOrdNo } = await seedPickup(tx);

        await manager.dispatchDue(now);
        expect(await rowOf(tx, pickupId)).toMatchObject({ status: 'pending', attempts: 1 });
        await manager.dispatchDue(new Date(now.getTime() + MINUTE));
        expect(gateway.reserveCalls.map((r) => r.custOrdNo)).toEqual([custOrdNo, custOrdNo]);
        expect(await rowOf(tx, pickupId)).toMatchObject({ status: 'reserved', waybillNo: '560000175571', attempts: 2 });
      }));

    it('rejected ERROR-14 → 즉시 failed, last_error 에 코드와 사유', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        gateway.reserveScript = () => Promise.resolve({ kind: 'rejected', code: 'ERROR-14', reason: '지불조건 오류' });
        const { pickupId } = await seedPickup(tx);

        await manager.dispatchDue(now);
        const row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'failed', attempts: 1, leaseUntil: null, nextAttemptAt: null });
        expect(row.lastError).toBe('ERROR-14: 지불조건 오류');
      }));

    it('배송완료 상자가 없으면 한진을 부르지 않고 failed: no_pickup_address', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId } = await seedPickup(tx, { delivered: false });

        await manager.dispatchDue(now);
        expect(gateway.reserveCalls).toHaveLength(0);
        const row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'failed', leaseUntil: null });
        expect(row.lastError).toMatch(/^no_pickup_address/);
      }));

    it('주소 스냅샷이 불완전해도 failed: no_pickup_address', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId } = await seedPickup(tx, { snapshot: { recipientName: PII.name, phone: PII.phone } });

        await manager.dispatchDue(now);
        expect(gateway.reserveCalls).toHaveLength(0);
        const row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'failed', leaseUntil: null });
        expect(row.lastError).toMatch(/^no_pickup_address/);
        expect(row.lastError).not.toContain(PII.name);
        expect(row.lastError).not.toContain(PII.phone);
      }));

    it('보내는 사이 다른 쪽이 행을 가져가 끝냈으면(상태·리스가 바뀜) 아무것도 덮어쓰지 않는다', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId } = await seedPickup(tx);
        const otherLease = new Date(now.getTime() + 10 * MINUTE);
        gateway.reserveScript = async () => {
          await setRow(tx, pickupId, { status: 'cancelled', leaseUntil: otherLease });
          return { kind: 'reserved', waybillNo: '560000175571' };
        };

        expect(await manager.dispatchDue(now)).toEqual({ sent: 0, cancelled: 0 });
        const row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'cancelled', waybillNo: null, reservedAt: null, leaseUntil: otherLease });
      }));

    it.each<'reserved' | 'already_reserved'>(['reserved', 'already_reserved'])(
      '보내는 사이 취소 정리가 cancel_pending 으로 돌리면(%s) 번호는 남기고 리스를 풀어 다음 틱이 취소한다',
      (kind) =>
        inRollbackTx(db, async (tx) => {
          const { gateway, manager } = wire(tx);
          const { pickupId, custOrdNo } = await seedPickup(tx);
          gateway.reserveScript = async () => {
            await setRow(tx, pickupId, { status: 'cancel_pending', nextAttemptAt: null });
            return { kind, waybillNo: '560000175571' };
          };

          expect(await manager.dispatchDue(now)).toEqual({ sent: 0, cancelled: 0 });
          let row = await rowOf(tx, pickupId);
          expect(row).toMatchObject({
            status: 'cancel_pending',
            waybillNo: '560000175571',
            originalWaybillNo: 'WB-ORIG-1',
            leaseUntil: null,
          });
          expect(row.reservedAt?.getTime()).toBe(now.getTime());

          // 다음 틱: 취소 — 이미 집하됐으면 reserved 로 돌아가도 번호가 있다
          gateway.cancelScript = () => Promise.resolve({ kind: 'picked_up', reason: '운송장출력 상태' });
          await manager.dispatchDue(now);
          expect(gateway.cancelCalls).toEqual([custOrdNo]);
          row = await rowOf(tx, pickupId);
          expect(row).toMatchObject({ status: 'reserved', waybillNo: '560000175571', leaseUntil: null });
          expect(row.pickedUpAt?.getTime()).toBe(now.getTime());
        }),
    );
  });

  describe('취소(cancel_pending)', () => {
    async function seedCancelPending(tx: DbTx, attempts = 1) {
      const seeded = await seedPickup(tx);
      await setRow(tx, seeded.pickupId, {
        status: 'cancel_pending',
        attempts,
        waybillNo: `5600${randomUUID().replace(/-/g, '').slice(0, 8)}`,
        reservedAt: new Date('2026-10-27T00:00:00Z'),
        nextAttemptAt: null,
      });
      return seeded;
    }

    it.each<PickupCancelOutcome>([{ kind: 'cancelled' }, { kind: 'already_cancelled' }, { kind: 'not_found' }])(
      '%o → cancelled + cancelled_at',
      (outcome) =>
        inRollbackTx(db, async (tx) => {
          const { gateway, manager } = wire(tx);
          gateway.cancelScript = () => Promise.resolve(outcome);
          const { pickupId, custOrdNo } = await seedCancelPending(tx);

          expect(await manager.dispatchDue(now)).toEqual({ sent: 0, cancelled: 1 });
          expect(gateway.cancelCalls).toEqual([custOrdNo]);
          expect(gateway.reserveCalls).toHaveLength(0);
          const row = await rowOf(tx, pickupId);
          expect(row).toMatchObject({ status: 'cancelled', leaseUntil: null, nextAttemptAt: null });
          expect(row.cancelledAt?.getTime()).toBe(now.getTime());
        }),
    );

    it('picked_up(ERROR-04) → reserved 로 돌아가고 picked_up_at, error 로그', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        gateway.cancelScript = () => Promise.resolve({ kind: 'picked_up', reason: '운송장출력 상태' });
        const { pickupId } = await seedCancelPending(tx);

        expect(await manager.dispatchDue(now)).toEqual({ sent: 0, cancelled: 0 });
        const row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'reserved', leaseUntil: null, nextAttemptAt: null });
        expect(row.pickedUpAt?.getTime()).toBe(now.getTime());
        expect(errorSpy).toHaveBeenCalled();
        expect(logged.join('\n')).toContain(pickupId);
      }));

    it('unknown_outcome → cancel_pending 유지 + 백오프, 상한을 넘으면 error 로그만', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        gateway.cancelScript = () =>
          Promise.reject(
            new CarrierError('Hanjin request did not produce a definitive response', 'unknown_outcome', {
              carrier: 'hanjin',
              code: 'transport_error',
            }),
          );
        const { pickupId } = await seedCancelPending(tx, 1);

        await manager.dispatchDue(now);
        let row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'cancel_pending', attempts: 2, leaseUntil: null });
        expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + 2 * MINUTE);
        expect(row.lastError).toContain('transport_error');
        expect(errorSpy).not.toHaveBeenCalled();

        await setRow(tx, pickupId, { attempts: PICKUP_ATTEMPTS_CAP - 1, nextAttemptAt: null });
        await manager.dispatchDue(now);
        row = await rowOf(tx, pickupId);
        expect(row).toMatchObject({ status: 'cancel_pending', attempts: PICKUP_ATTEMPTS_CAP, leaseUntil: null });
        expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + 60 * MINUTE);
        expect(errorSpy).toHaveBeenCalled();
      }));
  });

  describe('건너뛰기', () => {
    it('다른 리스가 살아 있는 행은 건너뛴다', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId } = await seedPickup(tx);
        const lease = new Date(now.getTime() + MINUTE);
        await setRow(tx, pickupId, { leaseUntil: lease });

        expect(await manager.dispatchDue(now)).toEqual({ sent: 0, cancelled: 0 });
        expect(gateway.reserveCalls).toHaveLength(0);
        expect(await rowOf(tx, pickupId)).toMatchObject({ status: 'pending', attempts: 0, leaseUntil: lease });
      }));

    it('게이트웨이가 회수 미설정이면 DB 를 읽지 않고 0', async () => {
      const gateway = new FakePickupGateway();
      gateway.configured = false;
      const run = jest.fn();
      const manager = new CustomerReturnPickupManager(
        { run, db: undefined } as unknown as DbService<typeof wmsSchema>,
        new CarrierGatewayRegistry([gateway]),
        config,
      );
      expect(await manager.dispatchDue(now)).toEqual({ sent: 0, cancelled: 0 });
      expect(run).not.toHaveBeenCalled();

      const none = new CustomerReturnPickupManager(
        { run, db: undefined } as unknown as DbService<typeof wmsSchema>,
        new CarrierGatewayRegistry([]),
        config,
      );
      expect(await none.dispatchDue(now)).toEqual({ sent: 0, cancelled: 0 });
      expect(run).not.toHaveBeenCalled();
    });

    it('limit 만큼만 처리한다', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const a = await seedPickup(tx, { originalWaybillNo: 'WB-A' });
        const b = await seedPickup(tx, { originalWaybillNo: 'WB-B' });

        await manager.dispatchDue(now, 1);
        expect(gateway.reserveCalls).toHaveLength(1);
        const statuses = [(await rowOf(tx, a.pickupId)).status, (await rowOf(tx, b.pickupId)).status].sort();
        expect(statuses).toEqual(['pending', 'reserved']);
      }));
  });

  describe('release — 반품 취소 전 회수 놓아주기 (N6)', () => {
    const channelReturnIdOf = async (tx: DbTx, customerReturnId: string) => {
      const [row] = await tx
        .select({ channelReturnId: wmsTables.customerReturns.channelReturnId })
        .from(wmsTables.customerReturns)
        .where(eq(wmsTables.customerReturns.id, customerReturnId));
      return row.channelReturnId;
    };

    /** 한 번 보낸 활성 행 — 리스 없음 */
    async function seedSent(
      tx: DbTx,
      status: 'reserved' | 'cancel_pending' | 'pending',
      returnStatus: 'expected' | 'cancelled' = 'expected',
    ) {
      const seeded = await seedPickup(tx);
      await setRow(tx, seeded.pickupId, {
        status,
        attempts: 1,
        waybillNo: status === 'pending' ? null : `5600${randomUUID().replace(/-/g, '').slice(0, 8)}`,
        reservedAt: status === 'pending' ? null : new Date('2026-10-27T00:00:00Z'),
      });
      if (returnStatus !== 'expected') {
        await tx
          .update(wmsTables.customerReturns)
          .set({ status: returnStatus, cancelledAt: now })
          .where(eq(wmsTables.customerReturns.id, seeded.customerReturnId));
      }
      return { ...seeded, channelReturnId: await channelReturnIdOf(tx, seeded.customerReturnId) };
    }

    it('기록 없음(관측 지연) → released, 한진 안 부름', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        expect(await manager.release(`ret-${randomUUID()}`, now)).toEqual({ result: 'released' });
        expect(gateway.cancelCalls).toHaveLength(0);
      }));

    it.each(['arrived', 'inspected'] as const)('반품이 %s(도착 뒤) → picked_up, 한진 안 부름', (status) =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId, channelReturnId, customerReturnId } = await seedSent(tx, 'reserved');
        await tx
          .update(wmsTables.customerReturns)
          .set({ status })
          .where(eq(wmsTables.customerReturns.id, customerReturnId));
        const before = await rowOf(tx, pickupId);

        expect(await manager.release(channelReturnId, now)).toEqual({ result: 'picked_up' });
        expect(gateway.cancelCalls).toHaveLength(0);
        expect(await rowOf(tx, pickupId)).toEqual(before);
      }),
    );

    it.each(['failed', 'void', 'cancelled'] as const)('활성 회수 없음(%s 뿐) → released, 한진 안 부름', (status) =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId, channelReturnId } = await seedSent(tx, 'reserved');
        await setRow(tx, pickupId, { status });

        expect(await manager.release(channelReturnId, now)).toEqual({ result: 'released' });
        expect(gateway.cancelCalls).toHaveLength(0);
        expect(await rowOf(tx, pickupId)).toMatchObject({ status });
      }),
    );

    it('워커가 리스를 잡은 상태 → 409 pickup_busy, 행 그대로, 한진 안 부름', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const seeded = await seedPickup(tx);
        const channelReturnId = await channelReturnIdOf(tx, seeded.customerReturnId);
        // 워커가 예약을 보내는 중 — claimDue 가 attempts 를 올리고 리스를 잡았다
        await manager.claimDue(tx, seeded.pickupId, now);
        const before = await rowOf(tx, seeded.pickupId);
        expect(before).toMatchObject({ status: 'pending', attempts: 1 });

        const err = await manager.release(channelReturnId, new Date(now.getTime() + 1000)).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ConflictError);
        expect((err as Error).message).toMatch(/^pickup_busy: /);
        expect(gateway.cancelCalls).toHaveLength(0);
        expect(await rowOf(tx, seeded.pickupId)).toEqual(before);
      }));

    it('보낸 적 있는 행도 리스가 살아 있으면 409 — attempts 그대로', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const { pickupId, channelReturnId } = await seedSent(tx, 'reserved');
        const lease = new Date(now.getTime() + MINUTE);
        await setRow(tx, pickupId, { leaseUntil: lease });

        await expect(manager.release(channelReturnId, now)).rejects.toBeInstanceOf(ConflictError);
        expect(gateway.cancelCalls).toHaveLength(0);
        expect(await rowOf(tx, pickupId)).toMatchObject({ status: 'reserved', attempts: 1, leaseUntil: lease });
      }));

    it('pending ∧ attempts 0 → void, released, 한진 안 부르고 attempts 그대로', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        const seeded = await seedPickup(tx);
        const channelReturnId = await channelReturnIdOf(tx, seeded.customerReturnId);

        expect(await manager.release(channelReturnId, now)).toEqual({ result: 'released' });
        expect(gateway.cancelCalls).toHaveLength(0);
        expect(await rowOf(tx, seeded.pickupId)).toMatchObject({ status: 'void', attempts: 0, leaseUntil: null });
      }));

    it('pending ∧ attempts 0 은 게이트웨이가 미설정이어도 void, released', () =>
      inRollbackTx(db, async (tx) => {
        const { gateway, manager } = wire(tx);
        gateway.configured = false;
        const seeded = await seedPickup(tx);
        const channelReturnId = await channelReturnIdOf(tx, seeded.customerReturnId);

        expect(await manager.release(channelReturnId, now)).toEqual({ result: 'released' });
        expect(await rowOf(tx, seeded.pickupId)).toMatchObject({ status: 'void' });
      }));

    it('pending ∧ attempts 0 의 리스가 만료됐으면 void', () =>
      inRollbackTx(db, async (tx) => {
        const { manager } = wire(tx);
        const seeded = await seedPickup(tx);
        await setRow(tx, seeded.pickupId, { leaseUntil: new Date(now.getTime() - 1) });
        const channelReturnId = await channelReturnIdOf(tx, seeded.customerReturnId);

        expect(await manager.release(channelReturnId, now)).toEqual({ result: 'released' });
        expect(await rowOf(tx, seeded.pickupId)).toMatchObject({ status: 'void', leaseUntil: null });
      }));

    describe.each([
      ['reserved', 'expected'],
      ['cancel_pending', 'cancelled'],
      ['pending', 'expected'],
    ] as const)('보낸 적 있는 %s (반품 %s)', (status, returnStatus) => {
      it.each<PickupCancelOutcome>([{ kind: 'cancelled' }, { kind: 'already_cancelled' }, { kind: 'not_found' }])(
        '한진 %o → 행 cancelled, released',
        (outcome) =>
          inRollbackTx(db, async (tx) => {
            const { gateway, manager } = wire(tx);
            gateway.cancelScript = () => Promise.resolve(outcome);
            const { pickupId, custOrdNo, channelReturnId } = await seedSent(tx, status, returnStatus);

            expect(await manager.release(channelReturnId, now)).toEqual({ result: 'released' });
            expect(gateway.cancelCalls).toEqual([custOrdNo]);
            const row = await rowOf(tx, pickupId);
            expect(row).toMatchObject({ status: 'cancelled', attempts: 2, leaseUntil: null, nextAttemptAt: null });
            expect(row.cancelledAt?.getTime()).toBe(now.getTime());
          }),
      );

      it('한진 picked_up → picked_up_at, reserved, 리스 풀림, picked_up — 다시 부르면 한진에 다시 묻고 같은 답', () =>
        inRollbackTx(db, async (tx) => {
          const { gateway, manager } = wire(tx);
          gateway.cancelScript = () => Promise.resolve({ kind: 'picked_up', reason: '운송장출력 상태' });
          const { pickupId, custOrdNo, channelReturnId } = await seedSent(tx, status, returnStatus);

          expect(await manager.release(channelReturnId, now)).toEqual({ result: 'picked_up' });
          let row = await rowOf(tx, pickupId);
          expect(row).toMatchObject({ status: 'reserved', leaseUntil: null, nextAttemptAt: null });
          expect(row.pickedUpAt?.getTime()).toBe(now.getTime());

          const later = new Date(now.getTime() + MINUTE);
          expect(await manager.release(channelReturnId, later)).toEqual({ result: 'picked_up' });
          expect(gateway.cancelCalls).toEqual([custOrdNo, custOrdNo]);
          row = await rowOf(tx, pickupId);
          expect(row).toMatchObject({ status: 'reserved', leaseUntil: null });
          expect(row.pickedUpAt?.getTime()).toBe(later.getTime());
        }));

      it.each<[string, CancelScript]>([
        ['거절(rejected)', () => Promise.resolve({ kind: 'rejected', code: 'ERROR-99', reason: '알 수 없음' })],
        [
          '던짐(unknown_outcome)',
          () =>
            Promise.reject(
              new CarrierError('Hanjin request did not produce a definitive response', 'unknown_outcome', {
                carrier: 'hanjin',
                code: 'transport_error',
              }),
            ),
        ],
        ['던짐(내부 오류)', () => Promise.reject(new TypeError('boom'))],
      ])('한진 %s → 리스 풀고 상태 그대로, 502 pickup_cancel_unavailable', (_label, script) =>
        inRollbackTx(db, async (tx) => {
          const { gateway, manager } = wire(tx);
          gateway.cancelScript = script;
          const { pickupId, channelReturnId } = await seedSent(tx, status, returnStatus);

          const err = await manager.release(channelReturnId, now).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(UpstreamUnavailableError);
          expect((err as Error).message).toMatch(/^pickup_cancel_unavailable: /);
          expect(gateway.cancelCalls).toHaveLength(1);
          expect(await rowOf(tx, pickupId)).toMatchObject({ status, attempts: 2, leaseUntil: null });
        }),
      );

      it('게이트웨이 미설정 → 502, 행 그대로(잡지 않는다)', () =>
        inRollbackTx(db, async (tx) => {
          const { gateway, manager } = wire(tx);
          gateway.configured = false;
          const { pickupId, channelReturnId } = await seedSent(tx, status, returnStatus);
          const before = await rowOf(tx, pickupId);

          await expect(manager.release(channelReturnId, now)).rejects.toBeInstanceOf(UpstreamUnavailableError);
          expect(gateway.cancelCalls).toHaveLength(0);
          expect(await rowOf(tx, pickupId)).toEqual(before);
        }));
    });

    it('한진 게이트웨이가 아예 없으면 보낸 적 있는 활성은 502', () =>
      inRollbackTx(db, async (tx) => {
        const manager = new CustomerReturnPickupManager(scopedDbService(tx), new CarrierGatewayRegistry([]), config);
        const { channelReturnId } = await seedSent(tx, 'reserved');
        await expect(manager.release(channelReturnId, now)).rejects.toBeInstanceOf(UpstreamUnavailableError);
      }));
  });

  it('회수지 주소·이름·전화는 last_error·로그에 남지 않는다', () =>
    inRollbackTx(db, async (tx) => {
      const { gateway, manager } = wire(tx);
      const rejected = await seedPickup(tx, { originalWaybillNo: 'WB-A' });
      const unknown = await seedPickup(tx, { originalWaybillNo: 'WB-B' });
      gateway.reserveScript = (req) => {
        if (req.custOrdNo === rejected.custOrdNo) {
          return Promise.resolve({ kind: 'rejected', code: 'ERROR-14', reason: '지불조건 오류' });
        }
        return Promise.reject(
          new CarrierError('Hanjin request outcome is unknown: 502 - Bad Gateway', 'unknown_outcome', {
            carrier: 'hanjin',
            code: 'http_502',
          }),
        );
      };

      await manager.dispatchDue(now);
      expect(gateway.reserveCalls).toHaveLength(2);
      const texts = [
        (await rowOf(tx, rejected.pickupId)).lastError ?? '',
        (await rowOf(tx, unknown.pickupId)).lastError ?? '',
        ...logged,
      ].join('\n');
      for (const secret of Object.values(PII)) expect(texts).not.toContain(secret);
    }));
});
