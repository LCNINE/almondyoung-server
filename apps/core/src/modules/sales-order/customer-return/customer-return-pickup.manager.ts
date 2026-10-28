import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { BadRequestError, ConflictError, NotFoundError, UpstreamUnavailableError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CarrierGatewayRegistry } from '../../fulfillment/waybill/carrier/carrier-gateway.registry';
import {
  CarrierError,
  type CarrierGateway,
  type PickupCancelOutcome,
  type PickupRequest,
  type PickupReserveOutcome,
} from '../../fulfillment/waybill/carrier/carrier-gateway.interface';
import type { HanjinConfig } from '../../fulfillment/waybill/carrier/hanjin/hanjin.config';
import { HANJIN_CONFIG } from '../../fulfillment/waybill/waybill.tokens';
import { readPickupSource } from './customer-return-pickup-source.reader';
import { assemblePickupRequest } from './customer-return-pickup-request';
import { ACTIVE_PICKUP_STATUSES, newPickupRow, type PickupRow } from './customer-return-pickup.types';

export const PICKUP_ATTEMPTS_CAP = 12;
export const PICKUP_LEASE_MS = 120_000;
const DISPATCH_BATCH = 20;
/** 워커가 보내는 상태 — pending 은 예약, cancel_pending 은 취소 */
const DUE_STATUSES = ['pending', 'cancel_pending'] as const;
const BACKOFF_CAP_MINUTES = 60;

/** 다음 시도 시각 = now + min(2^(attempts−1), 60)분. attempts 는 방금 실패한 시도까지 센 값 */
export function nextPickupAttemptAt(now: Date, attempts: number): Date {
  const minutes = Math.min(2 ** Math.max(attempts - 1, 0), BACKOFF_CAP_MINUTES);
  return new Date(now.getTime() + minutes * 60_000);
}

/** 회수 두 메서드를 가진 게이트웨이 — 선택 메서드의 유무가 능력이다 */
type PickupGateway = CarrierGateway & Required<Pick<CarrierGateway, 'reservePickup' | 'cancelPickup'>>;

function canPickup(gateway: CarrierGateway): gateway is PickupGateway {
  return typeof gateway.reservePickup === 'function' && typeof gateway.cancelPickup === 'function';
}

/** 잡은 행 — 결과 CAS 가 «내가 잡은 그대로»인지 볼 리스 값을 함께 든다 */
type Claimed = PickupRow & { leaseUntil: Date };

type PickupUpdate = Partial<typeof wmsTables.customerReturnPickups.$inferInsert>;

/**
 * 반품 회수 워커 (K8 PR9, 설계 §4.7 N4·N5). 한진 회수 예약·취소를 트랜잭션 밖에서 보낸다.
 * 한 행마다 ① 짧은 트랜잭션으로 리스를 잡고 ② 트랜잭션 밖에서 본문을 읽어 한진을 부르고
 * ③ 잡은 상태·리스 그대로일 때만 결과를 적는다 — 그 사이 놓아주기(release)·취소 정리가 행을 바꿨으면 덮어쓰지 않는다.
 * 회수지 주소·이름·전화는 한진 본문에만 싣는다. 행·로그에는 id·custOrdNo·한진 코드만 남긴다.
 */
@Injectable()
export class CustomerReturnPickupManager {
  private readonly logger = new Logger(CustomerReturnPickupManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly registry: CarrierGatewayRegistry,
    @Inject(HANJIN_CONFIG)
    private readonly config: HanjinConfig,
  ) {}

  /**
   * 기한 된 pending·cancel_pending 을 최대 limit 개 처리한다. 게이트웨이가 미설정이면 아무것도 읽지 않고 0.
   * sent = 회수 운송장을 받은 예약 수, cancelled = 한진 취소를 끝낸 행 수.
   * 행은 순서대로 보낸다 — 주문 API 는 호출 제한이 없고, 페이서는 게이트웨이 몫이 아니다.
   */
  async dispatchDue(now: Date, limit: number = DISPATCH_BATCH): Promise<{ sent: number; cancelled: number }> {
    const gateway = this.registry.get('HANJIN');
    const result = { sent: 0, cancelled: 0 };
    if (!gateway?.isPickupConfigured?.() || !canPickup(gateway)) return result;

    const dueIds = await this.dbService.run((trx) => this.findDue(trx, now, limit));
    for (const id of dueIds) {
      try {
        const claimed = await this.dbService.run((trx) => this.claimDue(trx, id, now));
        if (!claimed?.leaseUntil) continue; // 그 사이 다른 쪽이 잡았거나 다시 미뤘거나 끝냈다
        const row: Claimed = { ...claimed, leaseUntil: claimed.leaseUntil };
        if (row.status === 'pending') {
          if (await this.sendReservation(gateway, row, now)) result.sent += 1;
        } else if (row.status === 'cancel_pending') {
          if ((await this.sendCancellation(gateway, row, now)) === 'cancelled') result.cancelled += 1;
        }
      } catch (error) {
        // 결과 기록(DB)이 실패했다. 리스는 만료되면 다시 잡힌다 — 다음 행은 계속 보낸다
        this.logger.error(
          `[ReturnPickup] pickup ${id} dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return result;
  }

  /**
   * CS [회수 다시 접수] (N9, 규칙 R3). 반품이 expected 이고 활성 회수가 없을 때만.
   * 마지막 행이 failed 면 «같은 행»을 pending 으로 되살린다 — 사유(last_error)와 무관하게. 한진은 거절했던 custOrdNo 도
   * 다시 받고, 앞선 전송이 실제로 접수됐다면 ERROR-03 + wblNo 가 번호를 되찾아 주므로 택배가 둘 생기지 않는다.
   * 새 행(새 번호)은 마지막 행이 cancelled·void 이거나 행이 없을 때뿐이다 — 취소한 번호는 못 쓴다.
   * failed 행의 리스가 살아 있으면 놓아주기가 한진에 취소를 보내는 중일 수 있어 건드리지 않는다(409).
   * 반품 행을 잠가 같은 반품의 동시 접수를 줄 세운다 — 활성 부분 유니크 위반(500)이 아니라 409 가 된다.
   */
  async retry(customerReturnId: string, actorId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const now = new Date();
      const r = wmsTables.customerReturns;
      const [record] = await trx
        .select({ id: r.id, status: r.status })
        .from(r)
        .where(eq(r.id, customerReturnId))
        .for('update')
        .limit(1);
      if (!record) throw new NotFoundError(`Customer return not found: ${customerReturnId}`);
      if (record.status !== 'expected') {
        throw new ConflictError(`Cannot re-request pickup: return is ${record.status}, not expected`);
      }

      const t = wmsTables.customerReturnPickups;
      const [active] = await trx
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.customerReturnId, customerReturnId), inArray(t.status, [...ACTIVE_PICKUP_STATUSES])))
        .limit(1);
      if (active) {
        throw new ConflictError(`Cannot re-request pickup: return ${customerReturnId} already has an active pickup`);
      }

      const [latest] = await trx
        .select()
        .from(t)
        .where(eq(t.customerReturnId, customerReturnId))
        .orderBy(desc(t.createdAt), desc(t.id))
        .limit(1);
      if (latest?.status === 'failed') {
        const revived = await trx
          .update(t)
          .set({
            status: 'pending',
            attempts: 0,
            lastError: null,
            nextAttemptAt: null,
            leaseUntil: null,
            updatedAt: now,
          })
          .where(and(eq(t.id, latest.id), eq(t.status, 'failed'), or(isNull(t.leaseUntil), lt(t.leaseUntil, now))))
          .returning({ id: t.id });
        if (revived.length === 0) {
          throw new ConflictError(`pickup_busy: pickup ${latest.id} is being released; retry after lease`);
        }
        return;
      }
      await trx.insert(t).values(newPickupRow(customerReturnId, actorId));
    }, tx);
  }

  /**
   * 반품 취소 전 회수 놓아주기 (N6). Medusa 가 반품을 취소하기 전에 동기로 부른다 — 한진 예약을 먼저 없애야
   * 취소된 반품의 소포가 기록 없이 창고로 오지 않는다. released = 한진에 회수가 없다(취소해도 된다),
   * picked_up = 기사가 이미 집하했다(취소 거절). 판정할 수 없으면 409(누가 보내는 중)·502(한진 취소 실패) —
   * Medusa 는 둘 다 «판정 불가»로 읽고 반품을 그대로 둔다.
   */
  async release(channelReturnId: string, now: Date): Promise<{ result: 'released' | 'picked_up' }> {
    const target = await this.dbService.run((trx) => this.findReleaseTarget(trx, channelReturnId));
    if (target.kind !== 'pickup') return { result: target.kind };
    const pickup = target.pickup;

    if (pickup.leaseUntil && pickup.leaseUntil >= now) {
      throw new ConflictError(`pickup_busy: pickup ${pickup.id} is being sent; retry after lease`);
    }
    if (pickup.status === 'pending' && pickup.attempts === 0) {
      // 한진에 한 번도 안 보냈다 — 잡지 않고(attempts 를 올리지 않고) 바로 void. 그 사이 워커가 잡았으면 빗나간다
      if (await this.dbService.run((trx) => this.voidUnsent(trx, pickup.id, now))) return { result: 'released' };
      throw new ConflictError(`pickup_busy: pickup ${pickup.id} was claimed while releasing`);
    }

    const gateway = this.registry.get('HANJIN');
    if (!gateway?.isPickupConfigured?.() || !canPickup(gateway)) {
      throw new UpstreamUnavailableError(
        `pickup_cancel_unavailable: pickup ${pickup.id} sent but carrier not configured`,
      );
    }
    const claimed = await this.dbService.run((trx) =>
      pickup.status === 'failed' ? this.claimFailed(trx, pickup.id, now) : this.claim(trx, pickup.id, now),
    );
    if (!claimed?.leaseUntil) {
      throw new ConflictError(`pickup_busy: pickup ${pickup.id} changed while releasing`);
    }
    const outcome = await this.sendCancellation(gateway, { ...claimed, leaseUntil: claimed.leaseUntil }, now);
    if (outcome === 'failed') {
      throw new UpstreamUnavailableError(`pickup_cancel_unavailable: pickup ${pickup.id} cancel not confirmed`);
    }
    return { result: outcome === 'cancelled' ? 'released' : 'picked_up' };
  }

  /**
   * 놓아주기 대상. 기록이 없으면(요청 관측 지연) 회수도 없다 → released.
   * 반품이 이미 도착·검수 쪽으로 갔으면 소포는 기사 손을 떠났다 → 한진을 묻지 않고 picked_up.
   * 활성 행이 없어도 마지막 행이 «예약이 남아 있을 수 있는 failed»면 그 행을 대상으로 돌려준다(R6).
   */
  private async findReleaseTarget(
    trx: DbTx,
    channelReturnId: string,
  ): Promise<{ kind: 'released' | 'picked_up' } | { kind: 'pickup'; pickup: PickupRow }> {
    const r = wmsTables.customerReturns;
    const [record] = await trx
      .select({ id: r.id, status: r.status })
      .from(r)
      .where(eq(r.channelReturnId, channelReturnId))
      .limit(1);
    if (!record) return { kind: 'released' };
    if (record.status !== 'expected' && record.status !== 'cancelled') return { kind: 'picked_up' };

    const t = wmsTables.customerReturnPickups;
    const [active] = await trx
      .select()
      .from(t)
      .where(and(eq(t.customerReturnId, record.id), inArray(t.status, [...ACTIVE_PICKUP_STATUSES])))
      .limit(1);
    if (active) return { kind: 'pickup', pickup: active };

    const [latest] = await trx
      .select()
      .from(t)
      .where(eq(t.customerReturnId, record.id))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(1);
    return latest && mayHoldReservation(latest) ? { kind: 'pickup', pickup: latest } : { kind: 'released' };
  }

  /** 한 번도 안 보낸 pending 을 void 로 — 취소 정리(tidyActivePickup)와 같은 조건. 바꿨으면 true */
  private async voidUnsent(trx: DbTx, pickupId: string, now: Date): Promise<boolean> {
    const t = wmsTables.customerReturnPickups;
    const voided = await trx
      .update(t)
      .set({ status: 'void', leaseUntil: null, updatedAt: now })
      .where(
        and(
          eq(t.id, pickupId),
          eq(t.status, 'pending'),
          eq(t.attempts, 0),
          or(isNull(t.leaseUntil), lt(t.leaseUntil, now)),
        ),
      )
      .returning({ id: t.id });
    return voided.length > 0;
  }

  /**
   * 활성 행(pending·reserved·cancel_pending) 하나를 기한과 무관하게 리스로 잡는다 — 놓아주기(release)용.
   * 못 잡으면 null. 상태는 바꾸지 않는다.
   * 잡는 것 = 한진에 보내려는 것이라 attempts 를 여기서 올린다 — 보내다 죽은 워커도 attempts ≥ 1 을 남겨,
   * 취소 정리(«pending ∧ attempts 0 ∧ 리스 없음»이면 void)가 한진에 있을지 모르는 예약을 지나치지 않게 한다.
   */
  async claim(trx: DbTx, pickupId: string, now: Date): Promise<PickupRow | null> {
    const t = wmsTables.customerReturnPickups;
    return this.claimWhere(trx, pickupId, now, inArray(t.status, [...ACTIVE_PICKUP_STATUSES]));
  }

  /**
   * 놓아주기용 failed 행 잡기(R6) — 한진에 예약이 남아 있을지 모르는 failed 를 취소하러 잡는다. 워커는 failed 를
   * 잡지 않으니(claimDue) 이 길은 워커와 겹치지 않는다. 그 밖은 `claim` 과 같다.
   */
  private async claimFailed(trx: DbTx, pickupId: string, now: Date): Promise<PickupRow | null> {
    const t = wmsTables.customerReturnPickups;
    return this.claimWhere(trx, pickupId, now, eq(t.status, 'failed'));
  }

  /**
   * 워커용 잡기 — 보낼 차례인 행만 잡는다(pending·cancel_pending ∧ 기한 됨). 목록을 읽은 뒤 다른 워커가 이미
   * 보내고 다음 시도를 미뤘거나 reserved 로 끝낸 행을 다시 잡지 않는다. 그 밖은 `claim` 과 같다.
   */
  async claimDue(trx: DbTx, pickupId: string, now: Date): Promise<PickupRow | null> {
    const t = wmsTables.customerReturnPickups;
    return this.claimWhere(
      trx,
      pickupId,
      now,
      and(inArray(t.status, [...DUE_STATUSES]), or(isNull(t.nextAttemptAt), lte(t.nextAttemptAt, now))),
    );
  }

  private async claimWhere(trx: DbTx, pickupId: string, now: Date, scope: SQL | undefined): Promise<PickupRow | null> {
    const t = wmsTables.customerReturnPickups;
    const [row] = await trx
      .update(t)
      .set({
        leaseUntil: new Date(now.getTime() + PICKUP_LEASE_MS),
        attempts: sql`${t.attempts} + 1`,
        updatedAt: now,
      })
      .where(and(eq(t.id, pickupId), scope, or(isNull(t.leaseUntil), lt(t.leaseUntil, now))))
      .returning();
    return row ?? null;
  }

  private async findDue(trx: DbTx, now: Date, limit: number): Promise<string[]> {
    const t = wmsTables.customerReturnPickups;
    const rows = await trx
      .select({ id: t.id })
      .from(t)
      .where(
        and(
          inArray(t.status, [...DUE_STATUSES]),
          or(isNull(t.nextAttemptAt), lte(t.nextAttemptAt, now)),
          or(isNull(t.leaseUntil), lt(t.leaseUntil, now)),
        ),
      )
      .orderBy(sql`${t.nextAttemptAt} asc nulls first`, t.createdAt)
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /** 예약을 보낸다. 회수 운송장을 받아 적었으면 true */
  private async sendReservation(gateway: PickupGateway, row: Claimed, now: Date): Promise<boolean> {
    let originalWaybillNo: string | null;
    let outcome: PickupReserveOutcome;
    try {
      const source = await this.dbService.run((trx) => readPickupSource(trx, row.customerReturnId));
      if (source.kind === 'no_delivered_shipment') {
        await this.fail(row, 'no_pickup_address: no delivered shipment', now);
        return false;
      }
      let request: PickupRequest;
      try {
        request = assemblePickupRequest(source, this.config, row.custOrdNo);
      } catch (error) {
        // RECIPIENT_INCOMPLETE — 메시지는 빠진 칸 이름뿐이지만 주소 칸 값이 섞일 일이 없게 고정 문구로 적는다
        if (error instanceof BadRequestError) {
          await this.fail(row, 'no_pickup_address: recipient snapshot incomplete', now);
          return false;
        }
        throw error;
      }
      originalWaybillNo = source.originalWaybillNo;
      outcome = await gateway.reservePickup(request);
    } catch (error) {
      await this.reservationFailed(row, error, now);
      return false;
    }

    if (outcome.kind === 'rejected') {
      await this.fail(row, `${outcome.code}: ${outcome.reason}`, now);
      return false;
    }
    const written = await this.settle(
      row,
      {
        status: 'reserved',
        waybillNo: outcome.waybillNo,
        originalWaybillNo,
        reservedAt: now,
        nextAttemptAt: null,
        lastError: null,
      },
      now,
      outcome.kind,
    );
    if (!written) await this.keepWaybillForCancel(row, outcome.waybillNo, originalWaybillNo, now);
    return written;
  }

  /**
   * 보내는 사이 취소 정리가 행을 cancel_pending 으로 돌렸다. 한진엔 예약이 생겼으니 번호만은 남긴다 —
   * 그래야 취소가 picked_up 으로 끝나 reserved 로 돌아가도 창고가 회수 운송장으로 반품을 연다.
   * 상태는 그대로 두고 리스만 푼다 → 다음 틱이 취소한다.
   */
  private async keepWaybillForCancel(
    row: Claimed,
    waybillNo: string,
    originalWaybillNo: string | null,
    now: Date,
  ): Promise<void> {
    const t = wmsTables.customerReturnPickups;
    const kept = await this.dbService.run((trx) =>
      trx
        .update(t)
        .set({ waybillNo, originalWaybillNo, reservedAt: now, leaseUntil: null, updatedAt: now })
        .where(
          and(eq(t.id, row.id), eq(t.leaseUntil, row.leaseUntil), eq(t.status, 'cancel_pending'), isNull(t.waybillNo)),
        )
        .returning({ id: t.id }),
    );
    if (kept.length > 0) {
      this.logger.warn(
        `[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) reserved after cancel; waybill kept for cancel`,
      );
    }
  }

  /**
   * 예약이 결과 없이 끝났다. 결과를 모르거나(전송 오류·타임아웃) 잠시 막힌(-103) 것이면 같은 행·같은 custOrdNo 로
   * 다시 보낸다 — 한진이 ERROR-03 + 처음 번호로 성공을 되찾아 준다. attempts 는 잡을 때 이미 올렸다.
   */
  private async reservationFailed(row: Claimed, error: unknown, now: Date): Promise<void> {
    const detail = failureDetail(error);
    if (error instanceof CarrierError && error.outcome === 'definitive_rejection') {
      await this.fail(row, detail, now);
      return;
    }
    if (row.attempts >= PICKUP_ATTEMPTS_CAP) {
      this.logger.error(`[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) gave up after ${row.attempts}: ${detail}`);
      await this.fail(row, `attempts_exhausted: ${detail}`, now);
      return;
    }
    this.logger.warn(`[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) attempt ${row.attempts} failed: ${detail}`);
    await this.settle(row, { nextAttemptAt: nextPickupAttemptAt(now, row.attempts), lastError: detail }, now, 'retry');
  }

  /**
   * 취소를 보낸다 — 워커(cancel_pending)와 놓아주기(어느 활성 상태든)가 같이 쓴다.
   * cancelled = 한진에서 회수가 사라졌다(그 사이 다른 쪽이 행을 바꿔 결과를 못 적었어도 한진 쪽 사실은 같다),
   * picked_up = 기사가 이미 집하했다, failed = 모르거나 거절 — 상태 그대로 리스만 풀린다.
   */
  private async sendCancellation(
    gateway: PickupGateway,
    row: Claimed,
    now: Date,
  ): Promise<'cancelled' | 'picked_up' | 'failed'> {
    let outcome: PickupCancelOutcome;
    try {
      outcome = await gateway.cancelPickup(row.custOrdNo);
    } catch (error) {
      await this.cancellationFailed(row, failureDetail(error), now);
      return 'failed';
    }
    switch (outcome.kind) {
      case 'cancelled':
      case 'already_cancelled':
      case 'not_found':
        await this.settle(
          row,
          { status: 'cancelled', cancelledAt: now, nextAttemptAt: null, lastError: null },
          now,
          outcome.kind,
        );
        return 'cancelled';
      case 'picked_up':
        if (row.status === 'cancel_pending') {
          // 반품은 이미 취소됐는데 기사가 집하했다 — 취소된 반품의 소포가 창고로 온다. 사람이 받아 처리해야 한다
          this.logger.error(
            `[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) of cancelled return ${row.customerReturnId} ` +
              `was already picked up; the parcel will arrive: ${outcome.reason}`,
          );
        } else {
          // 놓아주기 — 반품 취소가 거절되고 반품은 그대로 진행된다
          this.logger.warn(
            `[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) already picked up; return cancel refused: ${outcome.reason}`,
          );
        }
        await this.settle(
          row,
          { status: 'reserved', pickedUpAt: now, nextAttemptAt: null, lastError: `picked_up: ${outcome.reason}` },
          now,
          outcome.kind,
        );
        return 'picked_up';
      case 'rejected':
        await this.cancellationFailed(row, `${outcome.code}: ${outcome.reason}`, now);
        return 'failed';
    }
  }

  /**
   * 취소가 안 됐다. 한진에 예약이 남아 있을 수 있으니 끝난 상태로 보내지 않는다 — cancel_pending 이면 워커가 계속
   * 다시 묻고, 놓아주기가 잡은 다른 활성 상태는 그대로 둔다(반품 취소가 502 로 거절돼 반품이 그대로다).
   * 상한을 넘으면 사람이 보도록 error 로그만 더한다.
   */
  private async cancellationFailed(row: Claimed, detail: string, now: Date): Promise<void> {
    if (row.status === 'failed') {
      // 놓아주기가 잡은 failed — last_error 를 덮지 않는다. «attempts_exhausted:» 가 남아야 다시 접수가 같은 행
      // (같은 번호)을 되살린다(N9). 다음 시도도 없다 — 리스만 푼다
      this.logger.warn(`[ReturnPickup] failed pickup ${row.id} (${row.custOrdNo}) cancel not confirmed: ${detail}`);
      await this.settle(row, {}, now, 'retry');
      return;
    }
    if (row.attempts >= PICKUP_ATTEMPTS_CAP) {
      this.logger.error(
        `[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) still not cancelled after ${row.attempts}: ${detail}`,
      );
    } else {
      this.logger.warn(`[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) cancel attempt ${row.attempts}: ${detail}`);
    }
    await this.settle(row, { nextAttemptAt: nextPickupAttemptAt(now, row.attempts), lastError: detail }, now, 'retry');
  }

  private async fail(row: Claimed, lastError: string, now: Date): Promise<void> {
    await this.settle(row, { status: 'failed', nextAttemptAt: null, lastError }, now, 'failed');
  }

  /** 잡은 상태·리스 그대로일 때만 적고 리스를 푼다. 적었으면 true */
  private async settle(row: Claimed, set: PickupUpdate, now: Date, label: string): Promise<boolean> {
    const t = wmsTables.customerReturnPickups;
    const written = await this.dbService.run((trx) =>
      trx
        .update(t)
        .set({ ...set, leaseUntil: null, updatedAt: now })
        .where(and(eq(t.id, row.id), eq(t.status, row.status), eq(t.leaseUntil, row.leaseUntil)))
        .returning({ id: t.id }),
    );
    if (written.length === 0) {
      this.logger.warn(
        `[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) changed while sending; outcome ${label} not written`,
      );
      return false;
    }
    return true;
  }
}

/**
 * failed 인데 한진에 예약이 남아 있을 수 있나(R6). 한 번이라도 보냈고(attempts ≥ 1) 주소가 없어 보내지도 못한
 * 실패(no_pickup_address:)가 아니면 그렇다 — attempts_exhausted:(결과 모름), ERROR-03 인데 번호 없음 등.
 */
function mayHoldReservation(row: PickupRow): boolean {
  return row.status === 'failed' && row.attempts >= 1 && !(row.lastError ?? '').startsWith('no_pickup_address:');
}

/** last_error·로그용 요약 — 코드만 싣는다(한진 응답 본문·요청 값은 싣지 않는다) */
function failureDetail(error: unknown): string {
  if (error instanceof CarrierError) {
    return `${error.outcome}: ${error.details.code ?? (error.details.httpStatus ? `http_${error.details.httpStatus}` : 'no_code')}`;
  }
  return `internal_error: ${error instanceof Error ? error.name : 'unknown'}`;
}
