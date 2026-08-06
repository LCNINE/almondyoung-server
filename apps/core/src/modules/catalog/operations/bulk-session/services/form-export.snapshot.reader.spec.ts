import { NotFoundException } from '@nestjs/common';
import { CategoryTreeResponseDto } from '../../../core/categories/dto';
import { ProductCategoriesService } from '../../../core/categories/categories.service';
import { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';
import { ProductVersionReadLoader } from '../../../core/products/loaders/product-version-read.loader';
import { PricingService } from '../../../core/pricing/pricing.service';
import { PricingRulesResponseDto } from '../../../core/pricing/dto';
import { DbTransaction } from '../../../catalog.types';
import { ProductSkuMappingService } from '../../../../product-matching/services/product-sku-mapping.service';
import { createImageKeyAllocator, type ImageKeyAllocator } from './form-export.types';
import { FormExportSnapshotReader } from './form-export.snapshot.reader';

/**
 * `buildPrefill` 의 active-버전-조회 catch 가 NotFoundException 만 삼키고 그 밖은 던지는지를
 * 본다. 실 Postgres 통합 스펙(form-export-snapshot.integration.spec.ts)으로는 이 분기를
 * 정확히 겨냥할 수 없다 — buildPrefill 은 masterId 루프보다 먼저 getCategoryTree() 를
 * 한 번 읽는데, 그 호출엔 catch 가 없어서 트랜잭션을 미리 abort 시켜 놓으면 루프까지
 * 가기도 전에 거기서 먼저 던져버린다(같은 결론 "던진다"에 도달하지만 다른 코드경로를
 * 검증한 것이다). 여기서는 로더를 직접 목으로 바꿔 getActiveVersion 자체가 다른 에러를
 * 던지는 상황을 만든다.
 */
describe('FormExportSnapshotReader — getActiveVersion 에러 처리 (단위)', () => {
  const emptyRules: PricingRulesResponseDto = { basePriceRules: [], membershipPriceRules: [], tieredPriceRules: [] };
  const emptyTree: CategoryTreeResponseDto = { categories: [], totalCount: 0, maxDepth: 0 };
  // DbTransaction 은 실제 트랜잭션 핸들이 커야 하지만 이 스위트의 모든 협력자가 목이라
  // 실제로 쓰이지 않는다 — 인자 자리 채우기용.
  const tx = {} as unknown as DbTransaction;

  function makeReader(getActiveVersion: jest.Mock) {
    // 4개 협력자 전부 이 스위트가 실제로 건드리는 메서드만 목으로 채운다 — 나머지
    // 메서드는 이 테스트가 절대 도달하지 않는 코드경로라 필요 없다(any/as 캐스팅은
    // 이 테스트 전용 부분 목이라는 문서화된 이유가 있다. 실 로더 계약 검증은
    // form-export-snapshot.integration.spec.ts 가 실 Postgres 로 한다).
    const versionLoader = {
      getActiveVersion,
      getImages: jest.fn().mockResolvedValue([]),
      getVariants: jest.fn().mockResolvedValue([]),
      getCategories: jest.fn().mockResolvedValue([]),
      getPurchaseConstraint: jest.fn().mockResolvedValue(null),
    } as unknown as ProductVersionReadLoader;
    const optionLoader = {
      getOptionGroups: jest.fn().mockResolvedValue([]),
      getVariantOptionValues: jest.fn().mockResolvedValue([]),
    } as unknown as OptionReadLoader;
    const pricing = {
      getVersionRules: jest.fn().mockResolvedValue(emptyRules),
    } as unknown as PricingService;
    const categories = {
      getCategoryTree: jest.fn().mockResolvedValue(emptyTree),
    } as unknown as ProductCategoriesService;
    // 이 스위트는 variantId 를 안 만드니(getVariants 가 늘 []) skuMapping 은 절대 안 불린다 —
    // 생성자 인자 수만 맞추면 되는 자리 채우기용.
    const skuMapping = { getVariantMatchingBatch: jest.fn() } as unknown as ProductSkuMappingService;

    return new FormExportSnapshotReader(versionLoader, optionLoader, pricing, categories, skuMapping);
  }

  it('NotFoundException 은 해당 masterId 만 건너뛰고 나머지는 정상 처리한다', async () => {
    const getActiveVersion = jest
      .fn()
      .mockRejectedValueOnce(new NotFoundException('no active version'))
      .mockResolvedValueOnce({ id: 'version-2', name: '살아있는 상품' });
    const reader = makeReader(getActiveVersion);

    const { data, items } = await reader.buildPrefill(tx, ['missing-master', 'live-master'], 'exp-unit');

    expect(data.products).toHaveLength(1);
    expect(data.products[0].name).toBe('살아있는 상품');
    expect(items).toEqual([
      {
        masterId: 'live-master',
        versionId: 'version-2',
        rowKey: 'P-000001',
        pricingEditable: true,
        snapshot: expect.any(Object) as unknown,
      },
    ]);
  });

  it('NotFoundException 이 아닌 에러는 삼키지 않고 그대로 던진다 — 뒤 masterId 도 처리하지 않는다', async () => {
    const boom = new Error('connection reset');
    const getActiveVersion = jest
      .fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce({ id: 'version-2', name: '절대 여기까지 오면 안 된다' });
    const reader = makeReader(getActiveVersion);

    await expect(reader.buildPrefill(tx, ['broken-master', 'live-master'], 'exp-unit-throw')).rejects.toBe(boom);
    // 두 번째 masterId 는 첫 에러가 던져진 시점에 아직 처리되지 않았어야 한다.
    expect(getActiveVersion).toHaveBeenCalledTimes(1);
  });
});

/**
 * `renderMaster` 가 품목(variant) 판매정책을 프리필에 채우는지를 본다. 우선순위 재구현
 * 여부는 여기서 검증하지 않는다(그건 ProductSkuMappingService 자신의 스펙 몫이다) —
 * 대신 그 서비스가 돌려준 stockPolicy 를 리더가 **그대로 받아 워크북 표기로만 옮기는지**를
 * 본다. skuMapping 을 목으로 넣어 배치 응답을 통제한다.
 */
describe('FormExportSnapshotReader — renderMaster 판매정책 프리필', () => {
  const emptyRules: PricingRulesResponseDto = { basePriceRules: [], membershipPriceRules: [], tieredPriceRules: [] };
  const tx = {} as unknown as DbTransaction;

  let reader: FormExportSnapshotReader;
  let allocator: ImageKeyAllocator;
  let skuMapping: { getVariantMatchingBatch: jest.Mock };

  beforeEach(() => {
    const versionLoader = {
      getActiveVersion: jest.fn().mockResolvedValue({
        id: 'version-1',
        name: '테스트 상품',
        productCode: 'PC-1',
        brand: null,
        description: null,
        alternativeName: null,
        material: null,
        marketPrice: null,
        supplyPrice: null,
        productType: null,
        fulfillmentKind: null,
        salesClassification: null,
        purchaseClassification: null,
        ageRestriction: null,
        minQuantity: null,
        maxQuantity: null,
        seller: null,
        isOverseas: false,
        isVisibleToMembersOnly: false,
        hideMembershipPriceForNonMembers: false,
        isWholesaleOnly: false,
        seoTitle: null,
        seoDescription: null,
        seoKeywords: null,
        salesStartDate: null,
        salesEndDate: null,
      }),
      getImages: jest.fn().mockResolvedValue([]),
      // 프리필이 배치 조회에 넘길 variantId 를 이 목이 결정한다 — 아래 세 테스트의
      // skuMapping 응답은 전부 이 id('v1')를 답한다고 가정한다.
      getVariants: jest.fn().mockResolvedValue([{ id: 'v1', variantCode: 'VC-1' }]),
      getCategories: jest.fn().mockResolvedValue([]),
      getPurchaseConstraint: jest.fn().mockResolvedValue(null),
    } as unknown as ProductVersionReadLoader;
    const optionLoader = {
      getOptionGroups: jest.fn().mockResolvedValue([]),
      getVariantOptionValues: jest.fn().mockResolvedValue([]),
    } as unknown as OptionReadLoader;
    const pricing = {
      getVersionRules: jest.fn().mockResolvedValue(emptyRules),
    } as unknown as PricingService;
    const categories = {
      getCategoryTree: jest.fn().mockResolvedValue({ categories: [], totalCount: 0, maxDepth: 0 }),
    } as unknown as ProductCategoriesService;
    skuMapping = { getVariantMatchingBatch: jest.fn() };

    reader = new FormExportSnapshotReader(
      versionLoader,
      optionLoader,
      pricing,
      categories,
      skuMapping as unknown as ProductSkuMappingService,
    );
    allocator = createImageKeyAllocator();
  });

  it('프리필이 화면과 같은 우선순위로 판매정책을 채운다', async () => {
    skuMapping.getVariantMatchingBatch.mockResolvedValue({
      data: [
        {
          variantId: 'v1',
          exists: true,
          matching: null,
          stockPolicy: {
            preStockSellable: true,
            alwaysSellableZeroStock: false,
            availabilityOverride: 'manual_out_of_stock',
            comingSoonDate: null,
          },
          projection: null,
        },
      ],
    });

    const bundle = await reader.renderMaster(tx, 'master-1', allocator, new Map());

    expect(bundle?.variants[0]).toMatchObject({
      availabilityOverride: '품절',
      comingSoonDate: '',
      preStockSellable: 'Y',
      alwaysSellableZeroStock: 'N',
    });
  });

  it('출시예정은 날짜와 함께 찍힌다', async () => {
    skuMapping.getVariantMatchingBatch.mockResolvedValue({
      data: [
        {
          variantId: 'v1',
          exists: true,
          matching: null,
          stockPolicy: {
            preStockSellable: false,
            alwaysSellableZeroStock: true,
            availabilityOverride: 'coming_soon',
            comingSoonDate: '2026-09-01',
          },
          projection: null,
        },
      ],
    });

    const bundle = await reader.renderMaster(tx, 'master-1', allocator, new Map());

    expect(bundle?.variants[0]).toMatchObject({
      availabilityOverride: '출시예정',
      comingSoonDate: '2026-09-01',
      preStockSellable: 'N',
      alwaysSellableZeroStock: 'Y',
    });
  });

  it('정책 행이 없는 품목은 기본값으로 찍힌다', async () => {
    skuMapping.getVariantMatchingBatch.mockResolvedValue({ data: [] });

    const bundle = await reader.renderMaster(tx, 'master-1', allocator, new Map());

    expect(bundle?.variants[0]).toMatchObject({
      availabilityOverride: '',
      comingSoonDate: '',
      preStockSellable: 'Y',
      alwaysSellableZeroStock: 'N',
    });
  });
});
