import { Injectable } from '@nestjs/common';
import {
  OrderShipmentOperations,
  OrderShipmentOperationsReader,
} from '../../fulfillment/reader/order-shipment-operations.reader';

@Injectable()
export class SalesOrderShipmentOperationsService {
  constructor(private readonly reader: OrderShipmentOperationsReader) {}

  list(salesOrderId: string): Promise<OrderShipmentOperations> {
    return this.reader.list(salesOrderId);
  }
}
