import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import {
  CreateChannelProductDto,
  ChannelProduct,
  UpdateChannelProduct,
  SalesChannel,
  ProductMaster,
  DbTransaction,
} from '../types';
import {
  type PimSchema,
  channelProducts,
  salesChannels,
  productMasters,
} from '../schema';
import {
  eq,
  and,
  or,
  like,
  ilike,
  count,
  asc,
  desc,
  sql,
  inArray,
} from 'drizzle-orm';

@Injectable()
export class ChannelProductsService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  async createChannelProduct(
    data: CreateChannelProductDto,
    tx?: DbTransaction,
  ): Promise<ChannelProduct> {
    if (!data.masterId || !data.channelId) {
      throw new Error('Master ID and Channel ID are required');
    }

    const client = this.getClient(tx);

    // 1. Master 존재 확인
    const masterExists = await client
      .select({ id: productMasters.id })
      .from(productMasters)
      .where(eq(productMasters.id, data.masterId));

    if (masterExists.length === 0) {
      throw new Error(`Master not found: ${data.masterId}`);
    }

    // 2. Channel 존재 확인
    const channelExists = await client
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(eq(salesChannels.id, data.channelId));

    if (channelExists.length === 0) {
      throw new Error(`Channel not found: ${data.channelId}`);
    }

    // 3. 중복 확인
    const alreadyExists = await this.existsChannelProduct(
      data.masterId,
      data.channelId,
      tx,
    );
    if (alreadyExists) {
      throw new Error(
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

    const result = await client
      .insert(channelProducts)
      .values(channelProductData)
      .returning();

    if (result.length === 0) {
      throw new Error('Failed to create channel product');
    }

    return result[0];
  }

  async getChannelProduct(
    channelProductId: string,
    tx?: DbTransaction,
  ): Promise<ChannelProduct | null> {
    if (!channelProductId) {
      throw new Error('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    const result = await client
      .select()
      .from(channelProducts)
      .where(eq(channelProducts.id, channelProductId));

    return result.length > 0 ? result[0] : null;
  }

  async getChannelProductsByMaster(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<
    (ChannelProduct & {
      channel: SalesChannel;
    })[]
  > {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    // JOIN으로 채널 정보까지 함께 조회
    const result = await client
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
        // SalesChannel 필드들 (channel 객체로 그룹화)
        channel: {
          id: salesChannels.id,
          type: salesChannels.type,
          name: salesChannels.name,
          isActive: salesChannels.isActive,
          apiConfig: salesChannels.apiConfig,
          supportedFeatures: salesChannels.supportedFeatures,
          createdAt: salesChannels.createdAt,
          updatedAt: salesChannels.updatedAt,
        },
      })
      .from(channelProducts)
      .innerJoin(salesChannels, eq(channelProducts.channelId, salesChannels.id))
      .where(eq(channelProducts.masterId, masterId))
      .orderBy(asc(salesChannels.name));

    return result;
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
    data: (ChannelProduct & { master: ProductMaster })[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!channelId) {
      throw new Error('Channel ID is required');
    }

    const client = this.getClient(tx);

    // 기본값 설정
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100); // 최대 100개로 제한
    const offset = (page - 1) * limit;

    // 필터 조건 배열 생성
    const whereConditions: any[] = [eq(channelProducts.channelId, channelId)];

    // 활성 상태 필터
    if (filters?.isActive !== undefined) {
      whereConditions.push(eq(channelProducts.isActive, filters.isActive));
    }

    // 검색 필터 (상품명에서 검색 - 오버라이드된 이름 또는 Master 이름)
    if (filters?.search) {
      whereConditions.push(
        or(
          ilike(channelProducts.name, `%${filters.search}%`),
          ilike(productMasters.name, `%${filters.search}%`),
        ),
      );
    }

    // WHERE 조건 결합
    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // 1. 전체 개수 조회
    const countQuery = client
      .select({ count: count() })
      .from(channelProducts)
      .innerJoin(
        productMasters,
        eq(channelProducts.masterId, productMasters.id),
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
        // ProductMaster 필드들 (master 객체로 그룹화)
        master: {
          id: productMasters.id,
          name: productMasters.name,
          description: productMasters.description,
          brand: productMasters.brand,
          basePrice: productMasters.basePrice,
          pricingStrategy: productMasters.pricingStrategy,
          tags: productMasters.tags,
          images: productMasters.images,
          attributes: productMasters.attributes,
          seoTitle: productMasters.seoTitle,
          seoDescription: productMasters.seoDescription,
          seoKeywords: productMasters.seoKeywords,
          status: productMasters.status,
          isWholesaleOnly: productMasters.isWholesaleOnly,
          isMembershipOnly: productMasters.isMembershipOnly,
          membershipPrice: productMasters.membershipPrice,
          wholesalePrice: productMasters.wholesalePrice,
          createdAt: productMasters.createdAt,
          updatedAt: productMasters.updatedAt,
          createdBy: productMasters.createdBy,
          updatedBy: productMasters.updatedBy,
        },
      })
      .from(channelProducts)
      .innerJoin(
        productMasters,
        eq(channelProducts.masterId, productMasters.id),
      )
      .orderBy(desc(channelProducts.createdAt))
      .limit(limit)
      .offset(offset);

    if (whereClause) {
      dataQuery.where(whereClause);
    }

    const data = await dataQuery;

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
      throw new Error('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new Error(`Channel product not found: ${channelProductId}`);
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

    return result[0];
  }

  async deleteChannelProduct(
    channelProductId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!channelProductId) {
      throw new Error('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new Error(`Channel product not found: ${channelProductId}`);
    }

    // 2. 삭제 실행
    await client
      .delete(channelProducts)
      .where(eq(channelProducts.id, channelProductId));
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
    basePrice: number; // 원본 기본 가격
    channelSpecificData?: any;
  } | null> {
    if (!masterId || !channelId) {
      throw new Error('Master ID and Channel ID are required');
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
          id: productMasters.id,
          name: productMasters.name, // 원본 이름
          description: productMasters.description,
          images: productMasters.images,
          basePrice: productMasters.basePrice,
        },
      })
      .from(channelProducts)
      .innerJoin(
        productMasters,
        eq(channelProducts.masterId, productMasters.id),
      )
      .where(
        and(
          eq(channelProducts.masterId, masterId),
          eq(channelProducts.channelId, channelId),
        ),
      );

    if (result.length === 0) {
      return null; // 채널 상품이 존재하지 않음
    }

    const data = result[0];

    // 2. 데이터 병합 로직
    return {
      id: data.channelProduct.id,
      masterId: data.channelProduct.masterId,
      channelId: data.channelProduct.channelId,
      // 상품명: 오버라이드된 이름이 있으면 사용, 없으면 원본 이름 사용
      name: data.channelProduct.name || data.master.name,
      // 설명, 이미지, 기본가격은 항상 원본 Master 데이터 사용
      description: data.master.description || '',
      images: Array.isArray(data.master.images)
        ? (data.master.images as string[])
        : [],
      basePrice: data.master.basePrice || 0,
      // 판매 여부는 채널별 설정 사용
      isActive: (data.channelProduct.isActive ?? true) as boolean,
      // 채널별 특수 데이터
      channelSpecificData: data.channelProduct.channelSpecificData,
    };
  }

  async overrideProductName(
    channelProductId: string,
    name: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!channelProductId) {
      throw new Error('Channel Product ID is required');
    }

    if (!name || name.trim() === '') {
      throw new Error('Product name is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new Error(`Channel product not found: ${channelProductId}`);
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

  async setChannelProductActive(
    channelProductId: string,
    isActive: boolean,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!channelProductId) {
      throw new Error('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new Error(`Channel product not found: ${channelProductId}`);
    }

    // 2. 활성 상태 설정
    await client
      .update(channelProducts)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(channelProducts.id, channelProductId));
  }

  async setChannelSpecificData(
    channelProductId: string,
    data: any,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!channelProductId) {
      throw new Error('Channel Product ID is required');
    }

    const client = this.getClient(tx);

    // 1. 채널 상품 존재 확인
    const existing = await this.getChannelProduct(channelProductId, tx);
    if (!existing) {
      throw new Error(`Channel product not found: ${channelProductId}`);
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

  async existsChannelProduct(
    masterId: string,
    channelId: string,
    tx?: DbTransaction,
  ): Promise<boolean> {
    if (!masterId || !channelId) {
      return false;
    }

    const client = this.getClient(tx);

    const result = await client
      .select({ count: count() })
      .from(channelProducts)
      .where(
        and(
          eq(channelProducts.masterId, masterId),
          eq(channelProducts.channelId, channelId),
        ),
      );

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
      .select({ id: productMasters.id })
      .from(productMasters)
      .where(eq(productMasters.id, masterId));

    if (masterExists.length === 0) {
      errors.push(`Master not found: ${masterId}`);
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
      if (
        settings.isActive !== undefined &&
        typeof settings.isActive !== 'boolean'
      ) {
        errors.push('isActive must be a boolean value');
      }
      if (
        settings.channelSpecificData &&
        JSON.stringify(settings.channelSpecificData).length > 10000
      ) {
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
        supportedFeatures: salesChannels.supportedFeatures,
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
            violations.push(
              'Coupang product name must be 100 characters or less',
            );
          }
          break;

        case 'smartstore':
          if (productData.name && productData.name.length > 80) {
            violations.push(
              'SmartStore product name must be 80 characters or less',
            );
          }
          break;

        case 'medusa':
          break;

        default:
          violations.push(`Unknown channel type: ${channelInfo.type}`);
      }

      if (channelInfo.supportedFeatures) {
        const features = channelInfo.supportedFeatures as any;

        if (
          productData.images &&
          Array.isArray(productData.images) &&
          productData.images.length > 1
        ) {
          if (features.multipleImages === false) {
            violations.push(
              `Channel ${channelInfo.type} does not support multiple images`,
            );
          }
        }

        if (productData.hasOptions && features.optionProducts === false) {
          violations.push(
            `Channel ${channelInfo.type} does not support option products`,
          );
        }
      }
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
      throw new Error('Master ID is required');
    }

    if (!channelConfigs || channelConfigs.length === 0) {
      throw new Error('Channel configurations are required');
    }

    const client = this.getClient(tx);

    const executeBulkCreate = async (txn: any) => {
      // 1. Master 존재 확인
      const masterExists = await txn
        .select({ id: productMasters.id })
        .from(productMasters)
        .where(eq(productMasters.id, masterId));

      if (masterExists.length === 0) {
        throw new Error(`Master not found: ${masterId}`);
      }

      const channelIds = channelConfigs.map((config) => config.channelId);
      const uniqueChannelIds = [...new Set(channelIds)];

      const existingChannels = await txn
        .select({ id: salesChannels.id })
        .from(salesChannels)
        .where(inArray(salesChannels.id, uniqueChannelIds));

      const existingChannelIds = existingChannels.map((ch: any) => ch.id);
      const missingChannelIds = uniqueChannelIds.filter(
        (id) => !existingChannelIds.includes(id),
      );

      if (missingChannelIds.length > 0) {
        throw new Error(`Channels not found: ${missingChannelIds.join(', ')}`);
      }

      // 3. 중복 확인
      const existingChannelProducts = await txn
        .select({ channelId: channelProducts.channelId })
        .from(channelProducts)
        .where(
          and(
            eq(channelProducts.masterId, masterId),
            inArray(channelProducts.channelId, uniqueChannelIds),
          ),
        );

      const existingChannelProductIds = existingChannelProducts.map(
        (cp: any) => cp.channelId,
      );
      const duplicateChannelIds = channelConfigs
        .map((config) => config.channelId)
        .filter((id) => existingChannelProductIds.includes(id));

      if (duplicateChannelIds.length > 0) {
        throw new Error(
          `Channel products already exist for channels: ${duplicateChannelIds.join(', ')}`,
        );
      }

      const channelProductsData = channelConfigs.map((config) => ({
        masterId,
        channelId: config.channelId,
        name: config.name || null,
        isActive: config.isActive !== false,
        channelSpecificData: config.channelSpecificData || null,
      }));

      const result = await txn
        .insert(channelProducts)
        .values(channelProductsData)
        .returning();

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

  async getActiveProductCountByChannel(
    channelId: string,
    tx?: DbTransaction,
  ): Promise<number> {
    if (!channelId) {
      throw new Error('Channel ID is required');
    }

    const client = this.getClient(tx);

    const result = await client
      .select({ count: count() })
      .from(channelProducts)
      .where(
        and(
          eq(channelProducts.channelId, channelId),
          eq(channelProducts.isActive, true),
        ),
      );

    return result[0].count;
  }
}
