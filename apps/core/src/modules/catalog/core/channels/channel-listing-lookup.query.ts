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
 * 리스팅 조회가 요구하는 "지금 팔리는 버전" 술어 (#666).
 *
 * 이게 없으면 조회 조인이 낡은 버전을 통해서도 성립해 **null 대신 옛 값이 반환된다** —
 * 격리도 로그도 없이 옛 판매정책·옛 SKU 스냅샷으로 채널 주문이 처리된다(#652 의 증상).
 * publish 승계(reconciler)는 publish 라는 사건에만 반응하므로, 그 사건을 안 거치고 낡는
 * 경로(#663 승인 우회 · #664 판매중지 · #665 레이스 · hardDelete)는 이 술어만이 막는다.
 *
 * soft delete 는 `status` 를 그대로 두고 `deletedAt` 만 세우므로 둘 다 봐야 한다.
 */
const ACTIVE_VERSION_PREDICATES = [
  eq(productMasterVersions.status, 'active'),
  isNull(productMasterVersions.deletedAt),
  isNull(productMasters.deletedAt),
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
  return client
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
        ...ACTIVE_VERSION_PREDICATES,
      ),
    )
    // 활성 버전만 남으므로 상태 분기 정렬은 필요 없다. 한 variant 가 두 master 에 매달린
    // 이상 상태(bulk import 의 phantom masterId)에서도 결과를 고정하려고 정렬은 남긴다.
    .orderBy(desc(productMasterVersions.version), desc(productMasterVersions.createdAt))
    .limit(1);
}
