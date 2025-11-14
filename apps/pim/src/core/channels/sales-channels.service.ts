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
  channelProducts
} from '../../schema';
import { eq, and, or, like, ilike, count, asc, desc, sql } from 'drizzle-orm';

@Injectable()
export class SalesChannelsService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }


  async createChannel(data: NewSalesChannel, tx?: DbTransaction): Promise<SalesChannel> {
    if (!data.type || !data.name) {
      throw new Error('Channel type and name are required');
    }
    
    const client = this.getClient(tx);
    
    const existingChannel = await client
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(eq(salesChannels.type, data.type));
    
    if (existingChannel.length > 0) {
      throw new Error(`Channel type '${data.type}' already exists`);
    }
    
    const channelData = {
      type: data.type,
      name: data.name,
      isActive: data.isActive !== false,
      apiConfig: data.apiConfig || null,
      supportedFeatures: data.supportedFeatures || null,
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

  async getChannelById(channelId: string, tx?: DbTransaction): Promise<SalesChannel | null> {
    if (!channelId) {
      throw new Error('Channel ID is required');
    }
    
    const client = this.getClient(tx);
    
    const result = await client
      .select()
      .from(salesChannels)
      .where(eq(salesChannels.id, channelId));
    
    return result.length > 0 ? result[0] : null;
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
      .select()
      .from(salesChannels)
      .orderBy(asc(salesChannels.name))
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
    if (data.type && data.type !== existing.type) {
      const duplicateChannel = await client
        .select({ id: salesChannels.id })
        .from(salesChannels)
        .where(and(
          eq(salesChannels.type, data.type),
          sql`${salesChannels.id} != ${channelId}`
        ));
      
      if (duplicateChannel.length > 0) {
        throw new Error(`Channel type '${data.type}' already exists`);
      }
    }
    
    const updateData = {
      ...data,
      updatedAt: new Date(),
    };
    delete (updateData as any).id;
    delete (updateData as any).createdAt;
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

  async getChannelByType(type: string, tx?: DbTransaction): Promise<SalesChannel | null> {
    if (!type) {
      throw new Error('Channel type is required');
    }
    
    const client = this.getClient(tx);
    
    const result = await client
      .select()
      .from(salesChannels)
      .where(eq(salesChannels.type, type));
    
    return result.length > 0 ? result[0] : null;
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
        if (config?.apiConfig && !config.apiConfig.baseUrl) {
          errors.push('Medusa channel requires baseUrl in apiConfig');
        }
        break;
        
      case 'coupang':
        if (config?.apiConfig && (!config.apiConfig.accessKey || !config.apiConfig.secretKey)) {
          errors.push('Coupang channel requires accessKey and secretKey in apiConfig');
        }
        break;
        
      case 'smartstore':
        if (config?.apiConfig && (!config.apiConfig.clientId || !config.apiConfig.clientSecret)) {
          errors.push('SmartStore channel requires clientId and clientSecret in apiConfig');
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