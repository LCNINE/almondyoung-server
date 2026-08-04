import { ProductVersionMapper } from './product-version.mapper';
import type { ProductDetailDto } from '../../../catalog.types';

function detailFixture(overrides: Partial<ProductDetailDto> = {}): ProductDetailDto {
  // 매퍼가 읽는 필드만 채운다 — 나머지는 매퍼가 건드리지 않으므로 형태만 맞으면 된다.
  //
  // `as unknown as` 근거: ProductDetailDto 는 productMasterVersions 전 컬럼(InferSelectModel)
  // 위에 관계 6개를 얹은 타입이라 픽스처가 40여 필드를 전부 채워야 한다. 이 테스트가 보는
  // 것은 매퍼가 bulkSessionId 를 통과시키는가 하나뿐이고, 나머지 필드를 채우면 매퍼가
  // 읽지도 않는 값이 테스트 의도를 가린다. 캐스팅 범위를 이 헬퍼 하나로 가둔다.
  return {
    id: 'v1',
    masterId: 'm1',
    version: 1,
    status: 'draft',
    name: '테스트 상품',
    createdAt: new Date('2026-08-04T00:00:00Z'),
    updatedAt: new Date('2026-08-04T00:00:00Z'),
    images: [],
    categories: [],
    optionGroups: [],
    variants: [],
    channelProducts: [],
    ...overrides,
  } as unknown as ProductDetailDto;
}

describe('ProductVersionMapper', () => {
  it('includes both canonical markdown and legacy html descriptions', () => {
    const response = ProductVersionMapper.toDetailResponseDto({
      id: 'version-1',
      masterId: 'master-1',
      version: 2,
      status: 'draft',
      name: '상품',
      description: '# Markdown',
      descriptionHtml: '<img src="legacy.jpg" />',
      brand: null,
      thumbnail: null,
      seoTitle: null,
      seoDescription: null,
      seoKeywords: null,
      isWholesaleOnly: false,
      hideMembershipPriceForNonMembers: false,
      isVisibleToMembersOnly: false,
      isMembershipOnly: false,
      productType: null,
      fulfillmentKind: 'physical',
      productCode: null,
      alternativeName: null,
      material: null,
      salesClassification: null,
      purchaseClassification: null,
      shippingMethodId: null,
      marketPrice: null,
      supplyPrice: null,
      supplierId: null,
      ageRestriction: null,
      minQuantity: null,
      maxQuantity: null,
      salesStartDate: null,
      salesEndDate: null,
      parentVersionId: null,
      draftOwnerId: 'user-1',
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
      updatedAt: new Date('2026-06-05T00:00:00.000Z'),
      images: [],
      categories: [
        {
          id: 'cat-1',
          name: '스킨케어',
          slug: 'skin-care',
          path: 'beauty/skin-care',
          parentId: null,
          isActive: true,
          isPrimary: true,
        },
      ],
      optionGroups: [],
      variants: [],
      channelProducts: [],
      purchaseConstraint: {
        id: 'constraint-1',
        requiresMembership: true,
        lifetimeQuantityLimit: 3,
      },
    } as any);

    expect(response.description).toBe('# Markdown');
    expect(response.descriptionHtml).toBe('<img src="legacy.jpg" />');
    expect(response.fulfillmentKind).toBe('physical');
    expect(response.categories).toEqual([
      {
        id: 'cat-1',
        name: '스킨케어',
        slug: 'skin-care',
        path: 'beauty/skin-care',
        parentId: null,
        isActive: true,
        isPrimary: true,
      },
    ]);
    expect(response.purchaseConstraint).toEqual({
      id: 'constraint-1',
      requiresMembership: true,
      lifetimeQuantityLimit: 3,
    });
  });
});

describe('ProductVersionMapper.toDetailResponseDto — bulkSessionId', () => {
  it('일괄 세션에 잠긴 draft 는 세션 id 를 실어 보낸다', () => {
    const dto = ProductVersionMapper.toDetailResponseDto(
      detailFixture({ bulkSessionId: 'session-1' } as Partial<ProductDetailDto>),
    );
    expect(dto.bulkSessionId).toBe('session-1');
  });

  it('평범한 draft 는 null 이다', () => {
    const dto = ProductVersionMapper.toDetailResponseDto(
      detailFixture({ bulkSessionId: null } as Partial<ProductDetailDto>),
    );
    expect(dto.bulkSessionId).toBeNull();
  });
});
