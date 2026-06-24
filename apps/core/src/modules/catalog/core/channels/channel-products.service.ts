import { Injectable } from '@nestjs/common';
import { NotFoundError, BadRequestError, ConflictError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import {
  CreateChannelProductDto,
  ChannelProduct,
  UpdateChannelProduct,
  SalesChannel,
  ProductMasterVersion,
  DbTransaction,
} from '../../catalog.types';
import { type PimSchema, channelProducts, salesChannels, productMasterVersions } from '../../schema/catalog.schema';
import { eq, and, or, like, ilike, count, asc, desc, sql, inArray, SQL } from 'drizzle-orm';
import { ChannelProductWithChannelDto } from './dto';
import { ChannelProductMapper } from './mappers';
import { ChannelProductEntity, SalesChannelEntity } from '../../schema/catalog.schema.types';
import { ProductReadAssembler } from '../products/assemblers/product-read.assembler';
import { ProductSellableQuantityService } from '../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';

@Injectable()
export class ChannelProductsService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly productReadAssembler: ProductReadAssembler,
    private readonly productSellableQuantity: ProductSellableQuantityService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  /** 외부 마켓플레이스(비로그인 주문 → customerId 없음) 채널인지. 디지털 판매 차단 대상. */
  private isExternalMarketplaceSite(site: string): boolean {
    return site === 'naver' || site === 'coupang';
  }

  /**
   * 외부채널 디지털 판매 차단 가드 (채널 상품 생성/활성 공유).
   * 외부 마켓플레이스(네이버/쿠팡)는 비로그인 주문이라 디지털 소유권을 부여할 수 없어, 디지털 master 의
   * 채널 상품 생성/활성을 막는다. 디지털은 Medusa(자사몰)에서만 판매한다. (#455)
   */
  private async assertDigitalAllowedForChannelMaster(
    masterId: string,
    channelId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    const client = this.getClient(tx);
    const [ch] = await client
      .select({ site: salesChannels.site })
      .from(salesChannels)
      .where(eq(salesChannels.id, channelId))
      .limit(1);
    if (!ch || !this.isExternalMarketplaceSite(ch.site)) {
      return;
    }
    const [m] = await client
      .select({ fulfillmentKind: productMasterVersions.fulfillmentKind })
      .from(productMasterVersions)
      .where(and(eq(productMasterVersions.masterId, masterId), eq(productMasterVersions.status, 'active')))
      .limit(1);
    if (m?.fulfillmentKind === 'digital') {
      throw new BadRequestError(
        `외부 채널(${ch.site})은 디지털 상품을 지원하지 않습니다. 디지털 상품은 Medusa(자사몰)에서만 판매할 수 있습니다.`,
      );
    }
  }

  async createChannelProduct(data: CreateChannelProductDto, tx?: DbTransaction): Promise<ChannelProduct> {
    if (!data.masterId || !data.channelId) {
      throw new BadRequestError('Master ID and Channel ID are required');
    }

    const client = this.getClient(tx);

    // 1. Master 존재 확인
    const masterExists = await client
      .select({ id: productMasterVersions.masterId })
      .from(productMasterVersions)
      .where(and(eq(productMasterVersions.masterId, data.masterId), eq(productMasterVersions.status, 'active')));

    if (masterExists.length === 0) {
      throw new NotFoundError(`Master not found or no active version: ${data.masterId}`);
    }

    // 2. Channel 존재 확인
    const channelExists = await client
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(eq(salesChannels.id, data.channelId));

    if (channelExists.length === 0) {
      throw new NotFoundError(`Channel not found: ${data.channelId}`);
    }

    // 외부 마켓플레이스(네이버/쿠팡)는 디지털 판매 미지원 — 채널 상품 생성 차단. (#455)
    await this.assertDigitalAllowedForChannelMaster(data.masterId, data.channelId, tx);

    // 3. 중복 확인
    const alreadyExists = await this.existsChannelProduct(data.masterId, data.channelId, tx);
    if (alreadyExists) {
      throw new ConflictError(
        `Channel product already exists for master ${data.masterId} and channel ${data.channelId}`,
      );
    }

    // 4. 채널 상품 생성
    const channelProductData = {
      masterId: data.masterId,
      channelId: data.channelId,
      name: data.name || null, // 상품명 오버라이드 (없으면 Master 이름 사용)
      isActive: data.isActive !== false, // 기본값 true
      channelSpecificData: data.channelSpecificData || null,
    };

    const result = await client.insert(channelProducts).values(channelProductData).returning();

    if (result.length === 0) {
      throw new Error('Failed to create channel product');
    }

    await this.productSellableQuantity.recalculateAndPublishForMaster(data.masterId, tx);

    return result[0];
  }

  async getChannelProduct(channelProductId: string, tx?: DbTransaction): Promise<ChannelProduct | null> {
    if (!channelProductId) {
      throw new BadRequestError('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    const result = await client.select().from(channelProducts).where(eq(channelProducts.id, channelProductId));

    return result.length > 0 ? result[0] : null;
  }

  async getChannelProductsByMaster(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<(ChannelProductEntity & { channel: SalesChannelEntity })[]> {
    if (!masterId) {
      throw new BadRequestError('Master ID is required');
    }

    const client = this.getClient(tx);

    // JOIN으로 채널 정보까지 함께 조회
    const result = await client
      .select({
        // ChannelProduct 필드들
        channelProduct: channelProducts,
        // SalesChannel 필드들 (channel 객체로 그룹화) - DTO에 맞게 간소화
        channel: salesChannels,
      })
      .from(channelProducts)
      .innerJoin(salesChannels, eq(channelProducts.channelId, salesChannels.id))
      .where(eq(channelProducts.masterId, masterId))
      .orderBy(asc(salesChannels.name));

    return result.map(({ channelProduct, channel }) => ({
      ...channelProduct,
      channel: channel,
    }));
  }

  async getChannelProductsByChannel(
    channelId: string,
    filters?: {
      isActive?: boolean;
      search?: string;
      page?: number;
      limit?: number;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: any; //추후 수정 상품마스터에 썸네일 추가하면서 타입안맞음.
    total: number;
    page: number;
    limit: number;
  }> {
    if (!channelId) {
      throw new BadRequestError('Channel ID is required');
    }

    const client = this.getClient(tx);

    // 기본값 설정
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100); // 최대 100개로 제한
    const offset = (page - 1) * limit;

    // 필터 조건 배열 생성
    const whereConditions: SQL[] = [eq(channelProducts.channelId, channelId)];

    // 활성 상태 필터
    if (filters?.isActive !== undefined) {
      whereConditions.push(eq(channelProducts.isActive, filters.isActive));
    }

    // 검색 필터 (상품명에서 검색 - 오버라이드된 이름 또는 Master 이름)
    if (filters?.search) {
      whereConditions.push(
        or(
          ilike(channelProducts.name, `%${filters.search}%`),
          ilike(productMasterVersions.name, `%${filters.search}%`),
        ) as SQL,
      );
    }

    // WHERE 조건 결합
    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // 1. 전체 개수 조회
    const countQuery = client
      .select({ count: count() })
      .from(channelProducts)
      .innerJoin(
        productMasterVersions,
        and(eq(channelProducts.masterId, productMasterVersions.masterId), eq(productMasterVersions.status, 'active')),
      );

    if (whereClause) {
      countQuery.where(whereClause);
    }

    const [{ count: total }] = await countQuery;

    // 2. 실제 데이터 조회 (페이징 적용)
    const dataQuery = client
      .select({
        // ChannelProduct 필드들
        id: channelProducts.id,
        masterId: channelProducts.masterId,
        channelId: channelProducts.channelId,
        name: channelProducts.name,
        isActive: channelProducts.isActive,
        channelSpecificData: channelProducts.channelSpecificData,
        createdAt: channelProducts.createdAt,
        updatedAt: channelProducts.updatedAt,
        // ProductMasterVersion 필드들 (master 객체로 그룹화)
        master: {
          id: productMasterVersions.id,
          masterId: productMasterVersions.masterId,
          version: productMasterVersions.version,
          status: productMasterVersions.status,
          name: productMasterVersions.name,
          description: productMasterVersions.description,
          brand: productMasterVersions.brand,
          seoTitle: productMasterVersions.seoTitle,
          seoDescription: productMasterVersions.seoDescription,
          seoKeywords: productMasterVersions.seoKeywords,
          createdAt: productMasterVersions.createdAt,
          updatedAt: productMasterVersions.updatedAt,
          createdBy: productMasterVersions.createdBy,
          updatedBy: productMasterVersions.updatedBy,
        },
        versionId: productMasterVersions.id, // product_images 조회용
      })
      .from(channelProducts)
      .innerJoin(
        productMasterVersions,
        and(eq(channelProducts.masterId, productMasterVersions.masterId), eq(productMasterVersions.status, 'active')),
      )
      .orderBy(desc(channelProducts.createdAt))
      .limit(limit)
      .offset(offset);

    if (whereClause) {
      dataQuery.where(whereClause);
    }

    const rawData = await dataQuery;

    // product_images에서 primary 이미지 조회 (thumbnail용)
    const versionIds = rawData.map((item) => item.versionId);
    const thumbnailMap = await this.productReadAssembler.getPrimaryImagesByVersionIds(versionIds, tx);

    const data = rawData.map((item) => ({
      ...item,
      master: {
        ...item.master,
        thumbnail: thumbnailMap.get(item.versionId) ?? null,
        images: null,
      },
    }));

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async updateChannelProduct(
    channelProductId: string,
    data: UpdateChannelProduct,
    tx?: DbTransaction,
  ): Promise<ChannelProduct> {
    if (!channelProductId) {
      throw new BadRequestError('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new NotFoundError(`Channel product not found: ${channelProductId}`);
    }

    // 2. 업데이트할 필드만 추출 (id, masterId, channelId, createdAt 제외)
    const updateData = {
      ...data,
      updatedAt: new Date(), // 수정 시간 자동 설정
    };

    // 수정 불가 필드 제거
    delete (updateData as any).id;
    delete (updateData as any).masterId; // Master 변경 불가
    delete (updateData as any).channelId;
    delete (updateData as any).createdAt;

    // 3. 업데이트 실행
    const result = await client
      .update(channelProducts)
      .set(updateData)
      .where(eq(channelProducts.id, channelProductId))
      .returning();

    if (result.length === 0) {
      throw new Error(`Failed to update channel product: ${channelProductId}`);
    }

    await this.productSellableQuantity.recalculateAndPublishForMaster(existing.masterId, tx);

    return result[0];
  }

  async deleteChannelProduct(channelProductId: string, tx?: DbTransaction): Promise<void> {
    if (!channelProductId) {
      throw new BadRequestError('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new NotFoundError(`Channel product not found: ${channelProductId}`);
    }

    // 2. 삭제 실행
    await client.delete(channelProducts).where(eq(channelProducts.id, channelProductId));
    await this.productSellableQuantity.recalculateAndPublishForMaster(existing.masterId, tx);
  }

  async getMergedChannelProduct(
    masterId: string,
    channelId: string,
    tx?: DbTransaction,
  ): Promise<{
    id: string;
    masterId: string;
    channelId: string;
    name: string; // 오버라이드된 이름 또는 원본 이름
    description: string; // 원본 설명
    images: string[]; // 원본 이미지
    isActive: boolean; // 채널별 판매 여부
    channelSpecificData?: any;
  } | null> {
    if (!masterId || !channelId) {
      throw new BadRequestError('Master ID and Channel ID are required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 정보와 Master 정보를 JOIN으로 조회
    const result = await client
      .select({
        channelProduct: {
          id: channelProducts.id,
          masterId: channelProducts.masterId,
          channelId: channelProducts.channelId,
          name: channelProducts.name, // 오버라이드된 이름 (null 가능)
          isActive: channelProducts.isActive,
          channelSpecificData: channelProducts.channelSpecificData,
        },
        master: {
          id: productMasterVersions.id,
          name: productMasterVersions.name, // 원본 이름
          description: productMasterVersions.description,
        },
        versionId: productMasterVersions.id, // product_images 조회용
      })
      .from(channelProducts)
      .innerJoin(
        productMasterVersions,
        and(eq(channelProducts.masterId, productMasterVersions.masterId), eq(productMasterVersions.status, 'active')),
      )
      .where(and(eq(channelProducts.masterId, masterId), eq(channelProducts.channelId, channelId)));

    if (result.length === 0) {
      return null; // 채널 상품이 존재하지 않음
    }

    const data = result[0];

    // product_images에서 이미지 조회
    const images = await this.productReadAssembler.getImagesByVersionId(data.versionId, tx);

    // 2. 데이터 병합 로직
    return {
      id: data.channelProduct.id,
      masterId: data.channelProduct.masterId,
      channelId: data.channelProduct.channelId,
      name: data.channelProduct.name ?? data.master.name, // 채널 상품 이름 우선, 없으면 원본
      description: data.master.description ?? '',
      images: images.map((img) => img.fileId), // product_images에서 가져온 fileId 배열
      isActive: data.channelProduct.isActive ?? true,
      channelSpecificData: data.channelProduct.channelSpecificData,
    };
  }

  async overrideProductName(channelProductId: string, name: string, tx?: DbTransaction): Promise<void> {
    if (!channelProductId) {
      throw new BadRequestError('Channel Product ID is required');
    }

    if (!name || name.trim() === '') {
      throw new BadRequestError('Product name is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new NotFoundError(`Channel product not found: ${channelProductId}`);
    }

    // 2. 상품명 오버라이드
    await client
      .update(channelProducts)
      .set({
        name: name.trim(),
        updatedAt: new Date(),
      })
      .where(eq(channelProducts.id, channelProductId));
  }

  async setChannelProductActive(channelProductId: string, isActive: boolean, tx?: DbTransaction): Promise<void> {
    if (!channelProductId) {
      throw new BadRequestError('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new NotFoundError(`Channel product not found: ${channelProductId}`);
    }

    // 활성화(재활성 포함) 시 외부 마켓플레이스 디지털 차단. (#455)
    if (isActive) {
      await this.assertDigitalAllowedForChannelMaster(existing.masterId, existing.channelId, tx);
    }

    // 2. 활성 상태 설정
    await client
      .update(channelProducts)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(channelProducts.id, channelProductId));

    await this.productSellableQuantity.recalculateAndPublishForMaster(existing.masterId, tx);
  }

  async setChannelSpecificData(channelProductId: string, data: any, tx?: DbTransaction): Promise<void> {
    if (!channelProductId) {
      throw new BadRequestError('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new NotFoundError(`Channel product not found: ${channelProductId}`);
    }

    // 2. 특수 데이터 설정 (JSON 형태로 저장)
    await client
      .update(channelProducts)
      .set({
        channelSpecificData: data,
        updatedAt: new Date(),
      })
      .where(eq(channelProducts.id, channelProductId));
  }

  async existsChannelProduct(masterId: string, channelId: string, tx?: DbTransaction): Promise<boolean> {
    if (!masterId || !channelId) {
      return false;
    }

    const client = this.getClient(tx);

    const result = await client
      .select({ count: count() })
      .from(channelProducts)
      .where(and(eq(channelProducts.masterId, masterId), eq(channelProducts.channelId, channelId)));

    return result[0].count > 0;
  }

  async validateChannelProductSettings(
    masterId: string,
    channelId: string,
    settings: any,
    tx?: DbTransaction,
  ): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    if (!masterId || !channelId) {
      return {
        isValid: false,
        errors: ['Master ID and Channel ID are required'],
      };
    }

    const client = this.getClient(tx);
    const errors: string[] = [];

    // 1. Master 존재 확인
    const masterExists = await client
      .select({ id: productMasterVersions.masterId })
      .from(productMasterVersions)
      .where(and(eq(productMasterVersions.masterId, masterId), eq(productMasterVersions.status, 'active')));

    if (masterExists.length === 0) {
      errors.push(`Master not found or no active version: ${masterId}`);
    }

    // 2. Channel 존재 확인
    const channelExists = await client
      .select({ id: salesChannels.id, type: salesChannels.type })
      .from(salesChannels)
      .where(eq(salesChannels.id, channelId));

    if (channelExists.length === 0) {
      errors.push(`Channel not found: ${channelId}`);
    }

    if (settings) {
      if (settings.name && settings.name.length > 255) {
        errors.push('Product name is too long (max 255 characters)');
      }
      if (settings.isActive !== undefined && typeof settings.isActive !== 'boolean') {
        errors.push('isActive must be a boolean value');
      }
      if (settings.channelSpecificData && JSON.stringify(settings.channelSpecificData).length > 10000) {
        errors.push('Channel specific data is too large (max 10KB)');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  async checkChannelConstraints(
    channelId: string,
    productData: any,
    tx?: DbTransaction,
  ): Promise<{
    isAllowed: boolean;
    violations: string[];
  }> {
    if (!channelId) {
      return {
        isAllowed: false,
        violations: ['Channel ID is required'],
      };
    }

    const client = this.getClient(tx);
    const violations: string[] = [];

    const channel = await client
      .select({
        id: salesChannels.id,
        type: salesChannels.type,
        isActive: salesChannels.isActive,
      })
      .from(salesChannels)
      .where(eq(salesChannels.id, channelId));

    if (channel.length === 0) {
      violations.push(`Channel not found: ${channelId}`);
      return { isAllowed: false, violations };
    }

    const channelInfo = channel[0];

    if (!channelInfo.isActive) {
      violations.push(`Channel ${channelInfo.type} is not active`);
    }

    if (productData) {
      switch (channelInfo.type) {
        case 'coupang':
          if (productData.name && productData.name.length > 100) {
            violations.push('Coupang product name must be 100 characters or less');
          }
          break;

        case 'smartstore':
          if (productData.name && productData.name.length > 80) {
            violations.push('SmartStore product name must be 80 characters or less');
          }
          break;

        case 'medusa':
          break;

        default:
          violations.push(`Unknown channel type: ${channelInfo.type}`);
      }

      // if (channelInfo.supportedFeatures) {
      //   const features = channelInfo.supportedFeatures as any;

      //   if (
      //     productData.images &&
      //     Array.isArray(productData.images) &&
      //     productData.images.length > 1
      //   ) {
      //     if (features.multipleImages === false) {
      //       violations.push(
      //         `Channel ${channelInfo.type} does not support multiple images`,
      //       );
      //     }
      //   }

      //   if (productData.hasOptions && features.optionProducts === false) {
      //     violations.push(
      //       `Channel ${channelInfo.type} does not support option products`,
      //     );
      //   }
      // }
    }

    return {
      isAllowed: violations.length === 0,
      violations,
    };
  }

  async bulkCreateChannelProducts(
    masterId: string,
    channelConfigs: {
      channelId: string;
      name?: string;
      isActive?: boolean;
      channelSpecificData?: any;
    }[],
    tx?: DbTransaction,
  ): Promise<ChannelProduct[]> {
    if (!masterId) {
      throw new BadRequestError('Master ID is required');
    }

    if (!channelConfigs || channelConfigs.length === 0) {
      throw new BadRequestError('Channel configurations are required');
    }

    const client = this.getClient(tx);

    const executeBulkCreate = async (txn: any) => {
      // 1. Master 존재 확인
      const masterExists = await txn
        .select({ id: productMasterVersions.masterId })
        .from(productMasterVersions)
        .where(and(eq(productMasterVersions.masterId, masterId), eq(productMasterVersions.status, 'active')));

      if (masterExists.length === 0) {
        throw new NotFoundError(`Master not found or no active version: ${masterId}`);
      }

      const channelIds = channelConfigs.map((config) => config.channelId);
      const uniqueChannelIds = [...new Set(channelIds)];

      const existingChannels = await txn
        .select({ id: salesChannels.id })
        .from(salesChannels)
        .where(inArray(salesChannels.id, uniqueChannelIds));

      const existingChannelIds = existingChannels.map((ch: any) => ch.id);
      const missingChannelIds = uniqueChannelIds.filter((id) => !existingChannelIds.includes(id));

      if (missingChannelIds.length > 0) {
        throw new NotFoundError(`Channels not found: ${missingChannelIds.join(', ')}`);
      }

      // 3. 중복 확인
      const existingChannelProducts = await txn
        .select({ channelId: channelProducts.channelId })
        .from(channelProducts)
        .where(and(eq(channelProducts.masterId, masterId), inArray(channelProducts.channelId, uniqueChannelIds)));

      const existingChannelProductIds = existingChannelProducts.map((cp: any) => cp.channelId);
      const duplicateChannelIds = channelConfigs
        .map((config) => config.channelId)
        .filter((id) => existingChannelProductIds.includes(id));

      if (duplicateChannelIds.length > 0) {
        throw new ConflictError(`Channel products already exist for channels: ${duplicateChannelIds.join(', ')}`);
      }

      const channelProductsData = channelConfigs.map((config) => ({
        masterId,
        channelId: config.channelId,
        name: config.name || null,
        isActive: config.isActive !== false,
        channelSpecificData: config.channelSpecificData || null,
      }));

      const result = await txn.insert(channelProducts).values(channelProductsData).returning();

      return result;
    };

    if (tx) {
      return await executeBulkCreate(tx);
    } else {
      return await this.db.db.transaction(async (txn) => {
        return await executeBulkCreate(txn);
      });
    }
  }

  async getActiveProductCountByChannel(channelId: string, tx?: DbTransaction): Promise<number> {
    if (!channelId) {
      throw new BadRequestError('Channel ID is required');
    }

    const client = this.getClient(tx);

    const result = await client
      .select({ count: count() })
      .from(channelProducts)
      .where(and(eq(channelProducts.channelId, channelId), eq(channelProducts.isActive, true)));

    return result[0].count;
  }
}
