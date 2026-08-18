import { SQL, and, desc, eq, isNotNull } from 'drizzle-orm';
import type { ListingResolutionCause } from '@packages/domain-types';
import {
  channelVariantListings,
  productMasterVariants,
  productMasterVersions,
  productMasters,
  productVariants,
  salesChannels,
} from '../../schema/catalog.schema';
import { DbClient } from '../../catalog.types';

/** 진단 한 행. 술어를 걸지 않고 **상태를 그대로 실어 온다.** */
export interface ChannelListingDiagnosisRow {
  listingIsActive: boolean;
  channelIsActive: boolean;
  variantStatus: string | null;
  versionStatus: string | null;
  versionDeletedAt: Date | null;
  masterDeletedAt: Date | null;
  hasVersionLink: boolean;
}

/**
 * 조회가 0행을 냈을 때 **왜인지** 알아내는 쿼리 (#674).
 *
 * 두 가지가 필수다.
 * 1. **상태 술어를 하나도 걸지 않는다.** 걸면 진단도 0행이 되어 전부 `listing_not_found` 로
 *    오진한다 — 진단의 존재 이유가 사라진다.
 * 2. **버전 사슬은 LEFT JOIN 이다.** `product_master_variants` 행이 없는 품목(어떤 버전에도
 *    안 매달린 상태)이 inner join 에서 0행을 내 역시 `listing_not_found` 로 오진한다.
 *
 * 한 품목이 여러 버전에 매달릴 수 있으므로 조회와 같은 정렬로 하나를 고정한다. 어느 행을
 * 골라도 사유가 성립한다 — 성립하지 않는 행이 하나라도 있었다면 애초에 조회가 맞았을 것이다.
 */
export function buildChannelListingDiagnosisQuery(client: DbClient, channelItemId: string, channelPredicate: SQL) {
  return client
    .select({
      listingIsActive: channelVariantListings.isActive,
      channelIsActive: salesChannels.isActive,
      variantStatus: productVariants.status,
      versionStatus: productMasterVersions.status,
      versionDeletedAt: productMasterVersions.deletedAt,
      masterDeletedAt: productMasters.deletedAt,
      hasVersionLink: isNotNull(productMasterVariants.versionId),
    })
    .from(channelVariantListings)
    .innerJoin(salesChannels, eq(salesChannels.id, channelVariantListings.salesChannelId))
    .innerJoin(productVariants, eq(channelVariantListings.variantId, productVariants.id))
    .leftJoin(productMasterVariants, eq(productMasterVariants.variantId, productVariants.id))
    .leftJoin(productMasterVersions, eq(productMasterVariants.versionId, productMasterVersions.id))
    .leftJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
    .where(and(channelPredicate, eq(channelVariantListings.channelItemId, channelItemId)))
    .orderBy(desc(productMasterVersions.version), desc(productMasterVersions.createdAt))
    .limit(1);
}

/**
 * 우선순위 (여럿이 동시에 성립할 때):
 *
 * `listing_not_found` → `listing_inactive` → `channel_inactive`
 *   → `product_deleted` → `no_active_version` → `variant_inactive`
 *
 * - **삭제가 판매중지보다 앞이다**: 상품이 지워졌으면 품목 상태를 볼 의미가 없고 조치도
 *   재매핑 하나다.
 * - **리스팅 비활성이 채널 비활성보다 앞이다**: 더 좁은 조치(리스팅만 켜기)가 먼저다.
 */
export function causeFromDiagnosisRow(row: ChannelListingDiagnosisRow | undefined): ListingResolutionCause {
  if (!row) return 'listing_not_found';
  if (!row.listingIsActive) return 'listing_inactive';
  if (!row.channelIsActive) return 'channel_inactive';
  if (row.masterDeletedAt !== null || row.versionDeletedAt !== null) return 'product_deleted';
  if (!row.hasVersionLink || row.versionStatus !== 'active') return 'no_active_version';
  if (row.variantStatus !== 'active') return 'variant_inactive';
  // 여기 오면 sellable 조회와 진단이 어긋난 것이다. 사유를 지어내지 않는다.
  return 'unknown';
}
