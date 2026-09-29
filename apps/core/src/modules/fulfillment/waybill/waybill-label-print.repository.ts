import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { LabelItem } from './label/label-items';
import type { LabelPrintRecord } from './label/label-print-policy';

const P = wmsTables.waybillLabelPrints;
const W = wmsTables.outboundBatchWorkItems;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLabelItem(value: unknown): value is LabelItem {
  return (
    isRecord(value) &&
    typeof value.locationCode === 'string' &&
    typeof value.skuId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.quantity === 'number'
  );
}

/** jsonb 는 우리가 쓴 모양이지만 타입은 unknown 이다 — 캐스팅 대신 좁힌다. 모양이 깨졌으면 스냅샷만 비운다(«바뀐 줄» 표시만 잃는다). */
function snapshotOf(value: unknown): LabelItem[] {
  return Array.isArray(value) && value.every(isLabelItem) ? value : [];
}

@Injectable()
export class WaybillLabelPrintRepository {
  async listByShipments(
    trx: DbTx,
    shipmentIds: readonly string[],
  ): Promise<Array<LabelPrintRecord & { shipmentId: string }>> {
    if (!shipmentIds.length) return [];
    const rows = await trx
      .select()
      .from(P)
      .where(inArray(P.shipmentId, [...shipmentIds]))
      .orderBy(asc(P.shipmentId), asc(P.revision));
    return rows.map((row) => ({
      shipmentId: row.shipmentId,
      fingerprint: row.fingerprint,
      revision: row.revision,
      itemsSnapshot: snapshotOf(row.itemsSnapshot),
      printedAt: row.printedAt,
    }));
  }

  /** 같은 지문이면 printed_at·printed_by 만 갱신한다 — 판차는 그대로(같은 내용 = 같은 종이). */
  async record(
    trx: DbTx,
    row: { shipmentId: string; fingerprint: string; revision: number; itemsSnapshot: LabelItem[]; printedBy: string },
  ): Promise<LabelPrintRecord> {
    const [saved] = await trx
      .insert(P)
      .values(row)
      .onConflictDoUpdate({
        target: [P.shipmentId, P.fingerprint],
        set: { printedAt: sql`now()`, printedBy: row.printedBy },
      })
      .returning();
    return {
      fingerprint: saved.fingerprint,
      revision: saved.revision,
      itemsSnapshot: snapshotOf(saved.itemsSnapshot),
      printedAt: saved.printedAt,
    };
  }

  /** 출력 확인은 박스의 활성 작업 항목 잠금에서 줄을 선다(스펙 §13). 작업 항목이 없으면 null — 조립이 I4 로 거절한다. */
  async lockActiveWorkItem(trx: DbTx, shipmentId: string): Promise<{ id: string } | null> {
    const [item] = await trx
      .select({ id: W.id })
      .from(W)
      .where(and(eq(W.shipmentId, shipmentId), notInArray(W.status, ['completed', 'excluded'])))
      .limit(1)
      .for('update');
    return item ?? null;
  }
}
