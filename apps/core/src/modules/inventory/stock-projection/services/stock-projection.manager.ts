import { Injectable } from '@nestjs/common';
import { StockEventStore } from '../../core/repositories/stock-event.store';

@Injectable()
export class StockProjectionManager {
  constructor(private readonly eventStore: StockEventStore) {}

  async cancelEvent(eventId: string, reason?: string): Promise<void> {
    await this.eventStore.reverseEvent(eventId, reason);
  }
}
