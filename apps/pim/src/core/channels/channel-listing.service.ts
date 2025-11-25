import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import {
  ChannelVariantListing,
  NewChannelVariantListing,
  DbTransaction,
} from '../../types';
import {
  type PimSchema,
  channelVariantListings,
  productVariants,
  salesChannels,
} from '../../schema';
import { eq, and } from 'drizzle-orm';

export interface LookupVariantResult {
  variantId: string;
  variantCode: string | null;
  variantName: string | null;
  isActive: boolean;
}

export interface ChannelListingWithChannel {
  id: string;
  channelItemId: string;
  channelItemName: string | null;
  channelOptionName: string | null;
  channelPrice: number | null;
  isActive: boolean;
  createdAt: Date | null;
  channel: {
    id: string;
    name: string;
    site: string;
  };
}

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
        variantId: channelVariantListings.variantId,
        variantCode: productVariants.variantCode,
        variantName: productVariants.variantName,
        isActive: channelVariantListings.isActive,
      })
      .from(channelVariantListings)
      .innerJoin(
        productVariants,
        eq(channelVariantListings.variantId, productVariants.id),
      )
      .where(
        and(
          eq(channelVariantListings.salesChannelId, salesChannelId),
          eq(channelVariantListings.channelItemId, channelItemId),
          eq(channelVariantListings.isActive, true),
        ),
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
        variantId: channelVariantListings.variantId,
        variantCode: productVariants.variantCode,
        variantName: productVariants.variantName,
        isActive: channelVariantListings.isActive,
      })
      .from(channelVariantListings)
      .innerJoin(
        productVariants,
        eq(channelVariantListings.variantId, productVariants.id),
      )
      .innerJoin(
        salesChannels,
        eq(channelVariantListings.salesChannelId, salesChannels.id),
      )
      .where(
        and(
          eq(salesChannels.site, channelCode),
          eq(channelVariantListings.channelItemId, channelItemId),
          eq(channelVariantListings.isActive, true),
        ),
      )
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * 새 채널 매핑 생성
   */
  async createListing(
    dto: CreateChannelListingDto,
    tx?: DbTransaction,
  ): Promise<ChannelVariantListing> {
    const client = this.getClient(tx);

    // Variant 존재 확인
    const variant = await client
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.id, dto.variantId))
      .limit(1);

    if (variant.length === 0) {
      throw new Error(`Variant not found: ${dto.variantId}`);
    }

    // Channel 존재 확인
    const channel = await client
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(eq(salesChannels.id, dto.salesChannelId))
      .limit(1);

    if (channel.length === 0) {
      throw new Error(`Sales channel not found: ${dto.salesChannelId}`);
    }

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

    return updated ?? null;
  }

  /**
   * Variant의 모든 채널 등록 현황 조회
   */
  async getListingsByVariant(
    variantId: string,
    tx?: DbTransaction,
  ): Promise<ChannelListingWithChannel[]> {
    const client = this.getClient(tx);

    const result = await client
      .select({
        id: channelVariantListings.id,
        channelItemId: channelVariantListings.channelItemId,
        channelItemName: channelVariantListings.channelItemName,
        channelOptionName: channelVariantListings.channelOptionName,
        channelPrice: channelVariantListings.channelPrice,
        isActive: channelVariantListings.isActive,
        createdAt: channelVariantListings.createdAt,
        channel: {
          id: salesChannels.id,
          name: salesChannels.name,
          site: salesChannels.site,
        },
      })
      .from(channelVariantListings)
      .innerJoin(
        salesChannels,
        eq(channelVariantListings.salesChannelId, salesChannels.id),
      )
      .where(eq(channelVariantListings.variantId, variantId));

    return result;
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
    items: ChannelVariantListing[];
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
      .select({ count: productVariants.id })
      .from(channelVariantListings)
      .where(whereClause);

    const items = await client
      .select()
      .from(channelVariantListings)
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    return {
      items,
      total: Number(countResult?.count ?? 0),
    };
  }

  /**
   * 매핑 비활성화 (soft delete)
   */
  async deactivateListing(listingId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    await client
      .update(channelVariantListings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(channelVariantListings.id, listingId));
  }

  /**
   * 매핑 활성화
   */
  async activateListing(listingId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    await client
      .update(channelVariantListings)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(channelVariantListings.id, listingId));
  }

  /**
   * 매핑 완전 삭제 (hard delete)
   */
  async deleteListing(listingId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    await client
      .delete(channelVariantListings)
      .where(eq(channelVariantListings.id, listingId));
  }

  /**
   * 중복 매핑 확인
   */
  async existsListing(
    salesChannelId: string,
    channelItemId: string,
    tx?: DbTransaction,
  ): Promise<boolean> {
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
   * 특정 매핑 조회
   */
  async getListingById(
    listingId: string,
    tx?: DbTransaction,
  ): Promise<ChannelVariantListing | null> {
    const client = this.getClient(tx);

    const result = await client
      .select()
      .from(channelVariantListings)
      .where(eq(channelVariantListings.id, listingId))
      .limit(1);

    return result[0] ?? null;
  }
}

