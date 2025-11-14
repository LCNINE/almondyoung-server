import { Injectable } from '@nestjs/common';
import { PricingStrategy } from './pricing-strategy.interface';
import { OptionBasedPricingStrategy } from './option-based-pricing.strategy';
import { VariantBasedPricingStrategy } from './variant-based-pricing.strategy';
import { PricingStrategyType, DbTransaction } from '../../../types';

@Injectable()
export class PricingStrategyFactory {
  constructor(
    private readonly optionBasedStrategy: OptionBasedPricingStrategy,
    private readonly variantBasedStrategy: VariantBasedPricingStrategy,
  ) {}

  getStrategy(strategyType: PricingStrategyType): PricingStrategy {
    switch (strategyType) {
      case 'option_based':
        return this.optionBasedStrategy;
      case 'variant_based':
        return this.variantBasedStrategy;
      default:
        throw new Error(`Unsupported pricing strategy: ${strategyType}`);
    }
  }

  getSupportedStrategies(): PricingStrategyType[] {
    return ['option_based', 'variant_based'];
  }

  isValidStrategy(strategyType: string): boolean {
    return this.getSupportedStrategies().includes(strategyType as PricingStrategyType);
  }

  async changeStrategy(
    masterId: string,
    fromStrategyType: PricingStrategyType,
    toStrategyType: PricingStrategyType,
    migrationData: any,
    tx?: DbTransaction
  ): Promise<void> {
    if (fromStrategyType === toStrategyType) {
      return;
    }

    const fromStrategy = this.getStrategy(fromStrategyType);
    const toStrategy = this.getStrategy(toStrategyType);

    try {
      await toStrategy.migrateFrom(masterId, fromStrategy, tx);
      await fromStrategy.deletePriceData(masterId, tx);
      
    } catch (error) {
      try {
        await fromStrategy.deletePriceData(masterId, tx);
      } catch (rollbackError) {
        console.error('Failed to rollback pricing strategy change:', rollbackError);
      }
      
      throw new Error('Migration failed');
    }
  }

  async validateStrategyData(strategyType: PricingStrategyType, data: any): Promise<boolean> {
    if (!this.isValidStrategy(strategyType)) {
      throw new Error(`Unsupported pricing strategy: ${strategyType}`);
    }
    
    const strategy = this.getStrategy(strategyType);
    return await strategy.validatePriceData(data);
  }
} 