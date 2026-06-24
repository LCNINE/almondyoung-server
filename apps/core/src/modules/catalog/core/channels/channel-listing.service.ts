import { Injectable } from '@nestjs/common';
import { NotFoundError, BadRequestError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { ChannelVariantListing, NewChannelVariantListing, DbTransaction } from '../../catalog.types';
import {
  type PimSchema,
  channelVariantListings,
  productMasterVariants,
  productMasterVersions,
  productVariants,
  salesChannels,
} from '../../schema/catalog.schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { ChannelVariantListingEntity, SalesChannelEntity } from '../../schema/catalog.schema.types';
import { ProductSellableQuantityService } from '../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';

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

  private getClient(tx?: DbTransaction) {
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
    const client = this.getClient(tx);

    const result = await client
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
      .where(
        and(
          eq(channelVariantListings.salesChannelId, salesChannelId),
          eq(channelVariantListings.channelItemId, channelItemId),
          eq(channelVariantListings.isActive, true),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${productMasterVersions.status} = 'active' THEN 0 ELSE 1 END`,
        desc(productMasterVersions.version),
        desc(productMasterVersions.createdAt),
      )
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * 채널 코드(site)로 Variant 조회 (편의 메서드)
   */
  async lookupVariantByChannelCode(
    channelCode: string,
    channelItemId: string,
    tx?: DbTransaction,
  ): Promise<LookupVariantResult | null> {
    const client = this.getClient(tx);

    const result = await client
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
      .innerJoin(salesChannels, eq(channelVariantListings.salesChannelId, salesChannels.id))
      .where(
        and(
          eq(salesChannels.site, channelCode),
          eq(channelVariantListings.channelItemId, channelItemId),
          eq(channelVariantListings.isActive, true),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${productMasterVersions.status} = 'active' THEN 0 ELSE 1 END`,
        desc(productMasterVersions.version),
        desc(productMasterVersions.createdAt),
      )
      .limit(1);

    return result[0] ?? null;
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

    // Channel 존재 확인
    const channel = await client
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(eq(salesChannels.id, dto.salesChannelId))
      .limit(1);

    if (channel.length === 0) {
      throw new NotFoundError(`Sales channel not found: ${dto.salesChannelId}`);
    }

    // 외부 마켓플레이스(네이버/쿠팡)는 디지털 판매를 지원하지 않는다 — 생성 차단. (#455)
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

    // 생성뿐 아니라 재활성도 동일 가드를 타야 한다 — 비활성 외부채널 디지털 listing 의 재활성 우회 차단. (#455)
    const existing = await this.getListingById(listingId, tx);
    if (!existing) {
      return;
    }
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

  /**
   * 외부채널 디지털 판매 차단 가드 (생성/재활성 공유).
   * 외부 마켓플레이스(네이버/쿠팡)는 비로그인 주문이라 구매자 식별(customerId)이 없어 디지털 소유권을
   * 부여할 수 없다. 디지털은 Medusa(자사몰)에서만 판매한다. (#455)
   */
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
    if (ch && this.isExternalMarketplaceSite(ch.site) && (await this.isDigitalVariant(variantId, tx))) {
      throw new BadRequestError(
        `외부 채널(${ch.site})은 디지털 상품을 지원하지 않습니다. 디지털 상품은 Medusa(자사몰)에서만 판매할 수 있습니다.`,
      );
    }
  }

  /** 외부 마켓플레이스(비로그인 주문 → customerId 없음) 채널인지. 디지털 판매 차단 대상. */
  private isExternalMarketplaceSite(site: string): boolean {
    return site === 'naver' || site === 'coupang';
  }

  /** variant 의 active 버전이 디지털(fulfillmentKind='digital')인지. */
  private async isDigitalVariant(variantId: string, tx?: DbTransaction): Promise<boolean> {
    const client = this.getClient(tx);
    const [row] = await client
      .select({ fulfillmentKind: productMasterVersions.fulfillmentKind })
      .from(productMasterVariants)
      .innerJoin(productMasterVersions, eq(productMasterVariants.versionId, productMasterVersions.id))
      .where(and(eq(productMasterVariants.variantId, variantId), eq(productMasterVersions.status, 'active')))
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
