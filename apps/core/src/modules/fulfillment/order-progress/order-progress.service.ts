import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { OrderCsContext, OrderCsReader } from './order-cs.reader';
import { ListQuery, OrderProgressPage, OrderProgressReader } from './order-progress.reader';
import { OrderProgressSummary } from './order-progress.summary';
import { ReserveShortage, ReserveShortageReader } from './reserve-shortage.reader';

@Injectable()
export class OrderProgressService {
  constructor(
    private readonly reader: OrderProgressReader,
    private readonly shortageReader: ReserveShortageReader,
    private readonly csReader: OrderCsReader,
  ) {}

  summary(): Promise<OrderProgressSummary> {
    return this.reader.summary(new Date());
  }

  /** 각 행에 연락처·상품을, 예약 단계면 부족 품목·입고 예정도 싣는다 — 페이지 전체를 SQL 한 번씩으로(N+1 없음) */
  async listOrders(query: ListQuery, tx?: DbTx): Promise<OrderProgressPage> {
    const page = await this.reader.listOrders(query, new Date(), tx);
    const ids = page.items.map((i) => i.salesOrderId);
    const briefs = await this.csReader.briefs(ids, tx);
    const shortages =
      query.stage === 'reserve' ? await this.shortageReader.forOrders(ids, tx) : new Map<string, ReserveShortage>();
    return {
      ...page,
      items: page.items.map((i) => ({
        ...i,
        cs: briefs.get(i.salesOrderId) ?? null,
        shortage: shortages.get(i.salesOrderId) ?? null,
      })),
    };
  }

  csContext(salesOrderId: string): Promise<OrderCsContext> {
    return this.csReader.context(salesOrderId);
  }
}
