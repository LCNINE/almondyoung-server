import { Injectable } from '@nestjs/common';
import { ListQuery, OrderProgressPage, OrderProgressReader } from './order-progress.reader';
import { OrderProgressSummary } from './order-progress.summary';

@Injectable()
export class OrderProgressService {
  constructor(private readonly reader: OrderProgressReader) {}

  summary(): Promise<OrderProgressSummary> {
    return this.reader.summary(new Date());
  }

  listOrders(query: ListQuery): Promise<OrderProgressPage> {
    return this.reader.listOrders(query, new Date());
  }
}
