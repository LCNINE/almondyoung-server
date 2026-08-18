import { Injectable } from '@nestjs/common';
import { NotFoundError, BadRequestError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { SalesChannel, NewSalesChannel, UpdateSalesChannel, DbTransaction } from '../../catalog.types';
import { type PimSchema, salesChannels, channelCategories } from '../../schema/catalog.schema';
import { eq, and, or, like, ilike, count, asc, desc, sql, SQL } from 'drizzle-orm';
import { ChannelCategoryEntity, SalesChannelEntity, SalesChannelInsert } from '../../schema/catalog.schema.types';
import { SalesChannelWithCategory } from './mappers/sales-channel.mapper';
// 행 타입 `SalesChannel`(catalog.types)과 이름이 겹치므로 어휘 상수만 가져온다.
import { SALES_CHANNELS } from '@packages/event-contracts/streams';

@Injectable()
export class SalesChannelsService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  async createChannel(data: NewSalesChannel, tx?: DbTransaction): Promise<SalesChannelWithCategory> {
    if (!data.site || !data.name) {
      throw new BadRequestError('Channel site and name are required');
    }

    return this.db.run(async (tx) => {
      if (data.categoryId) {
        const category = await tx
          .select({ id: channelCategories.id })
          .from(channelCategories)
          .where(eq(channelCategories.id, data.categoryId))
          .limit(1);

        if (category.length === 0) {
          throw new NotFoundError(`Channel category not found: ${data.categoryId}`);
        }
      }

      const channelData: SalesChannelInsert = {
        type: data.type || 'ONLINE',
        site: data.site,
        categoryId: data.categoryId || null,
        name: data.name,
        description: data.description || null,
        config: data.config || null,
        isActive: data.isActive !== false,
        apiEndpoint: data.apiEndpoint || null,
      };

      const result = await tx.insert(salesChannels).values(channelData).returning();

      if (result.length === 0) {
        throw new Error('Failed to create sales channel');
      }

      const channel = await this.tryGetChannelById(result[0].id, tx);
      if (!channel) {
        throw new Error('Failed to get created sales channel');
      }

      return channel;
    }, tx);
  }

  async tryGetChannelById(channelId: string, tx?: DbTransaction): Promise<SalesChannelWithCategory | null> {
    if (!channelId) {
      throw new BadRequestError('Channel ID is required');
    }

    return this.db.run(async (tx) => {
      const result = await tx
        .select({
          channel: salesChannels,
          category: channelCategories,
        })
        .from(salesChannels)
        .leftJoin(channelCategories, eq(salesChannels.categoryId, channelCategories.id))
        .where(eq(salesChannels.id, channelId))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      return {
        ...result[0].channel,
        category: result[0].category,
      };
    }, tx);
  }

  async getChannels(
    filters?: {
      isActive?: boolean;
      type?: string;
      site?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: SalesChannelWithCategory[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.db.run(async (tx) => {
      const page = filters?.page || 1;
      const limit = Math.min(filters?.limit || 20, 100);
      const offset = (page - 1) * limit;

      const whereConditions: SQL[] = [];
      if (filters?.isActive !== undefined) {
        whereConditions.push(eq(salesChannels.isActive, filters.isActive));
      }
      if (filters?.type) {
        whereConditions.push(eq(salesChannels.type, filters.type));
      }
      if (filters?.site) {
        whereConditions.push(eq(salesChannels.site, filters.site));
      }
      if (filters?.search) {
        whereConditions.push(ilike(salesChannels.name, `%${filters.search}%`));
      }

      const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;
      const countQuery = tx.select({ count: count() }).from(salesChannels);

      if (whereClause) {
        countQuery.where(whereClause);
      }

      const [{ count: total }] = await countQuery;
      const dataQuery = tx
        .select({
          salesChannel: salesChannels,
          category: channelCategories,
        })
        .from(salesChannels)
        .leftJoin(channelCategories, eq(salesChannels.categoryId, channelCategories.id))
        .orderBy(asc(salesChannels.name))
        .limit(limit)
        .offset(offset);

      if (whereClause) {
        dataQuery.where(whereClause);
      }

      const rawData = await dataQuery;
      const data: SalesChannelWithCategory[] = rawData.map(({ salesChannel, category }) => ({
        ...salesChannel,
        category: category ?? null,
      }));

      return { data, total, page, limit };
    }, tx);
  }

  async getActiveChannels(
    filters?: {
      page?: number;
      limit?: number;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: SalesChannelWithCategory[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.db.run(async (tx) => {
      return this.getChannels({ isActive: true, ...filters }, tx);
    }, tx);
  }

  /**
   * 활성 판매채널의 `site` 목록 (중복 제거).
   *
   * `getActiveChannels()` 를 재사용하지 않는다 — 그쪽은 `limit || 20` 으로 페이지네이션되므로
   * 활성 채널이 20개를 넘으면 목록이 **조용히 잘린다**. 이 목록은 channel-adapter 의 수집
   * 게이트(#654) 판정에 쓰이고, 잘린 사이트는 "비활성"으로 읽혀 그 채널 수집이 통째로
   * 멈춘다. 게이트 입력에는 페이지네이션을 두지 않는다.
   */
  async getActiveChannelSites(tx?: DbTransaction): Promise<string[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .selectDistinct({ site: salesChannels.site })
        .from(salesChannels)
        .where(eq(salesChannels.isActive, true))
        .orderBy(asc(salesChannels.site));

      return rows.map((row) => row.site);
    }, tx);
  }

  async updateChannel(
    channelId: string,
    data: UpdateSalesChannel,
    tx?: DbTransaction,
  ): Promise<SalesChannelWithCategory> {
    if (!channelId) {
      throw new BadRequestError('Channel ID is required');
    }

    return this.db.run(async (tx) => {
      if (data.categoryId) {
        const category = await tx
          .select({ id: channelCategories.id })
          .from(channelCategories)
          .where(eq(channelCategories.id, data.categoryId));

        if (category.length === 0) {
          throw new NotFoundError(`Channel category not found: ${data.categoryId}`);
        }
      }

      const updateData = {
        ...data,
        updatedAt: new Date(),
      };

      const result = await tx.update(salesChannels).set(updateData).where(eq(salesChannels.id, channelId)).returning();

      if (result.length === 0) {
        throw new Error(`Failed to update channel: ${channelId}`);
      }

      const channel = await this.tryGetChannelById(result[0].id, tx);
      if (!channel) {
        throw new Error('Failed to get updated sales channel');
      }

      return channel;
    }, tx);
  }

  async deleteChannel(channelId: string, tx?: DbTransaction): Promise<void> {
    if (!channelId) {
      throw new BadRequestError('Channel ID is required');
    }

    return this.db.run(async (tx) => {
      const existing = await this.tryGetChannelById(channelId, tx);
      if (!existing) {
        throw new NotFoundError(`Channel not found: ${channelId}`);
      }
      // 옛 `channel_products` 행을 세던 삭제 가드는 제거됐다 (ADR-0031 결정 5, #638).
      //
      // 동작은 그대로다 — 그 테이블은 프로덕션에서 0행이라 가드가 발동한 적이 없다. 가드를
      // 정본인 `channel_variant_listings` 로 옮겨 다는 것은 **없던 409 를 새로 만드는 일**이라
      // 삭제 PR 의 범위 밖으로 뒀다.
      //
      // ⚠️ 그래서 채널 삭제는 지금 그 채널의 리스팅을 조용히 함께 지운다
      // (`channel_variant_listings.sales_channel_id` 가 `onDelete: 'cascade'`).
      const deleteResult = await tx.delete(salesChannels).where(eq(salesChannels.id, channelId)).returning();

      if (deleteResult.length === 0) {
        throw new Error(`Failed to delete channel: ${channelId}`);
      }
    }, tx);
  }

  async setChannelActive(channelId: string, isActive: boolean, tx?: DbTransaction): Promise<SalesChannelWithCategory> {
    if (!channelId) {
      throw new BadRequestError('Channel ID is required');
    }

    return this.db.run(async (tx) => {
      const updated = await this.updateChannel(channelId, { isActive }, tx);
      return updated;
    }, tx);
  }

  async validateChannelConfig(
    site: string,
    config: any,
  ): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    if (!site) {
      return {
        isValid: false,
        errors: ['Channel type is required'],
      };
    }

    const errors: string[] = [];

    switch (site) {
      case 'medusa':
        if (config && !config.baseUrl) {
          errors.push('Medusa channel requires baseUrl in config');
        }
        break;

      default:
        // 어휘 정본은 `SALES_CHANNELS` 하나다 (ADR-0031 결정 7) — DTO 와 같은 배열을 본다.
        if (!(SALES_CHANNELS as readonly string[]).includes(site)) {
          errors.push(`Unsupported channel type: ${site}. Supported types are: ${SALES_CHANNELS.join(', ')}`);
        }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
