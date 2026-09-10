import { PRODUCT_STREAM } from '../product.stream';

// zod 의 기본 동작은 strip 이라, 인터페이스에만 필드를 더하고 스키마를 안 고치면
// 계약 파싱이 값을 «조용히» 지운다. 스토어프론트 «상품정보» 표가 그대로 빈칸이 되는 경로다.
const productInfo = {
  productNumber: 'MG-PIG-001',
  weight: '79.1g',
  dimensions: '직경 21.5mm × 길이 100mm',
  origin: '대한민국',
  capacity: '10ml',
  expirationDate: '제조일로부터 30개월',
  manufacturer: '미곤아카데미',
  material: '티타늄 합금',
  usage: '사용 전 충분히 흔들어 주세요',
};

const payload = {
  masterId: 'master-1',
  versionId: 'version-1',
  name: '미곤 컬러마스터 색소',
  previousActiveVersionId: null,
  changeReason: 'published',
  changedAt: '2026-09-10T00:00:00.000Z',
  snapshot: {
    masterId: 'master-1',
    versionId: 'version-1',
    version: 1,
    name: '미곤 컬러마스터 색소',
    variants: [
      {
        id: 'variant-1',
        variantName: '기본 품목',
        sku: 'variant-1',
        isDefault: true,
        status: 'active',
        basePrice: 188100,
      },
    ],
    status: 'active',
    isWholesaleOnly: false,
    hideMembershipPriceForNonMembers: false,
    isVisibleToMembersOnly: false,
    isOverseas: false,
    isMembershipOnly: false,
    isGiftcard: false,
    discountable: true,
    productInfo,
  },
};

describe('PRODUCT_STREAM ProductMasterActiveVersionChanged productInfo', () => {
  const schema = PRODUCT_STREAM.events.ProductMasterActiveVersionChanged.schema!;

  it('carries every productInfo key through contract parsing', () => {
    const parsed = schema.parse(payload);

    expect(parsed.snapshot?.productInfo).toEqual(productInfo);
  });

  it('accepts a snapshot without productInfo', () => {
    const parsed = schema.parse({
      ...payload,
      snapshot: { ...payload.snapshot, productInfo: undefined },
    });

    expect(parsed.snapshot?.productInfo).toBeUndefined();
  });

  it('accepts a partially filled productInfo', () => {
    const parsed = schema.parse({
      ...payload,
      snapshot: { ...payload.snapshot, productInfo: { capacity: '50ml' } },
    });

    expect(parsed.snapshot?.productInfo).toEqual({ capacity: '50ml' });
  });
});
