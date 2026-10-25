import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { ShipmentRow } from '../services/shipment-aggregate';
import {
  assertLegalTransition,
  isSupplierOnlyTransition,
  RecoveryCode,
  ShipmentStatus,
  transitionEffect,
} from './shipment-transitions';
import { ownerColumns, type ShipmentOwner } from './shipment-owner';

export type ShipmentLineRecord = typeof wmsTables.shipmentLines.$inferSelect;

/** 0행(또는 일부만 맞음)일 때: 'unreachable' = 내부 Error, 'ignore' = 갱신된 행만 돌려준다, 함수 = 그 에러를 던진다(호출자 코드 보존). */
export type StaleRowPolicy = 'unreachable' | 'ignore' | (() => Error);

export interface ShipmentTransition {
  shipmentIds: readonly string[];
  from: readonly ShipmentStatus[];
  to: ShipmentStatus;
  /** to === 'recovery_required' 이면 필수, 아니면 금지 */
  recoveryCode?: RecoveryCode;
  /** from 에 recovery_required 가 있으면 recoveryCode 필수 */
  expect?: { recoveryCode?: RecoveryCode; manifestVersion?: number };
  /** to === 'planned' 이면 필수, 아니면 금지 */
  shippingProfileId?: string;
  /** stamp·lastUpdated. 기본 new Date() */
  at?: Date;
  stale: StaleRowPolicy;
}

/** 상자 상태를 바꾸는 유일한 문. 표에 없는 전이는 SQL 전에 Error. */
export async function transitionShipments(tx: DbTx, t: ShipmentTransition): Promise<ShipmentRow[]> {
  const ids = [...new Set(t.shipmentIds)];
  validate(t);
  if (ids.length === 0) return [];

  const at = t.at ?? new Date();
  const effect = transitionEffect(t.to);
  const s = wmsTables.shipments;

  const set: PgUpdateSetSource<typeof s> = { status: t.to, lastUpdated: at };
  if (effect.stamp) set[effect.stamp] = at;
  for (const c of effect.clears) set[c] = null;
  if (t.to === 'recovery_required') set.recoveryCode = t.recoveryCode;
  if (t.to === 'planned') {
    set.shippingProfileId = t.shippingProfileId;
    set.manifestVersion = sql`${s.manifestVersion} + CASE WHEN ${s.shippingProfileId} IS DISTINCT FROM ${t.shippingProfileId} THEN 1 ELSE 0 END`;
  } else if (effect.bumpsManifest) {
    set.manifestVersion = sql`${s.manifestVersion} + 1`;
  }

  const conds = [inArray(s.id, ids), inArray(s.status, [...t.from])];
  if (t.expect?.recoveryCode !== undefined) {
    conds.push(sql`(${ne(s.status, 'recovery_required')} OR ${eq(s.recoveryCode, t.expect.recoveryCode)})`);
  }
  if (t.expect?.manifestVersion !== undefined) conds.push(eq(s.manifestVersion, t.expect.manifestVersion));
  // 입점사 전용 행(draft→shipped)이 적용되는 호출이면 창고 상자는 CAS 에서 걸러진다.
  if (t.from.some((f) => isSupplierOnlyTransition(f, t.to))) conds.push(isNotNull(s.supplierId));

  const rows = await tx
    .update(s)
    .set(set)
    .where(and(...conds))
    .returning();

  if (rows.length < ids.length) {
    if (t.stale === 'unreachable') {
      throw new Error(`Shipment transition matched ${rows.length}/${ids.length} rows: ${t.from.join('|')} -> ${t.to}`);
    }
    if (typeof t.stale === 'function') throw t.stale();
  }

  if (effect.resetsInspection && rows.length > 0) {
    const l = wmsTables.shipmentLines;
    await tx
      .update(l)
      .set({ inspectedQty: 0, forced: false, lineVersion: sql`${l.lineVersion} + 1` })
      .where(
        and(
          inArray(
            l.shipmentId,
            rows.map((r) => r.id),
          ),
          or(sql`${l.inspectedQty} > 0`, eq(l.forced, true)),
        ),
      );
  }
  return rows;
}

function validate(t: ShipmentTransition): void {
  if (t.to === 'recovery_required' && !t.recoveryCode) {
    throw new Error('transitionShipments: recoveryCode is required when to=recovery_required');
  }
  if (t.to !== 'recovery_required' && t.recoveryCode) {
    throw new Error('transitionShipments: recoveryCode is only allowed when to=recovery_required');
  }
  if (t.to === 'planned' && !t.shippingProfileId) {
    throw new Error('transitionShipments: shippingProfileId is required when to=planned');
  }
  if (t.to !== 'planned' && t.shippingProfileId) {
    throw new Error('transitionShipments: shippingProfileId is only allowed when to=planned');
  }
  if (t.from.length === 0) throw new Error('transitionShipments: from must not be empty');
  for (const f of t.from) {
    if (f === 'recovery_required' && !t.expect?.recoveryCode) {
      throw new Error('transitionShipments: expect.recoveryCode is required when from includes recovery_required');
    }
    assertLegalTransition(f, t.to, {
      fromCode: f === 'recovery_required' ? t.expect?.recoveryCode : undefined,
      toCode: t.recoveryCode,
    });
  }
}

export interface NewShipment {
  owner: ShipmentOwner;
  status: 'draft' | 'canceled';
  shippingProfileId: string | null;
  recipientSnapshot: unknown;
  entrancePassword: string | null;
  openedBy?: string | null;
  openedAt?: Date;
  /** 입점사 상자만 — 나눈 상자가 원래 상자의 넘김 기록을 물려받는다(composite FK 가 supplier_id 와 짝을 지킨다) */
  supplierHandoffId?: string | null;
}

export interface NewShipmentLine {
  fulfillmentOrderItemId: string;
  skuId: string;
  qty: number;
  createdFromLineId?: string | null;
  demandRequestedAt?: Date | null;
  createdAt?: Date;
}

/** 새 상자와 줄을 한 번에. manifestVersion·reservationVersion 은 1. 예약은 부르는 쪽 몫. */
export async function openShipment(
  tx: DbTx,
  box: NewShipment,
  lines: readonly NewShipmentLine[],
): Promise<{ shipment: ShipmentRow; lines: ShipmentLineRecord[] }> {
  const shipment = await insertShipment(tx, box);
  const inserted: ShipmentLineRecord[] = [];
  for (const line of lines) inserted.push(await insertShipmentLine(tx, shipment.id, line));
  return { shipment, lines: inserted };
}

/** Task 6 의 쓰기 도구가 쓴다. 커널 폴더 밖에서 import 하면 가드(shipment-writes.guard.spec.ts)가 위반으로 잡는다. */
export async function insertShipment(tx: DbTx, box: NewShipment): Promise<ShipmentRow> {
  const [row] = await tx
    .insert(wmsTables.shipments)
    .values({
      ...ownerColumns(box.owner),
      status: box.status,
      shippingProfileId: box.shippingProfileId,
      recipientSnapshot: box.recipientSnapshot,
      entrancePassword: box.entrancePassword,
      manifestVersion: 1,
      reservationVersion: 1,
      ...(box.supplierHandoffId !== undefined ? { supplierHandoffId: box.supplierHandoffId } : {}),
      ...(box.openedBy !== undefined ? { openedBy: box.openedBy } : {}),
      ...(box.openedAt ? { openedAt: box.openedAt } : {}),
    })
    .returning();
  if (!row) throw new Error('insertShipment: insert returned no row');
  return row;
}

export async function insertShipmentLine(
  tx: DbTx,
  shipmentId: string,
  line: NewShipmentLine,
): Promise<ShipmentLineRecord> {
  const [row] = await tx
    .insert(wmsTables.shipmentLines)
    .values({
      shipmentId,
      fulfillmentOrderItemId: line.fulfillmentOrderItemId,
      skuId: line.skuId,
      qty: line.qty,
      lineVersion: 1,
      ...(line.createdFromLineId !== undefined ? { createdFromLineId: line.createdFromLineId } : {}),
      ...(line.demandRequestedAt !== undefined ? { demandRequestedAt: line.demandRequestedAt } : {}),
      ...(line.createdAt ? { createdAt: line.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error('insertShipmentLine: insert returned no row');
  return row;
}
