import { Injectable } from '@nestjs/common';
import { NotFoundError, BadRequestError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { ChannelVariantListing, NewChannelVariantListing, DbTransaction, DbClient } from '../../catalog.types';
import {
  type PimSchema,
  channelVariantListings,
  productMasters,
  productMasterVariants,
  productMasterVersions,
  productVariants,
  salesChannels,
} from '../../schema/catalog.schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { ChannelVariantListingEntity, SalesChannelEntity } from '../../schema/catalog.schema.types';
import { ProductSellableQuantityService } from '../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { isExternalMarketplaceSite } from './marketplace-site';
import { buildChannelListingLookupQuery } from './channel-listing-lookup.query';

export interface LookupVariantResult {
  masterId: string;
  versionId: string;
  productName: string;
  variantId: string;
  variantCode: string | null;
  variantName: string | null;
  isActive: boolean;
}

export type ChannelListingWithChannel = ChannelVariantListingEntity & {
  channel: SalesChannelEntity;
};

export interface CreateChannelListingDto {
  variantId: string;
  salesChannelId: string;
  channelItemId: string;
  channelItemName?: string;
  channelOptionName?: string;
  channelPrice?: number;
  channelProductUrl?: string;
}

@Injectable()
export class ChannelListingService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly productSellableQuantity: ProductSellableQuantityService,
  ) {}

  private getClient(tx?: DbTransaction): DbClient {
    return tx ?? this.db.db;
  }

  /**
   * 채널 상품 ID로 Variant 조회 (Channel Adapter에서 호출)
   */
  async lookupVariant(
    salesChannelId: string,
    channelItemId: string,
    tx?: DbTransaction,
  ): Promise<LookupVariantResult | null> {
    const result = await buildChannelListingLookupQuery(
      this.getClient(tx),
      channelItemId,
      eq(channelVariantListings.salesChannelId, salesChannelId),
    );
    return result[0] ?? null;
  }

  /**
   * 채널 코드(site)로 Variant 조회. **주문 수집이 실제로 타는 경로다**
   * (ChannelLineIdentityResolver → lookupByChannelCode).
   */
  async lookupVariantByChannelCode(
    channelCode: string,
    channelItemId: string,
    tx?: DbTransaction,
  ): Promise<LookupVariantResult | null> {
    const result = await buildChannelListingLookupQuery(
      this.getClient(tx),
      channelItemId,
      eq(salesChannels.site, channelCode),
    );
    return result[0] ?? null;
  }

  /**
   * 리스팅 대상 variant 가 active 버전에 매달려 있는지 확인한다.
   *
   * draft 에만 매달린 variant 에 리스팅을 걸면, 그 draft 를 버릴 때
   * `deleteDraftVersion` → `_cleanupOrphanedVariantsAfterDeletion` 이 variant 를 지우고
   * `channel_variant_listings.variant_id` 의 `onDelete: 'cascade'` 로 **리스팅이 조용히 사라진다.**
   * 생성 시점에 막는 게 유일하게 확실한 방어다 (#652).
   *
   * 거부 사유가 둘이라 메시지를 나눈다 — 복구 방법이 다르기 때문이다.
   * 낡은 매핑은 활성화도 재생성도(`uq_channel_variant_listing`) 막히므로 삭제 후 재등록이 유일한 길이다.
   */
  private async assertVariantIsPublished(variantId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    // soft delete 는 status 를 그대로 두고 deletedAt 만 세운다 — 상태만 보면 삭제된 상품이
    // 통과한다. ProductSellableQuantityService 가 쓰는 술어와 같은 모양으로 걸러낸다.
    const versions = await client
      .select({ status: productMasterVersions.status })
      .from(productMasterVariants)
      .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
      .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
      .where(
        and(
          eq(productMasterVariants.variantId, variantId),
          isNull(productMasterVersions.deletedAt),
          isNull(productMasters.deletedAt),
        ),
      );

    if (versions.some((v) => v.status === 'active')) return;

    // 어떤 버전에도 안 매달린 품목 — hardDelete 가 버전을 지우면 이 상태가 된다.
    // publish 할 방법이 없으므로 "publish 하세요" 로 안내하면 막다른 길이다.
    if (versions.length === 0) {
      throw new BadRequestError(
        `이 품목은 어떤 상품 버전에도 속하지 않습니다(삭제된 상품이거나 정리되지 않은 잔여 품목). ` +
          `현재 판매 중인 상품의 품목을 선택하세요: ${variantId}`,
      );
    }

    // 한 번도 활성이었던 적 없는 품목 — publish 하면 풀린다.
    if (versions.every((v) => v.status === 'draft')) {
      throw new BadRequestError(
        `아직 publish 되지 않은 품목에는 채널 매핑을 걸 수 없습니다. 상품을 publish 한 뒤 다시 시도하세요: ${variantId}`,
      );
    }

    // 활성이었다가 재발행으로 교체된 품목 — publish 해도 이 매핑은 안 살아난다.
    throw new BadRequestError(
      `상품이 다시 발행되면서 품목이 교체돼 낡은 채널 매핑입니다. ` +
        `이 매핑을 삭제한 뒤 현재 품목으로 다시 등록하세요: ${variantId}`,
    );
  }

  /**
   * 새 채널 매핑 생성
   */
  async createListing(dto: CreateChannelListingDto, tx?: DbTransaction): Promise<ChannelVariantListing> {
    const client = this.getClient(tx);

    // Variant 존재 확인
    const variant = await client
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.id, dto.variantId))
      .limit(1);

    if (variant.length === 0) {
      throw new NotFoundError(`Variant not found: ${dto.variantId}`);
    }

    await this.assertVariantIsPublished(dto.variantId, tx);

    // Channel 존재 확인
    const channel = await client
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(eq(salesChannels.id, dto.salesChannelId))
      .limit(1);

    if (channel.length === 0) {
      throw new NotFoundError(`Sales channel not found: ${dto.salesChannelId}`);
    }

    await this.assertDigitalAllowedForChannel(dto.variantId, dto.salesChannelId, tx);

    const [listing] = await client
      .insert(channelVariantListings)
      .values({
        variantId: dto.variantId,
        salesChannelId: dto.salesChannelId,
        channelItemId: dto.channelItemId,
        channelItemName: dto.channelItemName,
        channelOptionName: dto.channelOptionName,
        channelPrice: dto.channelPrice,
        channelProductUrl: dto.channelProductUrl,
      })
      .returning();

    await this.productSellableQuantity.recalculateAndPublishForVariant(dto.variantId, tx);

    return listing;
  }

  /**
   * 채널 매핑 업데이트
   */
  async updateListing(
    listingId: string,
    data: Partial<Omit<CreateChannelListingDto, 'variantId' | 'salesChannelId' | 'channelItemId'>>,
    tx?: DbTransaction,
  ): Promise<ChannelVariantListing | null> {
    const client = this.getClient(tx);

    const [updated] = await client
      .update(channelVariantListings)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(channelVariantListings.id, listingId))
      .returning();

    if (updated) {
      await this.productSellableQuantity.recalculateAndPublishForVariant(updated.variantId, tx);
    }

    return updated ?? null;
  }

  /**
   * Variant의 모든 채널 등록 현황 조회
   */
  async getListingsByVariant(variantId: string, tx?: DbTransaction): Promise<ChannelListingWithChannel[]> {
    const client = this.getClient(tx);

    const result = await client
      .select({
        listing: channelVariantListings,
        channel: salesChannels,
      })
      .from(channelVariantListings)
      .innerJoin(salesChannels, eq(channelVariantListings.salesChannelId, salesChannels.id))
      .where(eq(channelVariantListings.variantId, variantId));

    return [...result].map(({ listing, channel }) => ({
      ...listing,
      channel: channel,
    }));
  }

  /**
   * 채널별 모든 매핑 조회
   */
  async getListingsByChannel(
    salesChannelId: string,
    options?: {
      isActive?: boolean;
      limit?: number;
      offset?: number;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: ChannelVariantListing[];
    total: number;
  }> {
    const client = this.getClient(tx);
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [eq(channelVariantListings.salesChannelId, salesChannelId)];
    if (options?.isActive !== undefined) {
      conditions.push(eq(channelVariantListings.isActive, options.isActive));
    }

    const whereClause = and(...conditions);

    const [countResult] = await client
      .select({ count: sql<number>`count(*)::int` })
      .from(channelVariantListings)
      .where(whereClause);

    const data = await client.select().from(channelVariantListings).where(whereClause).limit(limit).offset(offset);

    return {
      data,
      total: Number(countResult?.count ?? 0),
    };
  }

  /**
   * 매핑 비활성화 (soft delete)
   */
  async deactivateListing(listingId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    const [updated] = await client
      .update(channelVariantListings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(channelVariantListings.id, listingId))
      .returning();

    if (updated) {
      await this.productSellableQuantity.recalculateAndPublishForVariant(updated.variantId, tx);
    }
  }

  /**
   * 매핑 활성화
   */
  async activateListing(listingId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    // 재활성도 생성과 동일 가드를 탄다.
    const existing = await this.getListingById(listingId, tx);
    if (!existing) {
      return;
    }
    await this.assertVariantIsPublished(existing.variantId, tx);
    await this.assertDigitalAllowedForChannel(existing.variantId, existing.salesChannelId, tx);

    const [updated] = await client
      .update(channelVariantListings)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(channelVariantListings.id, listingId))
      .returning();

    if (updated) {
      await this.productSellableQuantity.recalculateAndPublishForVariant(updated.variantId, tx);
    }
  }

  /**
   * 매핑 완전 삭제 (hard delete)
   */
  async deleteListing(listingId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    const existing = await this.getListingById(listingId, tx);
    await client.delete(channelVariantListings).where(eq(channelVariantListings.id, listingId));

    if (existing) {
      await this.productSellableQuantity.recalculateAndPublishForVariant(existing.variantId, tx);
    }
  }

  /**
   * 중복 매핑 확인
   */
  async existsListing(salesChannelId: string, channelItemId: string, tx?: DbTransaction): Promise<boolean> {
    const client = this.getClient(tx);

    const result = await client
      .select({ id: channelVariantListings.id })
      .from(channelVariantListings)
      .where(
        and(
          eq(channelVariantListings.salesChannelId, salesChannelId),
          eq(channelVariantListings.channelItemId, channelItemId),
        ),
      )
      .limit(1);

    return result.length > 0;
  }

  // 외부 마켓플레이스(네이버/쿠팡)는 비로그인 주문이라 구매자 식별이 없어 디지털 소유권을 부여할 수 없다.
  // 디지털은 자사몰(medusa)에서만 판매한다. 생성/재활성에서 공유.
  private async assertDigitalAllowedForChannel(
    variantId: string,
    salesChannelId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    const client = this.getClient(tx);
    const [ch] = await client
      .select({ site: salesChannels.site })
      .from(salesChannels)
      .where(eq(salesChannels.id, salesChannelId))
      .limit(1);
    if (ch && isExternalMarketplaceSite(ch.site) && (await this.isDigitalVariant(variantId, tx))) {
      throw new BadRequestError(
        `외부 채널(${ch.site})은 디지털 상품을 지원하지 않습니다. 디지털 상품은 Medusa(자사몰)에서만 판매할 수 있습니다.`,
      );
    }
  }

  /** variant 의 active 버전이 디지털(fulfillmentKind='digital')인지. */
  private async isDigitalVariant(variantId: string, tx?: DbTransaction): Promise<boolean> {
    const client = this.getClient(tx);
    const [row] = await client
      .select({ fulfillmentKind: productMasterVersions.fulfillmentKind })
      .from(productMasterVariants)
      .innerJoin(productMasterVersions, eq(productMasterVariants.versionId, productMasterVersions.id))
      .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
      // 조회 술어와 같은 기준으로 본다 — soft delete 는 status 를 그대로 두므로
      // 상태만 보면 삭제된 상품의 fulfillmentKind 로 디지털 여부를 판정하게 된다.
      .where(
        and(
          eq(productMasterVariants.variantId, variantId),
          eq(productMasterVersions.status, 'active'),
          isNull(productMasterVersions.deletedAt),
          isNull(productMasters.deletedAt),
        ),
      )
      .limit(1);
    return row?.fulfillmentKind === 'digital';
  }

  /**
   * 특정 매핑 조회
   */
  async getListingById(listingId: string, tx?: DbTransaction): Promise<ChannelVariantListing | null> {
    const client = this.getClient(tx);

    const result = await client
      .select()
      .from(channelVariantListings)
      .where(eq(channelVariantListings.id, listingId))
      .limit(1);

    return result[0] ?? null;
  }
}
