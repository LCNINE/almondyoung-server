import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { UNRESOLVED_DEAD_LETTER_STATUSES, dead_letters } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts/streams';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import type { LookupSalesChannel } from './sales-order-lookup.dto';

/**
 * 채널 대사(#1016 45번)가 묻는 두 가지만 읽는다 — SO 상태, 그 주문의 이벤트 실패가 열려 있는가.
 * 주소·고객 정보는 판정에 필요 없어 싣지 않는다.
 */
@Injectable()
export class SalesOrderLookupReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async statusesByChannelOrderId(channel: LookupSalesChannel, externalOrderIds: string[]): Promise<Map<string, string>> {
    if (externalOrderIds.length === 0) return new Map();
    const rows = await this.dbService.db
      .select({ channelOrderId: wmsTables.salesOrders.channelOrderId, status: wmsTables.salesOrders.status })
      .from(wmsTables.salesOrders)
      .where(
        and(
          eq(wmsTables.salesOrders.salesChannel, channel),
          inArray(wmsTables.salesOrders.channelOrderId, externalOrderIds),
        ),
      );
    return new Map(rows.map((row) => [row.channelOrderId, row.status]));
  }

  /** 주문 생애 토픽의 순서 키는 `envelope.source.aggregateId` = 어댑터의 `wmsOrderId` 다(7·8번 스펙 §1.4). */
  async wmsOrderIdsWithOpenEventFailure(wmsOrderIds: string[]): Promise<Set<string>> {
    if (wmsOrderIds.length === 0) return new Set();
    const rows = await this.dbService.db
      .selectDistinct({ sequenceKey: dead_letters.sequenceKey })
      .from(dead_letters)
      .where(
        and(
          eq(dead_letters.topic, ORDER_STREAM.topic.topic),
          inArray(dead_letters.status, [...UNRESOLVED_DEAD_LETTER_STATUSES]),
          inArray(dead_letters.sequenceKey, wmsOrderIds),
        ),
      );
    return new Set(rows.flatMap((row) => (row.sequenceKey ? [row.sequenceKey] : [])));
  }
}
