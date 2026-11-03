import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { ConsolidationBoardResponseDto, ConsolidationOptionsResponseDto } from '../dto/consolidation.dto';
import { ConsolidationBoardReader } from './consolidation-board.reader';
import { ConsolidationOptionsReader } from './consolidation-options.reader';

@Injectable()
export class ConsolidationOptionsService {
  constructor(
    private readonly reader: ConsolidationOptionsReader,
    private readonly board: ConsolidationBoardReader,
  ) {}

  findOptions(shipmentId: string, tx?: DbTx): Promise<ConsolidationOptionsResponseDto> {
    return this.reader.findOptions(shipmentId, tx);
  }

  findBoard(warehouseId: string, tx?: DbTx): Promise<ConsolidationBoardResponseDto> {
    return this.board.findBoard(warehouseId, tx);
  }
}
