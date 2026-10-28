import { Injectable } from '@nestjs/common';
import type { UpsertPurchaseSatisfactionDto } from './dto/upsert-purchase-satisfaction.dto';
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
}
