import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { LineCompositionEditManager } from './line-composition-edit.manager';
import { LineCompositionEditReader } from './line-composition-edit.reader';
import { PutLineCompositionDto } from './line-composition-edit.dto';
import {
  ApplyToExistingLinesResult,
  ExistingLinesImpact,
  LineCompositionChangeResult,
} from './line-composition-edit.types';

@Injectable()
export class LineCompositionEditService {
  constructor(
    private readonly reader: LineCompositionEditReader,
    private readonly manager: LineCompositionEditManager,
  ) {}

  assignToLine(
    salesOrderId: string,
    salesOrderLineId: string,
    dto: PutLineCompositionDto,
    actor: { id: string },
    tx?: DbTx,
  ): Promise<LineCompositionChangeResult> {
    return this.manager.assignToLine(salesOrderId, salesOrderLineId, dto.items, dto.note ?? null, actor, tx);
  }

  previewExistingLines(variantId: string, tx?: DbTx): Promise<ExistingLinesImpact> {
    return this.reader.previewExistingLines(variantId, tx);
  }

  applyToExistingLines(variantId: string, actor: { id: string }, tx?: DbTx): Promise<ApplyToExistingLinesResult> {
    return this.manager.applyToExistingLines(variantId, actor, tx);
  }
}
