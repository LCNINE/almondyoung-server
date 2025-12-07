import { z } from 'zod';
import type { Scenario } from '../types';

/**
 * PIM Pricing API Test Scenarios
 *
 * Coverage: 5 endpoints
 * - GET /products/:masterId/pricing/rules
 * - PUT /products/:masterId/pricing/rules
 * - DELETE /products/:masterId/pricing/rules
 * - POST /products/:masterId/pricing/calculate
 * - GET /products/:masterId/pricing/price-set
 *
 * Total Scenarios: 12
 */

export const pricingScenarios: Scenario[] = [
  // ========================================
  // Group 1: 기본 CRUD 테스트 (PRICE-001 ~ PRICE-003)
  // ========================================
  {
    id: 'PRICE-001',
    name: '기본 가격 규칙 생성 → 조회 → 삭제',
    category: 'PIM > Pricing',
    validation: '단순한 base_price 규칙 CRUD 플로우 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Pricing Test Product {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [
                  { displayName: 'Red' },
                  { displayName: 'Blue' },
                ],
              },
              {
                displayName: 'Size',
                values: [
                  { displayName: 'S' },
                  { displayName: 'M' },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가 (4개 variants 자동 생성)',
      },
      {
        id: 'set-pricing-rules',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: 'Base price 규칙 생성 (10,000원)',
        responseSchema: z.object({
          basePriceRules: z.array(
            z.object({
              id: z.string().uuid(),
              order: z.literal(1),
              layer: z.literal('base_price'),
              scopeType: z.literal('all_variants'),
              operationType: z.literal('override'),
              operationValue: z.literal(10000),
            }),
          ),
          membershipPriceRules: z.array(z.any()),
          tieredPriceRules: z.array(z.any()),
        }),
      },
      {
        id: 'get-pricing-rules',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 200,
        description: '가격 규칙 조회',
        responseSchema: z.object({
          basePriceRules: z.array(z.object({ operationValue: z.literal(10000) })),
        }),
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'delete-pricing-rules',
        method: 'DELETE',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 204,
        description: '가격 규칙 삭제',
      },
      {
        id: 'verify-empty-rules',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 200,
        description: '규칙 삭제 확인 (빈 배열)',
        responseSchema: z.object({
          basePriceRules: z.array(z.any()).length(0),
          membershipPriceRules: z.array(z.any()).length(0),
          tieredPriceRules: z.array(z.any()).length(0),
        }),
      },
    ],
  },

  {
    id: 'PRICE-002',
    name: '다층 가격 규칙 생성 (base + membership + tiered)',
    category: 'PIM > Pricing',
    validation: '3개 레이어 모두 사용, 순차 적용 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Multi-layer Pricing {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [
                  { displayName: 'Red' },
                  { displayName: 'Blue' },
                ],
              },
              {
                displayName: 'Size',
                values: [
                  { displayName: 'S' },
                  { displayName: 'M' },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
        extractFromResponse: {
          redColorId: 'optionGroups.0.values.0.id',
        },
      },
      {
        id: 'set-multilayer-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 20000,
            },
            {
              order: 2,
              layer: 'base_price',
              scopeType: 'with_option',
              scopeTargetIds: ['{{redColorId}}'],
              operationType: 'offset',
              operationValue: 5000,
            },
          ],
          membershipPriceRules: [
            {
              order: 1,
              layer: 'membership_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -100,
            },
          ],
          tieredPriceRules: [
            {
              order: 1,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -50,
              minQuantity: 10,
            },
            {
              order: 2,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -100,
              minQuantity: 50,
            },
          ],
        },
        expectedStatus: 200,
        description: '다층 가격 규칙 설정',
      },
      {
        id: 'verify-all-layers',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 200,
        description: '모든 레이어 규칙 조회',
        responseSchema: z.object({
          basePriceRules: z.array(z.any()).min(2),
          membershipPriceRules: z.array(z.any()).min(1),
          tieredPriceRules: z.array(z.any()).min(2),
        }),
      },
    ],
  },

  {
    id: 'PRICE-003',
    name: '가격 규칙 교체 (Replace)',
    category: 'PIM > Pricing',
    validation: '기존 규칙 완전 교체 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Replace Test {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [{ displayName: 'Red' }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'set-initial-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 15000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: '초기 가격 규칙 설정 (15,000원)',
        extractFromResponse: {
          initialRuleId: 'basePriceRules.0.id',
        },
      },
      {
        id: 'verify-initial-pricing',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 200,
        description: '초기 규칙 확인',
        responseSchema: z.object({
          basePriceRules: z.array(
            z.object({
              operationValue: z.literal(15000),
            }),
          ),
        }),
      },
      {
        id: 'replace-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 25000,
            },
          ],
          membershipPriceRules: [
            {
              order: 1,
              layer: 'membership_price',
              scopeType: 'all_variants',
              operationType: 'offset',
              operationValue: -3000,
            },
          ],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: '가격 규칙 교체 (25,000원 + 멤버십 할인)',
        extractFromResponse: {
          newRuleId: 'basePriceRules.0.id',
        },
      },
      {
        id: 'verify-replaced-pricing',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 200,
        description: '교체된 규칙 확인',
        responseSchema: z.object({
          basePriceRules: z.array(
            z.object({
              operationValue: z.literal(25000),
            }),
          ),
          membershipPriceRules: z.array(
            z.object({
              operationValue: z.literal(-3000),
            }),
          ),
        }),
      },
    ],
  },

  // ========================================
  // Group 2: 가격 계산 테스트 (PRICE-004 ~ PRICE-007)
  // ========================================
  {
    id: 'PRICE-004',
    name: '단순 가격 계산 (regular customer)',
    category: 'PIM > Pricing',
    validation: 'Base price 레이어만 적용, regular 고객 계산',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Calculate Test {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [
                  { displayName: 'Red' },
                  { displayName: 'Blue' },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
        extractFromResponse: {
          redVariantId: 'variants.0.id',
        },
      },
      {
        id: 'set-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: 'Base price 설정 (10,000원)',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'calculate-price',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{redVariantId}}',
          customerType: 'regular',
        },
        expectedStatus: 200,
        description: 'Regular 고객 가격 계산',
        responseSchema: z.object({
          variantId: z.string(),
          price: z.literal(10000),
          totalPrice: z.undefined(),
          appliedRules: z.array(z.any()).length(1),
          priceBreakdown: z.object({
            initialPrice: z.literal(0),
            afterBasePrice: z.literal(10000),
          }),
        }),
      },
    ],
  },

  {
    id: 'PRICE-005',
    name: '멤버십 가격 계산',
    category: 'PIM > Pricing',
    validation: 'Membership price 레이어 적용',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Membership Pricing {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [{ displayName: 'Red' }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
        extractFromResponse: {
          variantId: 'variants.0.id',
        },
      },
      {
        id: 'set-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 20000,
            },
          ],
          membershipPriceRules: [
            {
              order: 1,
              layer: 'membership_price',
              scopeType: 'all_variants',
              operationType: 'offset',
              operationValue: -3000,
            },
          ],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: 'Base 20,000원 + Membership -3,000원',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'calculate-membership-price',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{variantId}}',
          customerType: 'membership',
          quantity: 1,
        },
        expectedStatus: 200,
        description: 'Membership 고객 가격 계산',
        responseSchema: z.object({
          price: z.literal(17000),
          totalPrice: z.literal(17000),
          appliedRules: z.array(z.any()).length(2),
          priceBreakdown: z.object({
            afterBasePrice: z.literal(20000),
            afterMembershipPrice: z.literal(17000),
          }),
        }),
      },
    ],
  },

  {
    id: 'PRICE-006',
    name: '대량 구매 계층 가격 계산',
    category: 'PIM > Pricing',
    validation: 'Tiered price 적용 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Tiered Pricing {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [{ displayName: 'Red' }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
        extractFromResponse: {
          variantId: 'variants.0.id',
        },
      },
      {
        id: 'set-tiered-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 50000,
            },
          ],
          membershipPriceRules: [
            {
              order: 1,
              layer: 'membership_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -100,
            },
          ],
          tieredPriceRules: [
            {
              order: 1,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -50,
              minQuantity: 10,
            },
            {
              order: 2,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -100,
              minQuantity: 100,
            },
          ],
        },
        expectedStatus: 200,
        description: 'Tiered pricing 설정 (10개/100개 단위)',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'calculate-qty-5',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{variantId}}',
          customerType: 'membership',
          quantity: 5,
        },
        expectedStatus: 200,
        description: '5개 구매 (tiered 미적용)',
        responseSchema: z.object({
          price: z.literal(45000),
        }),
      },
      {
        id: 'calculate-qty-15',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{variantId}}',
          customerType: 'membership',
          quantity: 15,
        },
        expectedStatus: 200,
        description: '15개 구매 (10개 이상 5% 추가 할인)',
        responseSchema: z.object({
          price: z.literal(42750),
        }),
      },
      {
        id: 'calculate-qty-120',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{variantId}}',
          customerType: 'membership',
          quantity: 120,
        },
        expectedStatus: 200,
        description: '120개 구매 (100개 이상 10% 추가 할인)',
        responseSchema: z.object({
          price: z.literal(40500),
        }),
      },
    ],
  },

  {
    id: 'PRICE-007',
    name: 'Scope 타입별 가격 차등 적용',
    category: 'PIM > Pricing',
    validation: 'all_variants, with_option, variants 스코프 테스트',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Scope Test {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [
                  { displayName: 'Red' },
                  { displayName: 'Blue' },
                  { displayName: 'Green' },
                ],
              },
              {
                displayName: 'Size',
                values: [
                  { displayName: 'S' },
                  { displayName: 'M' },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가 (6개 variants)',
        extractFromResponse: {
          redColorId: 'optionGroups.0.values.0.id',
          redSVariantId: 'variants.0.id',
          blueSVariantId: 'variants.2.id',
          greenSVariantId: 'variants.4.id',
        },
      },
      {
        id: 'set-scope-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
            },
            {
              order: 2,
              layer: 'base_price',
              scopeType: 'with_option',
              scopeTargetIds: ['{{redColorId}}'],
              operationType: 'offset',
              operationValue: 2000,
            },
            {
              order: 3,
              layer: 'base_price',
              scopeType: 'variants',
              scopeTargetIds: ['{{blueSVariantId}}'],
              operationType: 'offset',
              operationValue: 5000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: '3가지 scope type 규칙 설정',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'calculate-red-variant',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{redSVariantId}}',
          customerType: 'regular',
        },
        expectedStatus: 200,
        description: 'Red/S variant 가격 계산',
        responseSchema: z.object({
          price: z.literal(12000),
        }),
      },
      {
        id: 'calculate-blue-variant',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{blueSVariantId}}',
          customerType: 'regular',
        },
        expectedStatus: 200,
        description: 'Blue/S variant 가격 계산',
        responseSchema: z.object({
          price: z.literal(15000),
        }),
      },
      {
        id: 'calculate-green-variant',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{greenSVariantId}}',
          customerType: 'regular',
        },
        expectedStatus: 200,
        description: 'Green/S variant 가격 계산',
        responseSchema: z.object({
          price: z.literal(10000),
        }),
      },
    ],
  },

  // ========================================
  // Group 3: 가격표 조회 테스트 (PRICE-008 ~ PRICE-009)
  // ========================================
  {
    id: 'PRICE-008',
    name: '전체 가격표 조회 (Price Set)',
    category: 'PIM > Pricing',
    validation: '한 번에 base/membership/tiered 가격 모두 조회',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Price Set Test {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [{ displayName: 'Red' }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
        extractFromResponse: {
          variantId: 'variants.0.id',
        },
      },
      {
        id: 'set-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 30000,
            },
          ],
          membershipPriceRules: [
            {
              order: 1,
              layer: 'membership_price',
              scopeType: 'all_variants',
              operationType: 'offset',
              operationValue: -5000,
            },
          ],
          tieredPriceRules: [
            {
              order: 1,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'offset',
              operationValue: -3000,
              minQuantity: 10,
            },
            {
              order: 2,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'offset',
              operationValue: -7000,
              minQuantity: 50,
            },
          ],
        },
        expectedStatus: 200,
        description: '다층 가격 설정',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-price-set',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/price-set',
        queryParams: {
          variantId: '{{variantId}}',
        },
        expectedStatus: 200,
        description: '가격 세트 조회',
        responseSchema: z.object({
          basePrice: z.literal(30000),
          membershipPrice: z.literal(25000),
          tieredPrices: z.array(
            z.object({
              minQuantity: z.number(),
              price: z.number(),
            }),
          ).length(2),
        }),
      },
    ],
  },

  {
    id: 'PRICE-009',
    name: '특정 버전의 Price Set 조회',
    category: 'PIM > Pricing',
    validation: '버전별 독립적인 가격 규칙',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', version1Id: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        body: {
          name: 'Version Pricing {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [{ displayName: 'Red' }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
        extractFromResponse: {
          variantId: 'variants.0.id',
        },
      },
      {
        id: 'set-version1-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: 'Version 1 가격 설정 (10,000원)',
      },
      {
        id: 'publish-version1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: 'Version 1 Publish',
      },
      {
        id: 'create-version2',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {
          copyMappings: true,
        },
        expectedStatus: 201,
        description: 'Version 2 생성',
        extractFromResponse: { version2Id: 'id' },
      },
      {
        id: 'set-version2-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        queryParams: {
          versionId: '{{version2Id}}',
        },
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 20000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: 'Version 2 가격 설정 (20,000원)',
      },
      {
        id: 'publish-version2',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: 'Version 2 Publish',
      },
      {
        id: 'get-active-price-set',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/price-set',
        queryParams: {
          variantId: '{{variantId}}',
        },
        expectedStatus: 200,
        description: 'Active 버전 가격 조회 (Version 2)',
        responseSchema: z.object({
          basePrice: z.literal(20000),
        }),
      },
      {
        id: 'get-version1-price-set',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/price-set',
        queryParams: {
          variantId: '{{variantId}}',
          versionId: '{{version1Id}}',
        },
        expectedStatus: 200,
        description: 'Version 1 가격 조회',
        responseSchema: z.object({
          basePrice: z.literal(10000),
        }),
      },
    ],
  },

  // ========================================
  // Group 4: 오류 케이스 테스트 (PRICE-010 ~ PRICE-012)
  // ========================================
  {
    id: 'PRICE-010',
    name: '가격 규칙 검증 오류',
    category: 'PIM > Pricing',
    validation: 'Zod schema 검증 및 비즈니스 룰 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Validation Test {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [{ displayName: 'Red' }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'error-missing-base-all-variants',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'variants',
              scopeTargetIds: ['fake-uuid'],
              operationType: 'override',
              operationValue: 10000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 400,
        description: '첫 base_price 규칙이 all_variants가 아님',
      },
      {
        id: 'error-duplicate-order',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
            },
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'offset',
              operationValue: 1000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 400,
        description: '동일 레이어 내 중복 order',
      },
      {
        id: 'error-tiered-without-minQuantity',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [
            {
              order: 1,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'offset',
              operationValue: -1000,
            },
          ],
        },
        expectedStatus: 400,
        description: 'tiered_price에 minQuantity 누락',
      },
      {
        id: 'error-base-with-minQuantity',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
              minQuantity: 10,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 400,
        description: 'base_price에 minQuantity 설정',
      },
    ],
  },

  {
    id: 'PRICE-011',
    name: 'Active/Inactive 버전 가격 규칙 수정 불가',
    category: 'PIM > Pricing',
    validation: 'Draft 버전만 수정 가능',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', version1Id: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        body: {
          name: 'Active Version Test {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [{ displayName: 'Red' }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'publish-version1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: 'Version 1 Publish (Active)',
      },
      {
        id: 'error-modify-active-version',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 400,
        description: 'Active 버전 수정 시도 (실패)',
      },
      {
        id: 'error-delete-active-version',
        method: 'DELETE',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 400,
        description: 'Active 버전 삭제 시도 (실패)',
      },
      {
        id: 'create-version2',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {
          copyMappings: true,
        },
        expectedStatus: 201,
        description: 'Version 2 생성 (Draft)',
        extractFromResponse: { version2Id: 'id' },
      },
      {
        id: 'success-modify-draft',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        queryParams: {
          versionId: '{{version2Id}}',
        },
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 15000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 200,
        description: 'Draft 버전 수정 성공',
      },
      {
        id: 'publish-version2',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: 'Version 2 Publish',
      },
      {
        id: 'error-modify-inactive-version',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        queryParams: {
          versionId: '{{version1Id}}',
        },
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 20000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        expectedStatus: 400,
        description: 'Inactive 버전 수정 시도 (실패)',
      },
    ],
  },

  {
    id: 'PRICE-012',
    name: '복잡한 실전 시나리오 (종합)',
    category: 'PIM > Pricing',
    validation: '전체 플로우 통합 테스트',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Complex Pricing {{timestamp}}',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [
                  { displayName: 'Red' },
                  { displayName: 'Blue' },
                  { displayName: 'Green' },
                ],
              },
              {
                displayName: 'Size',
                values: [
                  { displayName: 'S' },
                  { displayName: 'M' },
                  { displayName: 'L' },
                ],
              },
              {
                displayName: 'Material',
                values: [
                  { displayName: 'Cotton' },
                  { displayName: 'Polyester' },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가 (18개 variants)',
        extractFromResponse: {
          redColorId: 'optionGroups.0.values.0.id',
          redSCottonVariantId: 'variants.0.id',
          blueSCottonVariantId: 'variants.6.id',
          largeVariants: 'variants',
        },
      },
      {
        id: 'set-complex-pricing',
        method: 'PUT',
        path: '/products/{{masterId}}/pricing/rules',
        body: {
          basePriceRules: [
            {
              order: 1,
              layer: 'base_price',
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 100000,
            },
            {
              order: 2,
              layer: 'base_price',
              scopeType: 'with_option',
              scopeTargetIds: ['{{redColorId}}'],
              operationType: 'offset',
              operationValue: 10000,
            },
          ],
          membershipPriceRules: [
            {
              order: 1,
              layer: 'membership_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -150,
            },
          ],
          tieredPriceRules: [
            {
              order: 1,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -50,
              minQuantity: 20,
            },
            {
              order: 2,
              layer: 'tiered_price',
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -100,
              minQuantity: 100,
            },
          ],
        },
        expectedStatus: 200,
        description: '복잡한 다층 가격 규칙 설정',
      },
      {
        id: 'verify-rules',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 200,
        description: '모든 규칙 조회',
        responseSchema: z.object({
          basePriceRules: z.array(z.any()).length(2),
          membershipPriceRules: z.array(z.any()).length(1),
          tieredPriceRules: z.array(z.any()).length(2),
        }),
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'calculate-regular-red',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{redSCottonVariantId}}',
          customerType: 'regular',
          quantity: 1,
        },
        expectedStatus: 200,
        description: 'Regular 고객, Red variant, qty 1',
        responseSchema: z.object({
          price: z.literal(110000),
        }),
      },
      {
        id: 'calculate-membership-red',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{redSCottonVariantId}}',
          customerType: 'membership',
          quantity: 1,
        },
        expectedStatus: 200,
        description: 'Membership 고객, Red variant, qty 1',
        responseSchema: z.object({
          price: z.literal(93500),
        }),
      },
      {
        id: 'calculate-membership-red-tiered',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{redSCottonVariantId}}',
          customerType: 'membership',
          quantity: 25,
        },
        expectedStatus: 200,
        description: 'Membership 고객, Red variant, qty 25',
        responseSchema: z.object({
          price: z.literal(88825),
        }),
      },
      {
        id: 'calculate-blue-variant',
        method: 'POST',
        path: '/products/{{masterId}}/pricing/calculate',
        body: {
          variantId: '{{blueSCottonVariantId}}',
          customerType: 'membership',
          quantity: 1,
        },
        expectedStatus: 200,
        description: 'Membership 고객, Blue variant, qty 1',
        responseSchema: z.object({
          price: z.literal(85000),
        }),
      },
      {
        id: 'get-price-set',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/price-set',
        queryParams: {
          variantId: '{{redSCottonVariantId}}',
        },
        expectedStatus: 200,
        description: 'Red variant 가격 세트 조회',
        responseSchema: z.object({
          basePrice: z.literal(110000),
          membershipPrice: z.literal(93500),
          tieredPrices: z.array(z.any()).min(1),
        }),
      },
      {
        id: 'delete-all-rules',
        method: 'DELETE',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 204,
        description: '모든 가격 규칙 삭제',
      },
      {
        id: 'verify-deleted-rules',
        method: 'GET',
        path: '/products/{{masterId}}/pricing/rules',
        expectedStatus: 200,
        description: '규칙 삭제 확인',
        responseSchema: z.object({
          basePriceRules: z.array(z.any()).length(0),
        }),
      },
    ],
  },
];
