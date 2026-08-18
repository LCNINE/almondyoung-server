import { SQL, and, desc, eq, isNull } from 'drizzle-orm';
import {
  channelVariantListings,
  productMasterVariants,
  productMasterVersions,
  productMasters,
  productVariants,
  salesChannels,
} from '../../schema/catalog.schema';
import { DbClient } from '../../catalog.types';

/**
 * 리스팅 조회가 요구하는 "지금 이 채널에서 팔리는가" 술어.
 *
 * 이게 없으면 조회 조인이 팔리지 않는 상태를 통해서도 성립해 **null 대신 값이 반환된다** —
 * 격리도 로그도 없이 채널 주문이 판매주문으로 넘어간다. 세 축을 모두 봐야 하고, 한 축만
 * 빠져도 증상은 같다.
 *
 * **버전 축** (#666·#652): 옛 판매정책·옛 SKU 스냅샷으로 처리되는 것을 막는다. publish 승계
 * (reconciler)는 publish 라는 사건에만 반응하므로, 그 사건을 안 거치고 낡는 경로(#663 승인
 * 우회 · #664 판매중지 · #665 레이스 · hardDelete)는 이 술어만이 막는다. soft delete 는
 * `status` 를 그대로 두고 `deletedAt` 만 세우므로 둘 다 봐야 한다.
 *
 * **품목 축** (#670): `product_variants.status` 는 가용재고 계산이 **판매 게이트로 쓰는 값**
 * 이다(`product-sellable-quantity.calculator.ts` 의 `variantStatus !== 'active'`). "블랙 L
 * 사이즈만 판매중지" 는 실재하는 운영 동작이라, 이 축이 빠지면 가용재고 0/판매불가인 품목으로
 * 채널 주문이 정상 수집돼 판매주문이 생성된다.
 *
 * **채널 축** (#670 곁가지): 리스팅의 `is_active` 만 보고 채널 자체의 `is_active` 를 안 보면
 * 꺼둔 채널의 매핑도 그대로 해석된다. 지금은 폴러 게이트(#654/#660)가 수집을 먼저 막아
 * 도달 경로가 없지만, 조회 자체는 열려 있었다 — 게이트가 유일한 방어선이면 안 된다.
 *
 * 이름을 버전 축으로 좁히지 말 것. 좁게 부르면 다음 사람이 나머지 축을 다시 빠뜨린다.
 */
const SELLABLE_LISTING_PREDICATES = [
  // 버전 축
  eq(productMasterVersions.status, 'active'),
  isNull(productMasterVersions.deletedAt),
  isNull(productMasters.deletedAt),
  // 품목 축
  eq(productVariants.status, 'active'),
  // 채널 축
  eq(salesChannels.isActive, true),
];

/**
 * 채널 리스팅 → 품목 조회 쿼리. 채널을 고르는 술어만 호출부가 준다.
 *
 * 두 진입점(`lookupVariant` 는 판매채널 ID 로, `lookupVariantByChannelCode` 는 site 로)이
 * select·조인·정렬을 통째로 복제하고 있었다. 한 벌로 합쳐 **술어가 물리적으로 한 곳**이
 * 되게 한다 — 갈라져 있으면 다음 사람이 한쪽만 고치고 #666 을 재발시킨다.
 *
 * `productMasters` 는 버전의 `masterId` 로 앵커한다. `product_master_variants.master_id` 는
 * 버전의 것과 같다는 DB 제약이 없어(각자 FK 만 있다) 갈린 행에서는 엉뚱한 master 의
 * `deletedAt` 을 보게 된다.
 */
export function buildChannelListingLookupQuery(client: DbClient, channelItemId: string, channelPredicate: SQL) {
  return (
    client
      .select({
        masterId: productMasterVariants.masterId,
        versionId: productMasterVariants.versionId,
        productName: productMasterVersions.name,
        variantId: channelVariantListings.variantId,
        variantCode: productVariants.variantCode,
        variantName: productVariants.variantName,
        isActive: channelVariantListings.isActive,
      })
      .from(channelVariantListings)
      .innerJoin(productVariants, eq(channelVariantListings.variantId, productVariants.id))
      .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productVariants.id))
      .innerJoin(productMasterVersions, eq(productMasterVariants.versionId, productMasterVersions.id))
      .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
      .innerJoin(salesChannels, eq(salesChannels.id, channelVariantListings.salesChannelId))
      .where(
        and(
          channelPredicate,
          eq(channelVariantListings.channelItemId, channelItemId),
          eq(channelVariantListings.isActive, true),
          ...SELLABLE_LISTING_PREDICATES,
        ),
      )
      // 팔리는 것만 남으므로 상태 분기 정렬은 필요 없다. 한 variant 가 두 master 에 매달린
      // 이상 상태(bulk import 의 phantom masterId)에서도 결과를 고정하려고 정렬은 남긴다.
      .orderBy(desc(productMasterVersions.version), desc(productMasterVersions.createdAt))
      .limit(1)
  );
}
