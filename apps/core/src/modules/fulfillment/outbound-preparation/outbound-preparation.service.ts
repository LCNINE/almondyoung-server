import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { OutboundPreparationSummaryDto } from '../dto/outbound-preparation.dto';
import { OutboundPreparationReader } from './outbound-preparation.reader';

@Injectable()
export class OutboundPreparationService {
  constructor(private readonly reader: OutboundPreparationReader) {}

  summarize(warehouseId: string, tx?: DbTx): Promise<OutboundPreparationSummaryDto> {
    return this.reader.summarize(warehouseId, tx);
  }
}
