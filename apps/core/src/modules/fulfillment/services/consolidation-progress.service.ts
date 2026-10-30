import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { ConsolidationProgressResponseDto } from '../dto/consolidation.dto';
import { ConsolidationProgressReader } from './consolidation-progress.reader';

@Injectable()
export class ConsolidationProgressService {
  constructor(private readonly reader: ConsolidationProgressReader) {}

  findForShipment(shipmentId: string, tx?: DbTx): Promise<ConsolidationProgressResponseDto | null> {
    return this.reader.findForShipment(shipmentId, tx);
  }
}
