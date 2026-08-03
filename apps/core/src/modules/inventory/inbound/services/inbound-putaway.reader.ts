import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { PutawayPendingListDto } from '../dto/putaway-pending.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

// 핸드헬드 화면이 전량 렌더한다 — `전체` 필터가 역사적 백로그를 통째로 부르지
// 않게 상한을 둔다. LIMIT+1 로 가져와 실제 count 쿼리 없이 잘림 여부를 안다.
const PENDING_LIMIT = 200;

/**
 * 적치 대기 조회. inbound.service.ts 에 두지 않는 이유는 그 파일이 이미 1100줄이
 * 넘고 조회 규칙 위반이 남아 있어서다 — 신규 조회는 리더로 분리한다.
 */
@Injectable()
export class InboundPutawayReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async listPending(params: { warehouseId: string; days?: number }, tx?: DbTx): Promise<PutawayPendingListDto> {
    const { warehouseId, days } = params;

    return this.dbService.run(async (trx) => {
      // putawayFromOrigin 의 originAvailable 검증식과 같은 식이다(inbound.service.ts:846).
      // 화면이 제안하는 수량과 서버가 허용하는 수량이 어긋날 수 없게 하나로 둔다.
      const pendingQty = sql<number>`(
        ${wmsTables.inboundReceiptLines.quantity}
        - ${wmsTables.inboundReceiptLines.putawayFromOriginQty}
        - ${wmsTables.inboundReceiptLines.returnedQty}
        - ${wmsTables.inboundReceiptLines.canceledQty}
      )`;

      const rows = await trx
        .select({
          lineId: wmsTables.inboundReceiptLines.id,
          skuId: wmsTables.skus.id,
          skuName: wmsTables.skus.name,
          skuCode: wmsTables.skus.code,
          pendingQty,
          originLocationId: wmsTables.locations.id,
          originLocationCode: wmsTables.locations.code,
          receivedAt: wmsTables.inboundReceipts.occurredAt,
        })
        .from(wmsTables.inboundReceiptLines)
        .innerJoin(wmsTables.inboundReceipts, eq(wmsTables.inboundReceipts.id, wmsTables.inboundReceiptLines.receiptId))
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.inboundReceiptLines.skuId))
        .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.inboundReceiptLines.originLocationId))
        // 원장 쪽 잔량 검증 — 카운터(putawayFromOriginQty 등)만으로는 못 잡는
        // "이동 화면으로 원위치를 이미 비운" 라인을 걸러낸다. 같은 SKU·같은
        // 출발지의 다른 라인이 이 원장 행을 공유할 수 있으므로 pendingQty 를
        // 원장 qty 로 클램프하지 않는다 — qty > 0 필터만 건다.
        .innerJoin(
          wmsTables.stockLedgers,
          and(
            eq(wmsTables.stockLedgers.skuId, wmsTables.inboundReceiptLines.skuId),
            eq(wmsTables.stockLedgers.warehouseId, wmsTables.inboundReceipts.warehouseId),
            eq(wmsTables.stockLedgers.locationId, wmsTables.inboundReceiptLines.originLocationId),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        )
        .where(
          and(
            eq(wmsTables.inboundReceipts.status, 'posted'),
            eq(wmsTables.inboundReceipts.warehouseId, warehouseId),
            // 임시로 쌓아둔 것만 할 일이다. 처음부터 최종 위치로 입고된 라인은 제자리다.
            eq(wmsTables.locations.isSystem, true),
            sql`${pendingQty} > 0`,
            sql`${wmsTables.stockLedgers.qty} > 0`,
            days !== undefined
              ? gte(wmsTables.inboundReceipts.occurredAt, new Date(Date.now() - days * DAY_MS))
              : undefined,
          ),
        )
        // occurredAt 은 영수증 단위라 한 영수증의 모든 라인이 동률이다. LIMIT 이
        // 정렬을 load-bearing 하게 만드므로(어느 200건이 살아남는지가 정렬에
        // 달림) 2차 정렬키 없이는 실행마다 순서가 달라질 수 있다.
        .orderBy(asc(wmsTables.inboundReceipts.occurredAt), asc(wmsTables.inboundReceiptLines.id))
        .limit(PENDING_LIMIT + 1);

      const truncated = rows.length > PENDING_LIMIT;
      const limited = truncated ? rows.slice(0, PENDING_LIMIT) : rows;

      return {
        total: limited.length,
        truncated,
        items: limited.map((row) => ({
          lineId: row.lineId,
          skuId: row.skuId,
          skuName: row.skuName,
          skuCode: row.skuCode,
          pendingQty: Number(row.pendingQty),
          originLocationId: row.originLocationId,
          originLocationCode: row.originLocationCode,
          receivedAt: row.receivedAt.toISOString(),
        })),
      };
    }, tx);
  }
}
