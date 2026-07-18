import { Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema, inventoryTables } from '../../inventory/schema/inventory.schema';
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

  async casToAbandoned(trx: DbTx, id: string, fromStatus: 'pending' | 'allocated'): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'abandoned', updatedAt: new Date() })
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

  async incrementAttempts(trx: DbTx, id: string): Promise<void> {
    await trx
      .update(T)
      .set({ attempts: sql`${T.attempts} + 1`, updatedAt: new Date() })
      .where(eq(T.id, id));
  }
}
