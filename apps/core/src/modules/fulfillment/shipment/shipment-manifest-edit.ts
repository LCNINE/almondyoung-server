import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { and, eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import {
  assertShipmentHasNoActiveWaybill,
  assertShipmentHasNoCustodyOrActiveWork,
  lockShipmentAggregates,
  ShipmentAggregate,
  ShipmentRow,
} from '../services/shipment-aggregate';
import type { ShipmentReservationService } from '../services/shipment-reservation.service';
import {
  insertShipment,
  insertShipmentLine,
  NewShipment,
  NewShipmentLine,
  ShipmentLineRecord,
} from './shipment-lifecycle';

export interface ManifestEditDeps {
  invariant: FulfillmentInvariantService;
  reservations: Pick<ShipmentReservationService, 'recompute'>;
}

export type EditableStatus = 'draft' | 'planned' | 'recovery_required';

export interface ManifestEdit {
  /** 이 문에서 구성이 바뀔 수 있는 기존 상자 */
  shipmentIds: readonly string[];
  /** 어기면 내부 Error — 호출자가 먼저 자기 코드로 검사한다 */
  allow: readonly EditableStatus[];
}

export interface ManifestWriter {
  createShipment(box: NewShipment): Promise<ShipmentRow>;
  addLine(shipmentId: string, line: NewShipmentLine): Promise<ShipmentLineRecord>;
  moveLine(lineId: string, fromShipmentId: string, toShipmentId: string): Promise<void>;
  setLineQty(lineId: string, shipmentId: string, qty: number): Promise<void>;
  reviseRecipient(shipmentId: string, recipientSnapshot: unknown): Promise<void>;
  setEntrancePassword(shipmentId: string, entrancePassword: string): Promise<void>;
  setShippingProfile(shipmentId: string, shippingProfileId: string | null): Promise<void>;
}

/**
 * 상자 구성(줄·수령인·송장 프로필)을 바꾸는 유일한 문. 잠금 → 상태·보관·활성 송장 가드 → body → 끝맺음.
 * 끝맺음이 «기존 상자당 manifest_version 한 번 +1» 과 «줄이 바뀐 상자 예약 재계산» 을 보장하므로 호출자는 잊을 수 없다.
 * 비밀번호만 바뀐 상자는 송장 내용이 아니므로 올리지 않는다.
 */
export async function editShipmentManifest<T>(
  deps: ManifestEditDeps,
  edit: ManifestEdit,
  body: (writer: ManifestWriter, aggregates: ShipmentAggregate[]) => Promise<T>,
  tx: DbTx,
): Promise<T> {
  const existingIds = [...new Set(edit.shipmentIds)];
  const aggregates = await lockShipmentAggregates(
    tx,
    deps.invariant,
    existingIds,
    () => new Error('Shipment component changed while acquiring locks in editShipmentManifest'),
  );
  const byId = new Map(aggregates.map((a) => [a.shipment.id, a]));
  const ordered: ShipmentAggregate[] = [];
  for (const id of existingIds) {
    const aggregate = byId.get(id);
    if (!aggregate) throw new Error(`editShipmentManifest: shipment ${id} was not locked`);
    ordered.push(aggregate);
  }
  for (const aggregate of ordered) {
    const status = aggregate.shipment.status;
    if (!edit.allow.some((allowed) => allowed === status)) {
      throw new Error(
        `editShipmentManifest: shipment ${aggregate.shipment.id} is ${status}, allowed ${edit.allow.join('|')}`,
      );
    }
  }
  for (const aggregate of ordered) {
    await assertShipmentHasNoCustodyOrActiveWork(tx, aggregate);
    await assertShipmentHasNoActiveWaybill(tx, aggregate.shipment.id);
  }

  const existing = new Set(existingIds);
  const created: string[] = [];
  const lineChanged = new Set<string>();
  const labelChanged = new Set<string>();
  const S = wmsTables.shipments;
  const L = wmsTables.shipmentLines;

  const assertTarget = (shipmentId: string): void => {
    if (!existing.has(shipmentId) && !created.includes(shipmentId)) {
      throw new Error(`editShipmentManifest: shipment ${shipmentId} is outside this edit`);
    }
  };
  const updateShipment = async (shipmentId: string, set: PgUpdateSetSource<typeof S>): Promise<void> => {
    const rows = await tx.update(S).set(set).where(eq(S.id, shipmentId)).returning({ id: S.id });
    if (rows.length !== 1)
      throw new Error(`editShipmentManifest: shipment ${shipmentId} update matched ${rows.length} rows`);
  };

  const writer: ManifestWriter = {
    async createShipment(box) {
      const row = await insertShipment(tx, box);
      created.push(row.id);
      return row;
    },
    async addLine(shipmentId, line) {
      assertTarget(shipmentId);
      const row = await insertShipmentLine(tx, shipmentId, line);
      lineChanged.add(shipmentId);
      return row;
    },
    async moveLine(lineId, fromShipmentId, toShipmentId) {
      assertTarget(fromShipmentId);
      assertTarget(toShipmentId);
      const rows = await tx
        .update(L)
        .set({ shipmentId: toShipmentId, lineVersion: sql`${L.lineVersion} + 1` })
        .where(and(eq(L.id, lineId), eq(L.shipmentId, fromShipmentId)))
        .returning({ id: L.id });
      if (rows.length !== 1)
        throw new Error(`editShipmentManifest: line ${lineId} is not in shipment ${fromShipmentId}`);
      lineChanged.add(fromShipmentId);
      lineChanged.add(toShipmentId);
    },
    async setLineQty(lineId, shipmentId, qty) {
      assertTarget(shipmentId);
      const rows = await tx
        .update(L)
        .set({ qty, lineVersion: sql`${L.lineVersion} + 1` })
        .where(and(eq(L.id, lineId), eq(L.shipmentId, shipmentId)))
        .returning({ id: L.id });
      if (rows.length !== 1) throw new Error(`editShipmentManifest: line ${lineId} is not in shipment ${shipmentId}`);
      lineChanged.add(shipmentId);
    },
    async reviseRecipient(shipmentId, recipientSnapshot) {
      assertTarget(shipmentId);
      await updateShipment(shipmentId, { recipientSnapshot });
      labelChanged.add(shipmentId);
    },
    async setEntrancePassword(shipmentId, entrancePassword) {
      assertTarget(shipmentId);
      await updateShipment(shipmentId, { entrancePassword });
    },
    async setShippingProfile(shipmentId, shippingProfileId) {
      assertTarget(shipmentId);
      await updateShipment(shipmentId, { shippingProfileId });
      labelChanged.add(shipmentId);
    },
  };

  const result = await body(writer, aggregates);

  const now = new Date();
  for (const id of existingIds) {
    if (!lineChanged.has(id) && !labelChanged.has(id)) continue;
    await updateShipment(id, { manifestVersion: sql`${S.manifestVersion} + 1`, lastUpdated: now });
  }
  for (const id of [...existingIds, ...created]) {
    if (lineChanged.has(id)) await deps.reservations.recompute(id, tx);
  }
  return result;
}
