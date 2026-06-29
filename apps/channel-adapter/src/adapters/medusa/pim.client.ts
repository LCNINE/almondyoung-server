// apps/channel-adapter/src/services/pim-medusa-sync/pim.client.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import type { PimProductSnapshot } from '../../types';

export interface PimCategoryDetail {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
  path?: string;
  visibility?: boolean;
  showOnMainCategory?: boolean;
  thumbnail?: string;
}

@Injectable()
export class PimClient {
  private readonly logger = new Logger(PimClient.name);
  private readonly client: AxiosInstance;
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('PIM_API_URL') || '';

    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.logger.log(`PIM client initialized: ${this.apiUrl}`);
  }

  // Master ID의 Active Version 조회
  async getActiveVersion(masterId: string): Promise<PimProductSnapshot> {
    try {
      this.logger.debug(`Fetching PIM active version: ${masterId}`);

      // GET /masters/:masterId (Active 버전 상세 정보 포함)
      const response = await this.client.get(`/masters/${masterId}`);
      const data = response.data;

      if (!data) {
        throw new Error(`No active version found for master ${masterId}`);
      }

      // 카테고리 Fallback: PIM API가 categoryIds를 내려주지 않는 경우 DB에서 조회
      let categoryIds: string[] | undefined = data.categoryIds || undefined;
      this.logger.debug(`PIM API returned categoryIds for ${masterId}: ${JSON.stringify(categoryIds)}`);

      if ((!categoryIds || categoryIds.length === 0) && process.env.PIM_SOURCE_DB_URL) {
        this.logger.debug(`Attempting to fetch categoryIds from DB for ${masterId}...`);
        try {
          categoryIds = await this.fetchCategoryIdsFromDb(masterId);
          if (categoryIds.length > 0) {
            this.logger.debug(`Resolved categoryIds from DB for ${masterId}: ${categoryIds.length}`);
          } else {
            this.logger.warn(`DB query returned 0 categoryIds for ${masterId}`);
          }
        } catch (e) {
          this.logger.warn(`Failed to fetch categoryIds from DB for ${masterId}: ${e?.message}`);
        }
      }

      // 카테고리 상세 조회 (syncFromSnapshot이 snapshot.categories를 사용하므로 필수)
      let categories: PimProductSnapshot['categories'] | undefined;
      if (categoryIds && categoryIds.length > 0) {
        const fetched = await Promise.allSettled(categoryIds.map((id) => this.getCategory(id)));
        categories = fetched
          .filter((r): r is PromiseFulfilledResult<PimCategoryDetail> => r.status === 'fulfilled')
          .map((r) => ({
            id: r.value.id,
            name: r.value.name,
            slug: r.value.slug,
            path: r.value.path ?? '',
            parentId: r.value.parentId,
            isActive: r.value.isActive,
            visibility: r.value.visibility ?? true,
            showOnMainCategory: r.value.showOnMainCategory ?? false,
            thumbnail: r.value.thumbnail,
          }));
        this.logger.debug(`Resolved ${categories.length} category details for ${masterId}`);
      }

      // 옵션 그룹 맵 (ID -> 이름) - variant option mapping용
      const optionGroupMap = new Map<string, string>(
        data.optionGroups?.map((g: any) => [g.id, g.displayName || g.name]) || [],
      );

      // 스냅샷 구성 (ProductDetailDto)
      const snapshot: PimProductSnapshot = {
        masterId: data.masterId,
        versionId: data.id,
        version: data.version,
        name: data.name,
        description: data.description || undefined,
        descriptionHtml: data.descriptionHtml || undefined,
        thumbnail: data.thumbnail ? `${this.configService.get('FILE_SERVICE_URL')}/files/${data.thumbnail}` : undefined,
        images:
          data.images?.map((img: any) => ({
            fileId: img.fileId,
            url: `${this.configService.get('FILE_SERVICE_URL')}/files/${img.fileId}`,
            isPrimary: img.isPrimary ?? false,
            sortOrder: img.sortOrder ?? 0,
          })) || undefined,
        seoTitle: data.seoTitle || undefined,
        seoDescription: data.seoDescription || undefined,
        seoKeywords: data.seoKeywords || undefined,
        categoryIds,
        categories,
        brand: data.brand || undefined,
        tags: data.tagValues?.map((tv: any) => tv.name) || undefined,
        productType: data.productType || undefined,
        optionGroups:
          data.optionGroups?.map((group: any) => ({
            id: group.id,
            name: group.displayName || group.name,
            values: group.values?.map((value: any) => ({
              id: value.id,
              name: value.displayName || value.name,
              colorCode: value.colorCode,
              imageUrl: value.imageUrl,
            })),
          })) || [],
        variants:
          data.variants?.map((variant: any) => ({
            id: variant.id,
            variantName: variant.variantName,
            sku: variant.sku,
            variantCode: variant.variantCode,
            isDefault: variant.isDefault || false,
            status: variant.status || 'active',
            optionCombination: variant.optionValues?.map((ov: any) => ({
              name: ov.optionGroupName || optionGroupMap.get(ov.optionGroupId) || 'Unknown',
              value: ov.displayName || ov.name,
            })),
            basePrice: variant.priceSet?.basePrice ?? variant.price,
            membershipPrice: variant.priceSet?.membershipPrice,
            tieredPrices: variant.priceSet?.tieredPrices ?? [],
          })) || [],
        status: data.status,
        isWholesaleOnly: data.isWholesaleOnly || false,
        hideMembershipPriceForNonMembers: data.hideMembershipPriceForNonMembers ?? data.isMembershipOnly ?? false,
        isMembershipOnly: data.hideMembershipPriceForNonMembers ?? data.isMembershipOnly ?? false,
        isVisibleToMembersOnly: data.isVisibleToMembersOnly ?? false,
        isOverseas: data.isOverseas ?? false,
        purchaseConstraint: data.purchaseConstraint ?? undefined,
        isGiftcard: data.isGiftcard || false,
        discountable: data.discountable !== false,
      };

      this.logger.debug(`Built PIM snapshot: ${masterId} with ${snapshot.variants.length} variants`);

      return snapshot;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`PIM master not found or no active version: ${masterId}`);
      }

      this.logger.error(`Failed to get PIM active version: ${masterId}`, error.stack);
      throw new Error(`PIM getActiveVersion failed: ${error.message}`);
    }
  }

  /**
   * categoryIds를 DB에서 직접 조회 (migration 등의 백필 시 PIM API 응답에 categoryIds가 없을 때 사용)
   */
  private async fetchCategoryIdsFromDb(masterId: string): Promise<string[]> {
    const dbUrl = process.env.PIM_SOURCE_DB_URL;
    if (!dbUrl) return [];

    // 동적 import를 사용해 CommonJS/ESM 환경 모두 지원
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const createSql = require('postgres');
    const sql = createSql(dbUrl, { max: 1 });
    try {
      const rows = await sql<{ categoryId: string }[]>`
                    SELECT category_id AS "categoryId"
                    FROM product_master_categories
                    WHERE master_id = ${masterId}
                `;
      return rows.map((r) => r.categoryId);
    } finally {
      await sql.end();
    }
  }

  // 모든 Active Masters 목록 조회 (메두사 채널에 할당된 것만)
  async getAllActiveMasters(): Promise<string[]> {
    try {
      this.logger.log('Fetching Medusa channel products from PIM...');

      // 1. 메두사 세일즈 채널 ID 찾기
      const medusaSalesChannelId = await this.getMedusaSalesChannelId();
      if (!medusaSalesChannelId) {
        this.logger.warn('Medusa sales channel not found in PIM. No products to sync.');
        return [];
      }

      const masterIds: string[] = [];
      const seen = new Set<string>();
      let page = 1;
      // PIM API가 내부적으로 페이지당 100개로 제한할 수 있으므로
      // limit는 요청 상한만 높여두고, 응답 길이에 상관없이 다음 페이지를 순회한다.
      const limit = 500;

      while (true) {
        const response = await this.client.get(`/channel-products/channels/${medusaSalesChannelId}`, {
          params: {
            isActive: 'true',
            limit,
            page,
          },
        });

        const channelProducts = response.data?.data || [];
        if (!channelProducts.length) break;

        for (const item of channelProducts) {
          const masterId = item.master?.id;
          if (masterId && item.master?.status === 'active' && !seen.has(masterId)) {
            seen.add(masterId);
            masterIds.push(masterId);
          }
        }

        page += 1;
      }

      this.logger.log(`Found ${masterIds.length} products in Medusa channel`);
      return masterIds;
    } catch (error) {
      this.logger.error('Failed to get Medusa channel products', error.stack);
      throw new Error(`PIM getAllActiveMasters failed: ${error.message}`);
    }
  }

  // 메두사 세일즈 채널 ID 조회
  private async getMedusaSalesChannelId(): Promise<string | null> {
    try {
      // GET /channels?site=medusa
      const response = await this.client.get('/channels', {
        params: { site: 'medusa' }, // PIM에서 메두사 채널의 site 값
      });

      const channels = response.data?.data || response.data || [];
      const medusaChannel = channels.find(
        (ch: any) => ch.site?.toLowerCase() === 'medusa' || ch.name?.toLowerCase().includes('medusa'),
      );

      if (medusaChannel) {
        this.logger.log(`Found Medusa sales channel: ${medusaChannel.id} (${medusaChannel.name})`);
        return medusaChannel.id;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get Medusa sales channel ID', error.stack);
      return null;
    }
  }

  // 헬스 체크: PIM API 연결 확인
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/masters', {
        params: { limit: 1 },
      });
      return response.status === 200;
    } catch (error) {
      this.logger.error('PIM health check failed', error.message);
      return false;
    }
  }

  // 단일 카테고리 상세 조회 (parentId/이름/슬러그 포함)
  async getCategory(categoryId: string): Promise<PimCategoryDetail> {
    try {
      const response = await this.client.get(`/categories/${categoryId}`);
      const data = response.data;

      if (!data) {
        throw new Error(`Category not found: ${categoryId}`);
      }

      return {
        id: data.id,
        name: data.name,
        slug: data.slug,
        parentId: data.parentId ?? null,
        isActive: data.isActive ?? true,
        visibility: data.visibility ?? true,
        showOnMainCategory:
          data.displaySettings?.showOnMainCategory ?? data.display_settings?.showOnMainCategory ?? false,
        path: data.path,
        thumbnail: data.thumbnail ? `${this.configService.get('FILE_SERVICE_URL')}/files/${data.thumbnail}` : undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch category from PIM: ${categoryId}`, error.stack);
      throw new Error(`PIM getCategory failed: ${error.message}`);
    }
  }
}
