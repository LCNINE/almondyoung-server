import { Injectable } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { PricingStrategy } from './pricing-strategy.interface';
import { DbService } from '@app/db';
import { optionValuePrices, productMasters } from '../../../schema';
import { DbTransaction } from '../../../types';

@Injectable()
export class OptionBasedPricingStrategy implements PricingStrategy {
  constructor(private readonly dbService: DbService) {}

  async calculatePrice(optionInfo: any, tx?: DbTransaction): Promise<number> {
    const db = tx || this.dbService.db;
    
    if (!Array.isArray(optionInfo) || optionInfo.length === 0) {
      throw new Error('Option information is required for option-based pricing');
    }
    
    const optionValueIds = optionInfo.map(opt => opt.optionValueId);
    
    if (optionValueIds.length === 0) {
      throw new Error('No option values provided');
    }
    
    const [optionValue] = await db
      .select({
        masterId: productMasters.id,
        basePrice: productMasters.basePrice
      })
      .from(optionValuePrices)
      .innerJoin(productMasters, eq(optionValuePrices.masterId, productMasters.id))
      .where(eq(optionValuePrices.optionValueId, optionValueIds[0]));
    
    if (!optionValue) {
      throw new Error('Master not found for option values');
    }
    
    let totalPrice = optionValue.basePrice || 0;
    
    const optionPrices = await db
      .select({ 
        optionValueId: optionValuePrices.optionValueId,
        price: optionValuePrices.price 
      })
      .from(optionValuePrices)
      .where(and(
        eq(optionValuePrices.masterId, optionValue.masterId),
        inArray(optionValuePrices.optionValueId, optionValueIds)
      ));
    
    const additionalPrice = optionPrices.reduce((sum, opt) => sum + (opt.price || 0), 0);
    totalPrice += additionalPrice;
    
    return totalPrice;
  }

  async setPriceData(masterId: string, priceData: any, tx?: DbTransaction): Promise<void> {
    const db = tx || this.dbService.db;
    
    
    if (!priceData || typeof priceData !== 'object') {
      return;
    }
    
    const insertData = Object.entries(priceData).map(([optionValueId, price]) => ({
      masterId,
      optionValueId,
      price: Number(price) || 0,
    }));
    
    if (insertData.length > 0) {
      await db.insert(optionValuePrices).values(insertData);
    }
  }

  async getPriceData(masterId: string, tx?: DbTransaction): Promise<any> {
    const db = tx || this.dbService.db;
    
    const prices = await db
      .select({
        optionValueId: optionValuePrices.optionValueId,
        price: optionValuePrices.price,
      })
      .from(optionValuePrices)
      .where(eq(optionValuePrices.masterId, masterId));
    
    return prices.reduce((acc, item) => {
      acc[item.optionValueId] = item.price;
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
    
    await db
      .delete(optionValuePrices)
      .where(eq(optionValuePrices.masterId, masterId));
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
      Object.entries(fromData).forEach(([variantId, price], index) => {
        convertedData[`option-value-${index}`] = Number(price) || 0;
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
      Object.entries(currentData).forEach(([optionValueId, price], index) => {
        convertedData[`variant-${index}`] = Number(price) || 0;
      });
    }
    
    await toStrategy.setPriceData(masterId, convertedData, tx);
  }
} 