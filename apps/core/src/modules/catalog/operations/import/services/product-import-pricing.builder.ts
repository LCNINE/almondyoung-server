import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { ReplacePricingRulesDto } from '../../../core/pricing/dto';
import { ProductRecord } from '../dto/import.types';

/**
 * 엑셀 가격 컬럼 → pricing rules 변환. DB 접근이 없는 순수 변환이라 단위테스트가 쉽다.
 *
 * pricingRulesSetSchema 제약: order 1 인 첫 base_price 규칙은 scopeType 이
 * all_variants 여야 한다. 그래서 Products 시트 basePrice 가 필수다.
 */
@Injectable()
export class ProductImportPricingBuilder {
  build(record: ProductRecord, comboMap: Map<string, string>): ReplacePricingRulesDto {
    if (typeof record.basePrice !== 'number') {
      throw new BadRequestError(`basePrice 가 없어 가격 규칙을 만들 수 없습니다: ${record.productKey}`);
    }

    const basePriceRules: ReplacePricingRulesDto['basePriceRules'] = [
      {
        layer: 'base_price',
        order: 1,
        scopeType: 'all_variants',
        operationType: 'override',
        operationValue: record.basePrice,
      },
    ];
    const membershipPriceRules: ReplacePricingRulesDto['membershipPriceRules'] = [];

    if (typeof record.membershipPrice === 'number') {
      membershipPriceRules.push({
        layer: 'membership_price',
        order: 1,
        scopeType: 'all_variants',
        operationType: 'override',
        operationValue: record.membershipPrice,
      });
    }

    let baseOrder = 2;
    let memberOrder = membershipPriceRules.length + 1;

    for (const override of record.variantOverrides) {
      const variantId = comboMap.get(override.comboKey);
      if (!variantId) {
        // normalizer 가 조합을 검증했으므로 여기 도달하면 variant 생성과 어긋난 것이다.
        // 조용히 버리면 가격이 빠진 채로 게시되므로 실패시킨다.
        throw new BadRequestError(
          `조합에 해당하는 variant 를 찾을 수 없습니다: ${override.comboKey} (${record.productKey})`,
        );
      }

      if (typeof override.basePrice === 'number') {
        basePriceRules.push({
          layer: 'base_price',
          order: baseOrder++,
          scopeType: 'variants',
          scopeTargetIds: [variantId],
          operationType: 'override',
          operationValue: override.basePrice,
        });
      }
      if (typeof override.membershipPrice === 'number') {
        membershipPriceRules.push({
          layer: 'membership_price',
          order: memberOrder++,
          scopeType: 'variants',
          scopeTargetIds: [variantId],
          operationType: 'override',
          operationValue: override.membershipPrice,
        });
      }
    }

    return { basePriceRules, membershipPriceRules, tieredPriceRules: [] };
  }
}
