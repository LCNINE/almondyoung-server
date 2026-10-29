import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { ConsolidationOptionsResponseDto } from '../dto/consolidation.dto';
import { ConsolidationOptionsReader } from './consolidation-options.reader';

@Injectable()
export class ConsolidationOptionsService {
  constructor(private readonly reader: ConsolidationOptionsReader) {}

  findOptions(shipmentId: string, tx?: DbTx): Promise<ConsolidationOptionsResponseDto> {
    return this.reader.findOptions(shipmentId, tx);
  }
}
