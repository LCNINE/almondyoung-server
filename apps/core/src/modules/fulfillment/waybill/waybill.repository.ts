import { Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema, inventoryTables } from '../../inventory/schema/inventory.schema';
import { SupplierTrackingInUseError } from '../supplier-shipment/supplier-shipment.errors';
import { WAYBILL_DISPATCHABLE_STATUSES, WAYBILL_TERMINAL_STATUSES } from './waybill.constants';
import type { WaybillRow } from './waybill.types';

const T = inventoryTables.waybills;

@Injectable()
export class WaybillRepository {
  constructor(@InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>) {}

  async insertPending(
    trx: DbTx,
    row: {
      shipmentId: string;
      source: 'carrier';
      carrier: WaybillRow['carrier'];
      custOrdNo: string;
      manifestVersion: number;
      recipientHash: string;
    },
  ): Promise<WaybillRow> {
    const [wb] = await trx
      .insert(T)
      .values({ ...row, status: 'pending' })
      .returning();
    return wb;
  }

  async insertManualRegistered(
    trx: DbTx,
    row: {
      shipmentId: string;
      carrier: WaybillRow['carrier'];
      trackingNo: string;
      manifestVersion: number;
      recipientHash: string;
    },
  ): Promise<WaybillRow> {
    const [wb] = await trx
      .insert(T)
      .values({ ...row, source: 'manual', status: 'registered', issuedAt: new Date() })
      .returning();
    return wb;
  }

  /**
   * 입점사 상자의 수기 송장 — 입점사가 이미 보낸 소포라 `registered` 를 거치지 않고 곧장 `used` 다(K3, ADR-0050).
   * 살아 있는 송장번호 중복(`uq_waybills_tracking_live`)은 TRACKING_IN_USE 로 옮긴다.
   */
  async insertSupplierManualUsed(
    trx: DbTx,
    row: {
      shipmentId: string;
      carrier: WaybillRow['carrier'];
      trackingNo: string;
      manifestVersion: number;
      recipientHash: string;
    },
  ): Promise<{ id: string }> {
    const now = new Date();
    try {
      const [wb] = await trx
        .insert(T)
        .values({ ...row, source: 'manual', status: 'used', issuedAt: now })
        .returning({ id: T.id });
      return wb;
    } catch (e) {
      if (isUniqueViolationOn(e, 'uq_waybills_tracking_live')) {
        throw new SupplierTrackingInUseError(`Tracking number ${row.trackingNo} is already in use`);
      }
      throw e;
    }
  }

  async findById(trx: DbTx, id: string): Promise<WaybillRow | undefined> {
    const [wb] = await trx.select().from(T).where(eq(T.id, id)).limit(1);
    return wb;
  }

  async findActiveByShipment(trx: DbTx, shipmentId: string): Promise<WaybillRow | undefined> {
    const [wb] = await trx
      .select()
      .from(T)
      .where(and(eq(T.shipmentId, shipmentId), notInArray(T.status, [...WAYBILL_TERMINAL_STATUSES])))
      .limit(1);
    return wb;
  }

  async casToAllocated(
    trx: DbTx,
    id: string,
    trackingNo: string,
    labelData: Record<string, unknown>,
  ): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ trackingNo, labelData, status: 'allocated', updatedAt: new Date() })
      .where(and(eq(T.id, id), eq(T.status, 'pending')))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  async casToRegistered(trx: DbTx, id: string, issuedAt: Date): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'registered', issuedAt, updatedAt: new Date() })
      .where(and(eq(T.id, id), eq(T.status, 'allocated')))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  // 활성 waybill 을 registered/used → used. 멱등(used→used 매칭) + 엄격(0행이면 호출자가 예외).
  // DISPATCHABLE({registered,used})는 TERMINAL({voided,failed,abandoned})와 서로소이므로 notInArray(TERMINAL)
  // 은 no-op — inArray(DISPATCHABLE) 하나로 충분(중복 가드 제거, 최종리뷰 하드닝 #5).
  async casToUsed(trx: DbTx, shipmentId: string): Promise<number> {
    const rows = await trx
      .update(T)
      .set({ status: 'used', updatedAt: new Date() })
      .where(and(eq(T.shipmentId, shipmentId), inArray(T.status, [...WAYBILL_DISPATCHABLE_STATUSES])))
      .returning({ id: T.id });
    return rows.length;
  }

  async casToVoided(trx: DbTx, id: string, voidedAt: Date): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'voided', voidedAt, updatedAt: new Date() })
      .where(and(eq(T.id, id), eq(T.status, 'registered')))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  // recall 전용: used → voided. casToUsed 처럼 count-return(엄격 검증용) — 호출자(voidForRecall)가
  // affected !== 1 이면 예외를 던진다. WHERE 는 shipmentId + status='used' 만 매칭(registered 는 매칭 안 함 —
  // 그건 일반 casToVoided/void 의 영역).
  async casUsedToVoided(trx: DbTx, shipmentId: string, voidedAt: Date): Promise<number> {
    const rows = await trx
      .update(T)
      .set({ status: 'voided', voidedAt, updatedAt: new Date() })
      .where(and(eq(T.shipmentId, shipmentId), eq(T.status, 'used')))
      .returning({ id: T.id });
    return rows.length;
  }

  // lastError 는 선택 — 자동 abandon(pending CAP 초과)은 사유를 남기지 않던 기존 동작을 유지하고,
  // 운영자 abandon 은 사유를 반드시 넘긴다. 전달하지 않으면 기존 lastError 를 덮지 않는다.
  async casToAbandoned(
    trx: DbTx,
    id: string,
    fromStatus: 'pending' | 'allocated',
    lastError?: string,
  ): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'abandoned', updatedAt: new Date(), ...(lastError === undefined ? {} : { lastError }) })
      .where(and(eq(T.id, id), eq(T.status, fromStatus)))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  async casToFailed(trx: DbTx, id: string, lastError: string): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'failed', lastError, updatedAt: new Date() })
      .where(and(eq(T.id, id), inArray(T.status, ['pending', 'allocated'])))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  // 일시적 거절: pending 을 «유지»하면서 사유와 다음 재시도 시각을 남기고 전용 카운터를 올린다.
  // casToFailed 가 lastError 를 쓰는 유일한 경로였기 때문에, 이게 없으면 「pending 인데 왜 멈췄는지」를
  // 기록할 방법이 없다. WHERE status='pending' — allocated 로 넘어간 행을 되돌리지 않는다.
  async casToTransientPending(trx: DbTx, id: string, lastError: string, nextAttemptAt: Date): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({
        lastError,
        nextAttemptAt,
        transientAttempts: sql`${T.transientAttempts} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(T.id, id), eq(T.status, 'pending')))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  async incrementAttempts(trx: DbTx, id: string): Promise<void> {
    await trx
      .update(T)
      .set({ attempts: sql`${T.attempts} + 1`, updatedAt: new Date() })
      .where(eq(T.id, id));
  }
}

// drizzle 이 driver 에러를 DrizzleQueryError 로 감싸므로 `.cause` 체인에서 제약 이름까지 확인한다.
function isUniqueViolationOn(e: unknown, constraint: string): boolean {
  let current: unknown = e;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const row = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (row.code === '23505' && (row.constraint_name === undefined || row.constraint_name === constraint)) return true;
    current = row.cause;
  }
  return false;
}
