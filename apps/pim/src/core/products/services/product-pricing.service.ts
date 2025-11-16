import { Injectable } from '@nestjs/common';
import { eq, and, or, isNull, lte, gte, desc, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import {
  productMasters,
  customerTierPrices,
  volumeTierPrices,
} from '../../../schema';
import {
  DbTransaction,
  PriceCalculationContext,
  PriceCalculationResult,
  PricingInfo,
} from '../../../types';
import { PricingStrategyFactory } from '../pricing/pricing-strategy.factory';

@Injectable()
export class ProductPricingService {
  constructor(
    private readonly dbService: DbService<typeof import('../../../schema').pimSchema>,
    private readonly strategyFactory: PricingStrategyFactory,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 최종 가격 계산 (3-layer 적용)
   * Layer 1: 기준가 계산 (option_based 또는 variant_based)
   * Layer 2: 고객 등급별 가격 조정
   * Layer 3: 수량별 도매가 적용
   */
  async calculatePrice(
    context: PriceCalculationContext,
    tx?: DbTransaction,
  ): Promise<PriceCalculationResult> {
    const client = tx || this.db;

    // Layer 1: 기준가 계산
    const basePrice = await this.calculateBasePrice(context, client);

    // Layer 2: 고객 등급별 가격 조정
    const { price: tierAdjustedPrice, policy: tierPolicy } =
      await this.applyCustomerTierPrice(basePrice, context, client);

    // Layer 3: 수량별 도매가 적용
    let finalUnitPrice = tierAdjustedPrice;
    let volumePolicy: any = undefined;

    if (context.includeVolumeTier !== false && context.quantity > 1) {
      const volumeResult = await this.applyVolumeTierPrice(
        tierAdjustedPrice,
        context,
        client,
      );
      finalUnitPrice = volumeResult.price;
      volumePolicy = volumeResult.policy;
    }

    return {
      basePrice,
      tierAdjustedPrice,
      finalUnitPrice,
      totalPrice: finalUnitPrice * context.quantity,
      appliedPolicies: {
        basePricingStrategy: context.variantId ? 'variant_based' : 'option_based',
        customerTierPolicy: tierPolicy,
        volumeTierPolicy: volumePolicy,
      },
      breakdown: {
        basePrice,
        customerTierAdjustment: tierAdjustedPrice - basePrice,
        volumeTierDiscount: tierAdjustedPrice - finalUnitPrice,
      },
    };
  }

  /**
   * 상품의 모든 가격 정보 조회 (API 응답용)
   * 고객 등급별 가격, 수량별 도매가 모두 포함
   */
  async getAllPricingInfo(
    masterId: string,
    variantId?: string,
    tx?: DbTransaction,
  ): Promise<PricingInfo> {
    const client = tx || this.db;

    // 기준가 계산 (quantity=1, regular tier로 가정)
    const basePrice = await this.calculateBasePrice(
      {
        masterId,
        variantId,
      },
      client,
    );

    // 고객 등급별 가격 조회
    const tierPricesData = await client
      .select({
        customerTier: customerTierPrices.customerTier,
        priceType: customerTierPrices.priceType,
        value: customerTierPrices.value,
      })
      .from(customerTierPrices)
      .where(
        and(
          eq(customerTierPrices.masterId, masterId),
          or(
            isNull(customerTierPrices.variantId),
            variantId ? eq(customerTierPrices.variantId, variantId) : isNull(customerTierPrices.variantId),
          ),
          or(
            isNull(customerTierPrices.validFrom),
            lte(customerTierPrices.validFrom, new Date()),
          ),
          or(
            isNull(customerTierPrices.validTo),
            gte(customerTierPrices.validTo, new Date()),
          ),
        ),
      );

    // 고객 등급별 가격 계산
    const tierPrices: Record<string, number> = {};
    for (const tierData of tierPricesData) {
      tierPrices[tierData.customerTier] = this.applyPriceAdjustment(
        basePrice,
        tierData.priceType,
        tierData.value,
      );
    }

    // 기준가도 포함 (정책이 없는 경우 대비)
    if (!tierPrices['regular']) {
      tierPrices['regular'] = basePrice;
    }

    // 수량별 도매가 조회
    const volumeTiersData = await client
      .select({
        minQuantity: volumeTierPrices.minQuantity,
        priceType: volumeTierPrices.priceType,
        value: volumeTierPrices.value,
        requiredCustomerTier: volumeTierPrices.requiredCustomerTier,
      })
      .from(volumeTierPrices)
      .where(
        and(
          eq(volumeTierPrices.masterId, masterId),
          or(
            isNull(volumeTierPrices.variantId),
            variantId ? eq(volumeTierPrices.variantId, variantId) : isNull(volumeTierPrices.variantId),
          ),
          or(
            isNull(volumeTierPrices.validFrom),
            lte(volumeTierPrices.validFrom, new Date()),
          ),
          or(
            isNull(volumeTierPrices.validTo),
            gte(volumeTierPrices.validTo, new Date()),
          ),
        ),
      )
      .orderBy(volumeTierPrices.minQuantity);

    // 수량별 가격 계산 (각 tier의 기준가 사용)
    const volumeTiers = volumeTiersData.map((vol) => {
      const basePriceForTier = vol.requiredCustomerTier
        ? tierPrices[vol.requiredCustomerTier] || basePrice
        : basePrice;

      return {
        minQuantity: vol.minQuantity,
        unitPrice: this.applyPriceAdjustment(
          basePriceForTier,
          vol.priceType,
          vol.value,
        ),
        requiredTier: vol.requiredCustomerTier,
      };
    });

    return {
      basePrice,
      tierPrices,
      volumeTiers,
    };
  }

  /**
   * Layer 1: 기준가 계산 (기존 strategy 사용)
   */
  private async calculateBasePrice(
    context: Pick<PriceCalculationContext, 'masterId' | 'variantId' | 'optionValueIds'>,
    tx: DbTransaction,
  ): Promise<number> {
    // 상품 마스터 조회
    const [master] = await tx
      .select({
        pricingStrategy: productMasters.pricingStrategy,
        basePrice: productMasters.basePrice,
      })
      .from(productMasters)
      .where(eq(productMasters.id, context.masterId));

    if (!master) {
      throw new Error(`Product master not found: ${context.masterId}`);
    }

    // 기존 strategy 사용
    const strategy = this.strategyFactory.getStrategy(master.pricingStrategy as any);

    try {
      if (master.pricingStrategy === 'variant_based' && context.variantId) {
        return await strategy.calculatePrice(context.variantId, tx);
      } else if (master.pricingStrategy === 'option_based' && context.optionValueIds) {
        const optionInfo = context.optionValueIds.map(id => ({ optionValueId: id }));
        return await strategy.calculatePrice(optionInfo, tx);
      } else {
        // fallback to basePrice
        return master.basePrice || 0;
      }
    } catch (error) {
      console.warn(
        `Failed to calculate base price for master ${context.masterId}:`,
        error.message,
      );
      return master.basePrice || 0;
    }
  }

  /**
   * Layer 2: 고객 등급별 가격 조정
   */
  private async applyCustomerTierPrice(
    basePrice: number,
    context: PriceCalculationContext,
    tx: DbTransaction,
  ): Promise<{ price: number; policy: any }> {
    // 고객 등급별 정책 조회 (우선순위: variant > master)
    const policies = await tx
      .select({
        priceType: customerTierPrices.priceType,
        value: customerTierPrices.value,
        priority: customerTierPrices.priority,
      })
      .from(customerTierPrices)
      .where(
        and(
          eq(customerTierPrices.masterId, context.masterId),
          eq(customerTierPrices.customerTier, context.customerTier),
          or(
            isNull(customerTierPrices.variantId),
            context.variantId
              ? eq(customerTierPrices.variantId, context.variantId)
              : isNull(customerTierPrices.variantId),
          ),
          or(
            isNull(customerTierPrices.validFrom),
            lte(customerTierPrices.validFrom, context.timestamp || new Date()),
          ),
          or(
            isNull(customerTierPrices.validTo),
            gte(customerTierPrices.validTo, context.timestamp || new Date()),
          ),
        ),
      )
      .orderBy(desc(customerTierPrices.priority));

    // 정책이 없으면 기준가 그대로
    if (policies.length === 0) {
      return { price: basePrice, policy: null };
    }

    // 가장 높은 우선순위 정책 적용
    const policy = policies[0];
    const adjustedPrice = this.applyPriceAdjustment(
      basePrice,
      policy.priceType,
      policy.value,
    );

    return {
      price: Math.max(0, adjustedPrice),
      policy: {
        tier: context.customerTier,
        priceType: policy.priceType,
        value: policy.value,
        discount: basePrice - adjustedPrice,
      },
    };
  }

  /**
   * Layer 3: 수량별 도매가 적용
   */
  private async applyVolumeTierPrice(
    unitPrice: number,
    context: PriceCalculationContext,
    tx: DbTransaction,
  ): Promise<{ price: number; policy: any }> {
    // 수량별 정책 조회
    const policies = await tx
      .select({
        minQuantity: volumeTierPrices.minQuantity,
        priceType: volumeTierPrices.priceType,
        value: volumeTierPrices.value,
      })
      .from(volumeTierPrices)
      .where(
        and(
          eq(volumeTierPrices.masterId, context.masterId),
          lte(volumeTierPrices.minQuantity, context.quantity),
          or(
            isNull(volumeTierPrices.variantId),
            context.variantId
              ? eq(volumeTierPrices.variantId, context.variantId)
              : isNull(volumeTierPrices.variantId),
          ),
          or(
            isNull(volumeTierPrices.requiredCustomerTier),
            eq(volumeTierPrices.requiredCustomerTier, context.customerTier),
          ),
          or(
            isNull(volumeTierPrices.validFrom),
            lte(volumeTierPrices.validFrom, context.timestamp || new Date()),
          ),
          or(
            isNull(volumeTierPrices.validTo),
            gte(volumeTierPrices.validTo, context.timestamp || new Date()),
          ),
        ),
      )
      .orderBy(desc(volumeTierPrices.minQuantity));

    // 정책이 없으면 그대로
    if (policies.length === 0) {
      return { price: unitPrice, policy: null };
    }

    // 가장 높은 수량 조건 정책 적용
    const policy = policies[0];
    const discountedPrice = this.applyPriceAdjustment(
      unitPrice,
      policy.priceType,
      policy.value,
    );

    return {
      price: Math.max(0, discountedPrice),
      policy: {
        minQuantity: policy.minQuantity,
        priceType: policy.priceType,
        value: policy.value,
        discount: unitPrice - discountedPrice,
      },
    };
  }

  /**
   * 가격 조정 계산 (공통 로직)
   */
  private applyPriceAdjustment(
    basePrice: number,
    priceType: string,
    value: number,
  ): number {
    switch (priceType) {
      case 'fixed':
      case 'fixed_unit_price':
        return value;

      case 'multiplier':
        // value가 1200이면 1.2배
        return Math.round(basePrice * (value / 1000));

      case 'adjustment':
        return basePrice + value;

      case 'discount_rate':
        // value가 500이면 5% 할인
        return Math.round(basePrice * (1 - value / 10000));

      case 'discount_amount':
        return basePrice - value;

      default:
        console.warn(`Unknown price type: ${priceType}`);
        return basePrice;
    }
  }
}

