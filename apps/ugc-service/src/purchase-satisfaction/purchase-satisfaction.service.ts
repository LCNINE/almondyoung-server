import { Injectable } from '@nestjs/common';
import type { UpsertPurchaseSatisfactionDto } from './dto/upsert-purchase-satisfaction.dto';
import type { AdminPurchaseSatisfactionQueryDto } from './dto/admin-purchase-satisfaction-query.dto';
import type { AdminPurchaseSatisfactionListResponseDto } from './dto/admin-purchase-satisfaction-list-response.dto';
import type { PurchaseSatisfactionResponseDto } from './dto/purchase-satisfaction-response.dto';
import { PurchaseSatisfactionMapper } from './mappers/purchase-satisfaction.mapper';
import { PurchaseSatisfactionManager } from './purchase-satisfaction.manager';
import { PurchaseSatisfactionReader } from './purchase-satisfaction.reader';

@Injectable()
export class PurchaseSatisfactionService {
  constructor(
    private readonly manager: PurchaseSatisfactionManager,
    private readonly reader: PurchaseSatisfactionReader,
  ) {}

  async upsert(orderId: string, dto: UpsertPurchaseSatisfactionDto): Promise<PurchaseSatisfactionResponseDto> {
    return PurchaseSatisfactionMapper.toResponse(await this.manager.upsert(orderId, dto));
  }

  async getByOrderId(orderId: string): Promise<PurchaseSatisfactionResponseDto> {
    return PurchaseSatisfactionMapper.toResponse(await this.reader.findByOrderId(orderId));
  }

  async listForAdmin(query: AdminPurchaseSatisfactionQueryDto): Promise<AdminPurchaseSatisfactionListResponseDto> {
    const [summary, page] = await Promise.all([this.reader.summarize(query), this.reader.list(query)]);
    return {
      summary,
      data: page.data.map(PurchaseSatisfactionMapper.toResponse),
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }

  async setChecked(id: string, checked: boolean, adminId: string): Promise<PurchaseSatisfactionResponseDto> {
    return PurchaseSatisfactionMapper.toResponse(await this.manager.setChecked(id, checked, adminId));
  }
}
