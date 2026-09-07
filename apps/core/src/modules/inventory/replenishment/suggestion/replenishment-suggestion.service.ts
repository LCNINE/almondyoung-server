import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { SuggestionRow } from './suggestion.types';
import { ReplenishmentSuggestionReader } from './replenishment-suggestion.reader';
import {
  ReplenishmentSuggestionListDto,
  ReplenishmentSuggestionRowDto,
  SuggestionActionFilter,
} from '../dto/replenishment-suggestion.dto';

/**
 * 트랜잭션 경계 + DTO 매핑만. 조립 오케스트레이션은 `ReplenishmentSuggestionReader` 가 갖는다.
 */
@Injectable()
export class ReplenishmentSuggestionService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: ReplenishmentSuggestionReader,
  ) {}

  listSuggestions(filter: { action: SuggestionActionFilter }, tx?: DbTx): Promise<ReplenishmentSuggestionListDto> {
    return this.dbService.run(async (trx) => {
      const { items, evaluated } = await this.reader.list(trx, filter);
      return { items: items.map(toDto), evaluated };
    }, tx);
  }

  getSku(skuId: string, tx?: DbTx): Promise<ReplenishmentSuggestionRowDto> {
    return this.dbService.run(async (trx) => toDto(await this.reader.findRow(trx, skuId)), tx);
  }
}

function toDto(row: SuggestionRow): ReplenishmentSuggestionRowDto {
  return {
    skuId: row.skuId,
    skuCode: row.skuCode,
    skuName: row.skuName,
    supplier: row.supplier,
    pattern: row.pattern,
    grade: row.grade,
    confidence: row.confidence,
    demand: row.demand,
    company: row.company,
    sellable: row.sellable,
    actions: row.actions.map((action) =>
      action.type === 'purchase'
        ? {
            type: 'purchase',
            qty: action.qty,
            supplierId: action.supplierId,
            sourceWarehouseId: action.sourceWarehouseId,
          }
        : {
            type: 'transfer',
            qty: action.qty,
            fromWarehouseId: action.fromWarehouseId,
            toWarehouseId: action.toWarehouseId,
            lines: action.lines,
          },
    ),
    flags: [...row.flags],
    legacyReorderPoint: row.legacyReorderPoint,
  };
}
