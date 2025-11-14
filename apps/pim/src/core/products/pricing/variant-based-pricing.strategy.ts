import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { PricingStrategy } from './pricing-strategy.interface';
import { DbService } from '@app/db';
import { variantPrices, productVariants } from '../../../schema';
import { DbTransaction } from '../../../types';

@Injectable()
export class VariantBasedPricingStrategy implements PricingStrategy {
  constructor(private readonly dbService: DbService) {}

  async calculatePrice(variantId: any, tx?: DbTransaction): Promise<number> {
    const db = tx || this.dbService.db;
    
    if (!variantId || typeof variantId !== 'string') {
      throw new Error('Variant ID is required for variant-based pricing');
    }
    
    const [variantPrice] = await db
      .select({ price: variantPrices.price })
      .from(variantPrices)
      .where(eq(variantPrices.variantId, variantId));
    
    if (!variantPrice) {
      throw new Error(`Variant price not found: ${variantId}`);
    }
    
    return variantPrice.price || 0;
  }

  async setPriceData(masterId: string, priceData: any, tx?: DbTransaction): Promise<void> {
    const db = tx || this.dbService.db;
    
    
    if (!priceData || typeof priceData !== 'object') {
      return;
    }
    
    const insertData = Object.entries(priceData).map(([variantId, price]) => ({
      variantId,
      price: Number(price) || 0,
    }));
    
    if (insertData.length > 0) {
      await db.insert(variantPrices).values(insertData);
    }
  }

  async getPriceData(masterId: string, tx?: DbTransaction): Promise<any> {
    const db = tx || this.dbService.db;
    
    const prices = await db
      .select({
        variantId: variantPrices.variantId,
        price: variantPrices.price,
      })
      .from(variantPrices)
      .innerJoin(
        productVariants,
        eq(productVariants.id, variantPrices.variantId)
      )
      .where(eq(productVariants.masterId, masterId));
    
    return prices.reduce((acc, item) => {
      acc[item.variantId] = item.price;
      return acc;
    }, {} as Record<string, number>);
  }

  async updatePriceData(masterId: string, priceData: any, tx?: DbTransaction): Promise<void> {
    const db = tx || this.dbService.db;
    
    await this.deletePriceData(masterId, tx);
    await this.setPriceData(masterId, priceData, tx);
  }

  async deletePriceData(masterId: string, tx?: DbTransaction): Promise<void> {
    const db = tx || this.dbService.db;
    
    const variants = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId));
    
    if (variants.length > 0) {
      const variantIds = variants.map(v => v.id);
      
      await db
        .delete(variantPrices)
        .where(inArray(variantPrices.variantId, variantIds));
    }
  }

  async validatePriceData(priceData: any): Promise<boolean> {
    if (!priceData || typeof priceData !== 'object') {
      return false;
    }
    
    return Object.values(priceData).every(price => 
      typeof price === 'number' && price >= 0
    );
  }

  async migrateFrom(
    masterId: string, 
    fromStrategy: PricingStrategy, 
    tx?: DbTransaction
  ): Promise<void> {
    
    const fromData = await fromStrategy.getPriceData(masterId, tx);
    
    const convertedData: Record<string, number> = {};
    
    if (fromData && typeof fromData === 'object') {
      Object.entries(fromData).forEach(([optionValueId, price], index) => {
        convertedData[`variant-${index}`] = Number(price) || 0;
      });
    }
    
    await this.setPriceData(masterId, convertedData, tx);
  }

  async migrateTo(
    masterId: string,
    toStrategy: PricingStrategy,
    tx?: DbTransaction
  ): Promise<void> {
    const currentData = await this.getPriceData(masterId, tx);
    
    const convertedData: Record<string, number> = {};
    
    if (currentData && typeof currentData === 'object') {
      Object.entries(currentData).forEach(([variantId, price], index) => {
        convertedData[`option-value-${index}`] = Number(price) || 0;
      });
    }
    
    await toStrategy.setPriceData(masterId, convertedData, tx);
  }
} 