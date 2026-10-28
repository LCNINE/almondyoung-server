import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { BadRequestError } from '@app/shared';
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
import { ACTIVE_PICKUP_STATUSES, type PickupRow } from './customer-return-pickup.types';

export const PICKUP_ATTEMPTS_CAP = 12;
export const PICKUP_LEASE_MS = 120_000;
const DISPATCH_BATCH = 20;
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
        const claimed = await this.dbService.run((trx) => this.claim(trx, id, now));
        if (!claimed?.leaseUntil) continue; // 그 사이 다른 쪽이 잡았거나 끝냈다
        const row: Claimed = { ...claimed, leaseUntil: claimed.leaseUntil };
        if (row.status === 'pending') {
          if (await this.sendReservation(gateway, row, now)) result.sent += 1;
        } else if (row.status === 'cancel_pending') {
          if (await this.sendCancellation(gateway, row, now)) result.cancelled += 1;
        } else {
          // reserved 는 워커가 보낼 것이 없다 — 잡은 리스만 돌려놓는다
          await this.settle(row, {}, now, 'unclaimed');
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
   * 한 행을 리스로 잡는다. 못 잡으면 null. 상태는 바꾸지 않는다.
   * 잡는 것 = 한진에 보내려는 것이라 attempts 를 여기서 올린다 — 보내다 죽은 워커도 attempts ≥ 1 을 남겨,
   * 취소 정리(«pending ∧ attempts 0 ∧ 리스 없음»이면 void)가 한진에 있을지 모르는 예약을 지나치지 않게 한다.
   */
  async claim(trx: DbTx, pickupId: string, now: Date): Promise<PickupRow | null> {
    const t = wmsTables.customerReturnPickups;
    const [row] = await trx
      .update(t)
      .set({
        leaseUntil: new Date(now.getTime() + PICKUP_LEASE_MS),
        attempts: sql`${t.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(t.id, pickupId),
          inArray(t.status, [...ACTIVE_PICKUP_STATUSES]),
          or(isNull(t.leaseUntil), lt(t.leaseUntil, now)),
        ),
      )
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
          inArray(t.status, ['pending', 'cancel_pending']),
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
    return this.settle(
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

  /** 취소를 보낸다. 한진에서 회수가 사라졌으면 true */
  private async sendCancellation(gateway: PickupGateway, row: Claimed, now: Date): Promise<boolean> {
    let outcome: PickupCancelOutcome;
    try {
      outcome = await gateway.cancelPickup(row.custOrdNo);
    } catch (error) {
      await this.cancellationFailed(row, failureDetail(error), now);
      return false;
    }
    switch (outcome.kind) {
      case 'cancelled':
      case 'already_cancelled':
      case 'not_found':
        return this.settle(
          row,
          { status: 'cancelled', cancelledAt: now, nextAttemptAt: null, lastError: null },
          now,
          outcome.kind,
        );
      case 'picked_up':
        // 기사가 이미 집하했다 — 취소된 반품의 소포가 창고로 온다. 사람이 받아 처리해야 한다
        this.logger.error(
          `[ReturnPickup] pickup ${row.id} (${row.custOrdNo}) of cancelled return ${row.customerReturnId} ` +
            `was already picked up; the parcel will arrive: ${outcome.reason}`,
        );
        await this.settle(
          row,
          { status: 'reserved', pickedUpAt: now, nextAttemptAt: null, lastError: `picked_up: ${outcome.reason}` },
          now,
          outcome.kind,
        );
        return false;
      case 'rejected':
        await this.cancellationFailed(row, `${outcome.code}: ${outcome.reason}`, now);
        return false;
    }
  }

  /**
   * 취소가 안 됐다. 한진에 예약이 남아 있을 수 있으니 끝난 상태로 보내지 않고 cancel_pending 에서 계속 다시 묻는다.
   * 상한을 넘으면 사람이 보도록 error 로그만 더한다.
   */
  private async cancellationFailed(row: Claimed, detail: string, now: Date): Promise<void> {
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

/** last_error·로그용 요약 — 코드만 싣는다(한진 응답 본문·요청 값은 싣지 않는다) */
function failureDetail(error: unknown): string {
  if (error instanceof CarrierError) {
    return `${error.outcome}: ${error.details.code ?? (error.details.httpStatus ? `http_${error.details.httpStatus}` : 'no_code')}`;
  }
  return `internal_error: ${error instanceof Error ? error.name : 'unknown'}`;
}
