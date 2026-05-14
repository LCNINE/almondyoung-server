import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { StockEventStore } from '../../core/repositories/stock-event.store';

@Injectable()
export class StockProjectionManager {
  constructor(private readonly eventStore: StockEventStore) {}

  async cancelEvent(eventId: string, reason: string): Promise<void> {
    await this.eventStore.reverseEvent(eventId, reason);
  }

  async rebuildSummary(_skuId: string, _warehouseId: string): Promise<void> {
    // 재고 현황 재구축은 추후 프로젝션 서비스로 제공 예정. 미구현.
    throw new BadRequestError('재고 요약 재구축은 추후 프로젝션 서비스로 제공됩니다.');
  }
}
