import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import {
  SalesChannel,
  NewSalesChannel,
  UpdateSalesChannel,
  DbTransaction
} from '../../types';
import {
  type PimSchema,
  salesChannels,
  channelProducts,
  channelCategories
} from '../../schema';
import { eq, and, or, like, ilike, count, asc, desc, sql } from 'drizzle-orm';

@Injectable()
export class SalesChannelsService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
  ) { }

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }


  async createChannel(data: NewSalesChannel, tx?: DbTransaction): Promise<SalesChannel> {
    if (!data.site || !data.name) {
      throw new Error('Channel site and name are required');
    }

    const client = this.getClient(tx);

    if (data.categoryId) {
      const category = await client
        .select({ id: channelCategories.id })
        .from(channelCategories)
        .where(eq(channelCategories.id, data.categoryId));

      if (category.length === 0) {
        throw new Error(`Category not found: ${data.categoryId}`);
      }
    }

    const channelData = {
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

    const result = await client
      .insert(salesChannels)
      .values(channelData)
      .returning();

    if (result.length === 0) {
      throw new Error('Failed to create channel');
    }

    return result[0];
  }

  async getChannelById(channelId: string, tx?: DbTransaction): Promise<any> {
    if (!channelId) {
      throw new Error('Channel ID is required');
    }

    const client = this.getClient(tx);

    const result = await client
      .select({
        id: salesChannels.id,
        type: salesChannels.type,
        site: salesChannels.site,
        categoryId: salesChannels.categoryId,
        name: salesChannels.name,
        description: salesChannels.description,
        config: salesChannels.config,
        isActive: salesChannels.isActive,
        apiEndpoint: salesChannels.apiEndpoint,
        credentials: salesChannels.credentials,
        createdAt: salesChannels.createdAt,
        updatedAt: salesChannels.updatedAt,
        category: {
          id: channelCategories.id,
          name: channelCategories.name,
          description: channelCategories.description,
          displayOrder: channelCategories.displayOrder,
          createdAt: channelCategories.createdAt,
          updatedAt: channelCategories.updatedAt,
        },
      })
      .from(salesChannels)
      .leftJoin(channelCategories, eq(salesChannels.categoryId, channelCategories.id))
      .where(eq(salesChannels.id, channelId));

    if (result.length === 0) {
      return null;
    }

    const channel = result[0];
    return {
      ...channel,
      category: channel.category ? channel.category.id : null,
    };
  }

  async getChannels(filters?: {
    isActive?: boolean;
    type?: string;
    search?: string;
    page?: number;
    limit?: number;
  }, tx?: DbTransaction): Promise<{
    data: SalesChannel[];
    total: number;
    page: number;
    limit: number;
  }> {
    const client = this.getClient(tx);

    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const offset = (page - 1) * limit;

    const whereConditions: any[] = [];
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
    const countQuery = client
      .select({ count: count() })
      .from(salesChannels);

    if (whereClause) {
      countQuery.where(whereClause);
    }

    const [{ count: total }] = await countQuery;
    const dataQuery = client
      .select({
        id: salesChannels.id,
        type: salesChannels.type,
        site: salesChannels.site,
        categoryId: salesChannels.categoryId,
        name: salesChannels.name,
        description: salesChannels.description,
        config: salesChannels.config,
        isActive: salesChannels.isActive,
        apiEndpoint: salesChannels.apiEndpoint,
        credentials: salesChannels.credentials,
        createdAt: salesChannels.createdAt,
        updatedAt: salesChannels.updatedAt,
        category: {
          id: channelCategories.id,
          name: channelCategories.name,
          description: channelCategories.description,
          displayOrder: channelCategories.displayOrder,
          createdAt: channelCategories.createdAt,
          updatedAt: channelCategories.updatedAt,
        },
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
    const data = rawData.map(channel => ({
      ...channel,
      category: channel.category ? channel.category.id : null,
    }));

    return {
      data,
      total,
      page,
      limit
    };
  }

  async getActiveChannels(tx?: DbTransaction): Promise<SalesChannel[]> {
    const client = this.getClient(tx);

    const channels = await client
      .select()
      .from(salesChannels)
      .where(eq(salesChannels.isActive, true))
      .orderBy(asc(salesChannels.name));

    return channels;
  }

  async updateChannel(channelId: string, data: UpdateSalesChannel, tx?: DbTransaction): Promise<SalesChannel> {
    if (!channelId) {
      throw new Error('Channel ID is required');
    }

    const client = this.getClient(tx);

    const existing = await this.getChannelById(channelId, tx);
    if (!existing) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (data.categoryId) {
      const category = await client
        .select({ id: channelCategories.id })
        .from(channelCategories)
        .where(eq(channelCategories.id, data.categoryId));

      if (category.length === 0) {
        throw new Error(`Category not found: ${data.categoryId}`);
      }
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };
    delete (updateData as any).id;
    delete (updateData as any).createdAt;
    delete (updateData as any).category;

    const result = await client
      .update(salesChannels)
      .set(updateData)
      .where(eq(salesChannels.id, channelId))
      .returning();

    if (result.length === 0) {
      throw new Error(`Failed to update channel: ${channelId}`);
    }

    return result[0];
  }

  async deleteChannel(channelId: string, tx?: DbTransaction): Promise<void> {
    if (!channelId) {
      throw new Error('Channel ID is required');
    }

    const client = this.getClient(tx);

    const existing = await this.getChannelById(channelId, tx);
    if (!existing) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    const relatedProducts = await client
      .select({ count: count() })
      .from(channelProducts)
      .where(eq(channelProducts.channelId, channelId));

    if (relatedProducts[0].count > 0) {
      throw new Error(`Cannot delete channel with existing products. Found ${relatedProducts[0].count} related products.`);
    }
    await client
      .delete(salesChannels)
      .where(eq(salesChannels.id, channelId));
  }

  async setChannelActive(channelId: string, isActive: boolean, tx?: DbTransaction): Promise<void> {
    if (!channelId) {
      throw new Error('Channel ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsChannel(channelId, tx);
    if (!exists) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    await client
      .update(salesChannels)
      .set({
        isActive,
        updatedAt: new Date()
      })
      .where(eq(salesChannels.id, channelId));
  }

  async existsChannel(channelId: string, tx?: DbTransaction): Promise<boolean> {
    if (!channelId) {
      return false;
    }

    const client = this.getClient(tx);

    const result = await client
      .select({ count: count() })
      .from(salesChannels)
      .where(eq(salesChannels.id, channelId));

    return result[0].count > 0;
  }

  async getChannelByType(type: string, tx?: DbTransaction): Promise<any> {
    if (!type) {
      throw new Error('Channel type is required');
    }

    const client = this.getClient(tx);

    const result = await client
      .select({
        id: salesChannels.id,
        type: salesChannels.type,
        site: salesChannels.site,
        categoryId: salesChannels.categoryId,
        name: salesChannels.name,
        description: salesChannels.description,
        config: salesChannels.config,
        isActive: salesChannels.isActive,
        apiEndpoint: salesChannels.apiEndpoint,
        credentials: salesChannels.credentials,
        createdAt: salesChannels.createdAt,
        updatedAt: salesChannels.updatedAt,
        category: {
          id: channelCategories.id,
          name: channelCategories.name,
          description: channelCategories.description,
          displayOrder: channelCategories.displayOrder,
          createdAt: channelCategories.createdAt,
          updatedAt: channelCategories.updatedAt,
        },
      })
      .from(salesChannels)
      .leftJoin(channelCategories, eq(salesChannels.categoryId, channelCategories.id))
      .where(eq(salesChannels.type, type));

    if (result.length === 0) {
      return null;
    }

    const channel = result[0];
    return {
      ...channel,
      category: channel.category ? channel.category.id : null,
    };
  }

  async validateChannelConfig(type: string, config: any): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    if (!type) {
      return {
        isValid: false,
        errors: ['Channel type is required']
      };
    }

    const errors: string[] = [];

    switch (type) {
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

      case 'smartstore':
        if (config && (!config.clientId || !config.clientSecret)) {
          errors.push('SmartStore channel requires clientId and clientSecret in config');
        }
        break;

      default:
        if (!['medusa', 'coupang', 'smartstore'].includes(type)) {
          errors.push(`Unsupported channel type: ${type}. Supported types are: medusa, coupang, smartstore`);
        }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
} 