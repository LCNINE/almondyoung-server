import { Injectable } from '@nestjs/common';
import { MatchingStrategy, MatchingContext, SkuQuantityMapping } from './matching-strategy.interface';

@Injectable()
export class VoidMatchingStrategy extends MatchingStrategy {
    async lookup(context: MatchingContext): Promise<SkuQuantityMapping[]> {
        // 항상 빈 배열 반환
        return [];
    }

    async create(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: any): Promise<void> {
        return;
    }

    async update(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: any): Promise<void> {
        return;
    }

    async delete(context: MatchingContext, tx?: any): Promise<void> {
        return;
    }

    async validate(context: MatchingContext, mappings: SkuQuantityMapping[]): Promise<boolean> {
        return mappings.length === 0;
    }
}