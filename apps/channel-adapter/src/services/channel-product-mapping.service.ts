import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import { channelAdapterSchema } from '../schema';
import {
  ChannelProductMapping,
  NewChannelProductMapping,
  UpdateChannelProductMapping,
} from '../types';

export type SalesChannelType = 'coupang' | 'naver' | 'medusa';

export interface CreateMappingDto {
  salesChannel: SalesChannelType;
  channelProductId: string;
  channelProductName?: string;
  pimVariantId: string;
  pimVariantCode?: string;
  mappedBy?: string;
}

export interface MappingWithVariantInfo {
  mapping: ChannelProductMapping;
  variantId: string;
}

/**
 * 채널 상품 → PIM Variant 매핑 서비스
 *
 * 외부 채널(쿠팡/네이버)의 상품 ID를 PIM의 variantId로 매핑합니다.
 * N:1 관계: 여러 채널 상품이 하나의 PIM variant에 매핑될 수 있습니다.
 */
@Injectable()
export class ChannelProductMappingService {
  private readonly logger = new Logger(ChannelProductMappingService.name);

  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
  ) {
    this.logger.log('🔗 채널 상품 매핑 서비스 초기화 완료');
  }

  /**
   * 채널 상품 ID로 PIM variant 매핑 조회
   */
  async findMapping(
    salesChannel: SalesChannelType,
    channelProductId: string,
  ): Promise<ChannelProductMapping | null> {
    try {
      const [mapping] = await this.db.db
        .select()
        .from(channelAdapterSchema.channelProductMappings)
        .where(
          and(
            eq(channelAdapterSchema.channelProductMappings.salesChannel, salesChannel),
            eq(channelAdapterSchema.channelProductMappings.channelProductId, channelProductId),
          ),
        )
        .limit(1);

      return mapping ?? null;
    } catch (error) {
      this.logger.error(
        `❌ 매핑 조회 실패: ${salesChannel}/${channelProductId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 매핑 생성
   */
  async createMapping(dto: CreateMappingDto): Promise<ChannelProductMapping> {
    try {
      const newMapping: NewChannelProductMapping = {
        salesChannel: dto.salesChannel,
        channelProductId: dto.channelProductId,
        channelProductName: dto.channelProductName,
        pimVariantId: dto.pimVariantId,
        pimVariantCode: dto.pimVariantCode,
        mappedBy: dto.mappedBy,
        mappedAt: new Date(),
      };

      const [created] = await this.db.db
        .insert(channelAdapterSchema.channelProductMappings)
        .values(newMapping)
        .returning();

      this.logger.log(
        `✅ 매핑 생성: ${dto.salesChannel}/${dto.channelProductId} → ${dto.pimVariantId}`,
      );

      return created;
    } catch (error) {
      this.logger.error(
        `❌ 매핑 생성 실패: ${dto.salesChannel}/${dto.channelProductId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 매핑 업데이트
   */
  async updateMapping(
    id: string,
    updates: UpdateChannelProductMapping,
  ): Promise<ChannelProductMapping> {
    try {
      const [updated] = await this.db.db
        .update(channelAdapterSchema.channelProductMappings)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(channelAdapterSchema.channelProductMappings.id, id))
        .returning();

      if (!updated) {
        throw new Error(`매핑을 찾을 수 없습니다: ${id}`);
      }

      this.logger.log(`✅ 매핑 업데이트: ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`❌ 매핑 업데이트 실패: ${id}`, error.message);
      throw error;
    }
  }

  /**
   * 매핑 삭제
   */
  async deleteMapping(id: string): Promise<void> {
    try {
      await this.db.db
        .delete(channelAdapterSchema.channelProductMappings)
        .where(eq(channelAdapterSchema.channelProductMappings.id, id));

      this.logger.log(`🗑️ 매핑 삭제: ${id}`);
    } catch (error) {
      this.logger.error(`❌ 매핑 삭제 실패: ${id}`, error.message);
      throw error;
    }
  }

  /**
   * PIM variantId로 매핑된 모든 채널 상품 조회
   */
  async findByVariantId(pimVariantId: string): Promise<ChannelProductMapping[]> {
    try {
      return await this.db.db
        .select()
        .from(channelAdapterSchema.channelProductMappings)
        .where(eq(channelAdapterSchema.channelProductMappings.pimVariantId, pimVariantId));
    } catch (error) {
      this.logger.error(`❌ variant 매핑 조회 실패: ${pimVariantId}`, error.message);
      throw error;
    }
  }

  /**
   * 특정 채널의 모든 매핑 조회
   */
  async findByChannel(salesChannel: SalesChannelType): Promise<ChannelProductMapping[]> {
    try {
      return await this.db.db
        .select()
        .from(channelAdapterSchema.channelProductMappings)
        .where(eq(channelAdapterSchema.channelProductMappings.salesChannel, salesChannel));
    } catch (error) {
      this.logger.error(`❌ 채널 매핑 조회 실패: ${salesChannel}`, error.message);
      throw error;
    }
  }

  /**
   * 모든 매핑 조회 (페이징)
   */
  async findAll(options?: {
    limit?: number;
    offset?: number;
    salesChannel?: SalesChannelType;
  }): Promise<{ mappings: ChannelProductMapping[]; total: number }> {
    try {
      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;

      let query = this.db.db
        .select()
        .from(channelAdapterSchema.channelProductMappings);

      if (options?.salesChannel) {
        query = query.where(
          eq(channelAdapterSchema.channelProductMappings.salesChannel, options.salesChannel),
        ) as typeof query;
      }

      const mappings = await query.limit(limit).offset(offset);

      // 카운트 쿼리
      const countResult = await this.db.db
        .select()
        .from(channelAdapterSchema.channelProductMappings);
      
      return {
        mappings,
        total: countResult.length,
      };
    } catch (error) {
      this.logger.error('❌ 매핑 목록 조회 실패', error.message);
      throw error;
    }
  }

  /**
   * variantIdMapper 콜백 생성 (어댑터에서 사용)
   *
   * @example
   * const mapper = this.mappingService.createVariantIdMapper('coupang');
   * await this.orderEventPublisher.publishOrderCreated('coupang', event, mapper);
   */
  createVariantIdMapper(
    salesChannel: SalesChannelType,
  ): (channelProductId: string) => Promise<string | null> {
    return async (channelProductId: string) => {
      const mapping = await this.findMapping(salesChannel, channelProductId);
      return mapping?.pimVariantId ?? null;
    };
  }
}

