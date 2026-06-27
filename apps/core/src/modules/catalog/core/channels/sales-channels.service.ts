import { Injectable } from '@nestjs/common';
import { NotFoundError, BadRequestError, ConflictError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { SalesChannel, NewSalesChannel, UpdateSalesChannel, DbTransaction } from '../../catalog.types';
import { type PimSchema, salesChannels, channelProducts, channelCategories } from '../../schema/catalog.schema';
import { eq, and, or, like, ilike, count, asc, desc, sql, SQL } from 'drizzle-orm';
import { ChannelCategoryEntity, SalesChannelEntity, SalesChannelInsert } from '../../schema/catalog.schema.types';
import { SalesChannelWithCategory } from './mappers/sales-channel.mapper';

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
        credentials: data.credentials || null,
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
      const relatedProducts = await tx
        .select({ count: count() })
        .from(channelProducts)
        .where(eq(channelProducts.channelId, channelId));

      if (relatedProducts[0].count > 0) {
        throw new ConflictError(
          `Cannot delete channel with existing products. Found ${relatedProducts[0].count} related products.`,
        );
      }
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

  //   async getChannelByType(type: string, tx?: DbTransaction): Promise<SalesChannelWithCategory | null> {
  //     if (!type) {
  //       throw new Error('Channel type is required');
  //     }

  //     const client = this.getClient(tx);

  //     const result = await client
  //       .select({
  //         id: salesChannels.id,
  //         type: salesChannels.type,
  //         site: salesChannels.site,
  //         categoryId: salesChannels.categoryId,
  //         name: salesChannels.name,
  //         description: salesChannels.description,
  //         config: salesChannels.config,
  //         isActive: salesChannels.isActive,
  //         apiEndpoint: salesChannels.apiEndpoint,
  //         credentials: salesChannels.credentials,
  //         createdAt: salesChannels.createdAt,
  //         updatedAt: salesChannels.updatedAt,
  //         category: {
  //           id: channelCategories.id,
  //           name: channelCategories.name,
  //           description: channelCategories.description,
  //           displayOrder: channelCategories.displayOrder,
  //           createdAt: channelCategories.createdAt,
  //           updatedAt: channelCategories.updatedAt,
  //         },
  //       })
  //       .from(salesChannels)
  //       .leftJoin(channelCategories, eq(salesChannels.categoryId, channelCategories.id))
  //       .where(eq(salesChannels.type, type));

  //     if (result.length === 0) {
  //       return null;
  //     }

  //     const channel = result[0];
  //     return {
  //       ...channel,
  //       category: channel.category ? channel.category.id : null,
  //     };
  //   }

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

      case 'coupang':
        if (config && (!config.accessKey || !config.secretKey)) {
          errors.push('Coupang channel requires accessKey and secretKey in config');
        }
        break;

      case 'naver':
        if (config && (!config.clientId || !config.clientSecret)) {
          errors.push('SmartStore channel requires clientId and clientSecret in config');
        }
        break;

      default:
        if (!['medusa', 'naver', 'coupang', 'phone_order', 'other'].includes(site)) {
          errors.push(`Unsupported channel type: ${site}. Supported types are: medusa, coupang, smartstore`);
        }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
