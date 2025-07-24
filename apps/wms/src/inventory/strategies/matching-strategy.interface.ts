import { DbService } from '@app/db';
import { wmsTables } from '../../../database/schemas/wms-schema';

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
        protected readonly dbService: DbService<typeof wmsTables>
    ) { }

    protected get db() {
        return this.dbService.db;
    }

    abstract lookup(context: MatchingContext): Promise<SkuQuantityMapping[]>;

    abstract create(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: any): Promise<void>;

    abstract update(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: any): Promise<void>;

    abstract delete(context: MatchingContext, tx?: any): Promise<void>;

    abstract validate(context: MatchingContext, mappings: SkuQuantityMapping[]): Promise<boolean>;
}