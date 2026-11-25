import { Injectable } from '@nestjs/common';
import { CreateOrderContactDto, OrderContactCreatedDto, OrderContactListDto } from '../dto/order-contact.dto';
import { OrderContactsManager } from './order-contacts.manager';
import { OrderContactsReader } from './order-contacts.reader';

@Injectable()
export class OrderContactsService {
  constructor(
    private readonly manager: OrderContactsManager,
    private readonly reader: OrderContactsReader,
  ) {}

  async create(dto: CreateOrderContactDto, authorId: string): Promise<OrderContactCreatedDto> {
    const row = await this.manager.create(dto, authorId, new Date());
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }

  async list(salesOrderId: string): Promise<OrderContactListDto> {
    const rows = await this.reader.list(salesOrderId);
    return {
      items: rows.map(({ salesOrderId: _order, createdAt, ...row }) => ({
        ...row,
        createdAt: createdAt.toISOString(),
      })),
    };
  }
}
