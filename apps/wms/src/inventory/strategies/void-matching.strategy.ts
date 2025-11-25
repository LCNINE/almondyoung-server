import { Injectable } from '@nestjs/common';
import { MatchingStrategy, MatchingContext, SkuQuantityMapping } from './matching-strategy.interface';
import { DbTx } from '../../../database/schemas/wms-schema';

@Injectable()
export class VoidMatchingStrategy extends MatchingStrategy {
    async lookup(context: MatchingContext): Promise<SkuQuantityMapping[]> {
        return [];
    }

    async create(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<void> {
        return;
    }

    async update(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<void> {
        return;
    }

    async delete(context: MatchingContext, tx?: DbTx): Promise<void> {
        return;
    }

    async validate(context: MatchingContext, mappings: SkuQuantityMapping[]): Promise<boolean> {
        return mappings.length === 0;
    }
}