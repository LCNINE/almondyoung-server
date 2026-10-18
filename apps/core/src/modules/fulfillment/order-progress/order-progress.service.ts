import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { ListQuery, OrderProgressPage, OrderProgressReader } from './order-progress.reader';
import { OrderProgressSummary } from './order-progress.summary';
import { ReserveShortageReader } from './reserve-shortage.reader';

@Injectable()
export class OrderProgressService {
  constructor(
    private readonly reader: OrderProgressReader,
    private readonly shortageReader: ReserveShortageReader,
  ) {}

  summary(): Promise<OrderProgressSummary> {
    return this.reader.summary(new Date());
  }

  /** 예약 단계 목록은 각 행에 부족 품목·입고 예정을 싣는다 — 페이지 전체를 SQL 한 번으로(N+1 없음) */
  async listOrders(query: ListQuery, tx?: DbTx): Promise<OrderProgressPage> {
    const page = await this.reader.listOrders(query, new Date(), tx);
    if (query.stage !== 'reserve' || page.items.length === 0) return page;
    const shortages = await this.shortageReader.forOrders(
      page.items.map((i) => i.salesOrderId),
      tx,
    );
    return { ...page, items: page.items.map((i) => ({ ...i, shortage: shortages.get(i.salesOrderId) ?? null })) };
  }
}
