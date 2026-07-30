import { PricingValidatorService } from './pricing-validator.service';
import { PricingCalculatorService } from './pricing-calculator.service';
import { productOptionValues, variantOptionValues } from '../../schema/catalog.schema';
import { pricingRulesSetSchema } from './dto';

// 라이브 데이터의 지배적 형태: order=1 base 룰이 all_variants 가 아니라 variants 로 variant 를 콕 집는다.
// 예전 스키마는 이걸 거절해서 가격정책 저장이 전 상품에서 막혔다 (라이브 10,760/10,809 버전).
const realWorldRules = {
  basePriceRules: [
    {
      layer: 'base_price' as const,
      order: 1,
      scopeType: 'variants' as const,
      scopeTargetIds: ['11111111-1111-4111-8111-111111111111'],
      operationType: 'override' as const,
      operationValue: 117500,
    },
  ],
  membershipPriceRules: [
    {
      layer: 'membership_price' as const,
      order: 1,
      scopeType: 'variants' as const,
      scopeTargetIds: ['11111111-1111-4111-8111-111111111111'],
      operationType: 'override' as const,
      operationValue: 100000,
    },
  ],
  tieredPriceRules: [],
};

describe('pricingRulesSetSchema', () => {
  it('order=1 base 룰이 variants 스코프여도 통과한다 (커버리지 검사는 서비스가 한다)', () => {
    expect(pricingRulesSetSchema.safeParse(realWorldRules).success).toBe(true);
  });

  it('base 룰이 아예 없으면 거절한다', () => {
    const result = pricingRulesSetSchema.safeParse({ ...realWorldRules, basePriceRules: [] });
    expect(result.success).toBe(false);
  });

  it('같은 레이어 안 order 중복은 여전히 거절한다', () => {
    const result = pricingRulesSetSchema.safeParse({
      ...realWorldRules,
      basePriceRules: [realWorldRules.basePriceRules[0], { ...realWorldRules.basePriceRules[0] }],
    });
    expect(result.success).toBe(false);
  });
});

describe('PricingValidatorService.validateBasePriceCoverage', () => {
  const VARIANT_A = '11111111-1111-4111-8111-111111111111';
  const VARIANT_B = '22222222-2222-4222-8222-222222222222';

  // variantOptionValues 조회(= matchesScope 의 with_option 경로)만 다른 행을 낸다.
  // 모든 variant 가 같은 옵션값을 갖는다고 두면 조건을 파싱할 필요가 없다.
  function makeService(
    variantIds: string[],
    optionValueIdsPerVariant: string[] = [],
    existingOptionValues = ['33333333-3333-4333-8333-333333333333'],
  ) {
    const rows = variantIds.map((id) => ({ id, variantId: id, masterId: 'master-1' }));
    const rowsFor = (table: unknown) => {
      // matchesScope 의 with_option 경로: 이 variant 가 가진 옵션값들
      if (table === variantOptionValues) return optionValueIdsPerVariant.map((optionValueId) => ({ optionValueId }));
      // validateScopeTargets 의 존재 검사: 이 마스터에 실재하는 옵션값들
      if (table === productOptionValues) return existingOptionValues.map((id) => ({ id, masterId: 'master-1' }));
      return rows;
    };
    const terminal = (table: unknown) => {
      const chain = {
        where: jest.fn(() => Promise.resolve(rowsFor(table))),
        innerJoin: jest.fn(() => chain),
      };
      return chain;
    };
    const tx = { select: jest.fn(() => ({ from: jest.fn((table: unknown) => terminal(table)) })) };

    const dbService = { run: jest.fn((fn: (trx: unknown) => unknown) => fn(tx)) };

    // 스코프 판정은 실제 계산기 로직을 쓴다 — 검증과 계산이 갈라지지 않는지가 이 테스트의 요점.
    const calculator = new PricingCalculatorService(dbService as never);

    return new PricingValidatorService(dbService as never, calculator);
  }

  it('variants 룰이 모든 variant 를 덮으면 통과한다', async () => {
    const service = makeService([VARIANT_A]);
    await expect(service.validateRuleSet('master-1', 'version-1', realWorldRules)).resolves.toBeDefined();
  });

  it('덮이지 않는 variant 가 있으면 거절한다', async () => {
    const service = makeService([VARIANT_A, VARIANT_B]);
    await expect(service.validateRuleSet('master-1', 'version-1', realWorldRules)).rejects.toThrow(
      /판매가 규칙이 적용되지 않는 옵션이 1개/,
    );
  });

  it('all_variants 룰은 variant 가 몇 개든 덮는다', async () => {
    const service = makeService([VARIANT_A, VARIANT_B]);
    const rules = {
      ...realWorldRules,
      basePriceRules: [
        {
          layer: 'base_price' as const,
          order: 1,
          scopeType: 'all_variants' as const,
          operationType: 'override' as const,
          operationValue: 117500,
        },
      ],
      membershipPriceRules: [],
    };
    await expect(service.validateRuleSet('master-1', 'version-1', rules)).resolves.toBeDefined();
  });

  // 라이브에 base_price with_option 룰이 5개 있다. 이 경로가 커버리지 계산에 반영돼야 한다.
  describe('with_option 스코프', () => {
    const OPTION_VALUE = '33333333-3333-4333-8333-333333333333';
    const withOptionRules = {
      ...realWorldRules,
      basePriceRules: [
        {
          layer: 'base_price' as const,
          order: 1,
          scopeType: 'with_option' as const,
          scopeTargetIds: [OPTION_VALUE],
          operationType: 'override' as const,
          operationValue: 117500,
        },
      ],
      membershipPriceRules: [],
    };

    it('룰이 가리키는 옵션값을 variant 들이 가지면 커버된 것으로 본다', async () => {
      const service = makeService([VARIANT_A, VARIANT_B], [OPTION_VALUE]);
      await expect(service.validateRuleSet('master-1', 'version-1', withOptionRules)).resolves.toBeDefined();
    });

    it('그 옵션값을 가진 variant 가 없으면 거절한다', async () => {
      const service = makeService([VARIANT_A, VARIANT_B], []);
      await expect(service.validateRuleSet('master-1', 'version-1', withOptionRules)).rejects.toThrow(
        /판매가 규칙이 적용되지 않는 옵션이 2개/,
      );
    });
  });
});
