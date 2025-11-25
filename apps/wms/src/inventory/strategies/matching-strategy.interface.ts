import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';

export interface SkuQuantityMapping {
  skuId: string;
  quantity: number;
}

export interface MatchingContext {
  variantId: string;
  productMatchingId: string;
  optionData?: Array<{
    optionName: string;
    optionValue: string;
  }>;
}

export abstract class MatchingStrategy {
  constructor(
    protected readonly dbService: DbService<typeof wmsSchema>
  ) { }

  protected get db() {
    return this.dbService.db;
  }

  abstract lookup(context: MatchingContext): Promise<SkuQuantityMapping[]>;

  abstract create(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<void>;

  abstract update(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<void>;

  abstract delete(context: MatchingContext, tx?: DbTx): Promise<void>;

  abstract validate(context: MatchingContext, mappings: SkuQuantityMapping[]): Promise<boolean>;
}