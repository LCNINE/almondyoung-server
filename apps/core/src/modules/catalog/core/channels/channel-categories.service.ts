import { Injectable } from '@nestjs/common';
import { NotFoundError, BadRequestError, ConflictError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { ChannelCategory, NewChannelCategory, UpdateChannelCategory, DbTransaction, DbClient } from '../../catalog.types';
import { type PimSchema, channelCategories, salesChannels } from '../../schema/catalog.schema';
import { eq, count, asc, sql } from 'drizzle-orm';

@Injectable()
export class ChannelCategoriesService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  private getClient(tx?: DbTransaction): DbClient {
    return tx ?? this.db.db;
  }

  async create(data: NewChannelCategory, tx?: DbTransaction): Promise<ChannelCategory> {
    if (!data.name) {
      throw new BadRequestError('Category name is required');
    }

    const client = this.getClient(tx);

    const categoryData = {
      name: data.name,
      description: data.description || null,
      displayOrder: data.displayOrder ?? 0,
    };

    const result = await client.insert(channelCategories).values(categoryData).returning();

    if (result.length === 0) {
      throw new Error('Failed to create category');
    }

    return result[0];
  }

  async findAll(tx?: DbTransaction): Promise<Array<ChannelCategory & { channelCount?: number }>> {
    const client = this.getClient(tx);

    const results = await client
      .select({
        id: channelCategories.id,
        name: channelCategories.name,
        description: channelCategories.description,
        displayOrder: channelCategories.displayOrder,
        createdAt: channelCategories.createdAt,
        updatedAt: channelCategories.updatedAt,
        channelCount: sql<number>`cast(count(${salesChannels.id}) as int)`,
      })
      .from(channelCategories)
      .leftJoin(salesChannels, eq(channelCategories.id, salesChannels.categoryId))
      .groupBy(
        channelCategories.id,
        channelCategories.name,
        channelCategories.description,
        channelCategories.displayOrder,
        channelCategories.createdAt,
        channelCategories.updatedAt,
      )
      .orderBy(asc(channelCategories.displayOrder), asc(channelCategories.name));

    return results;
  }

  async findById(id: string, tx?: DbTransaction): Promise<ChannelCategory | null> {
    if (!id) {
      throw new BadRequestError('Category ID is required');
    }

    const client = this.getClient(tx);

    const result = await client.select().from(channelCategories).where(eq(channelCategories.id, id));

    return result.length > 0 ? result[0] : null;
  }

  async update(id: string, data: UpdateChannelCategory, tx?: DbTransaction): Promise<ChannelCategory> {
    if (!id) {
      throw new BadRequestError('Category ID is required');
    }

    const client = this.getClient(tx);

    const existing = await this.findById(id, tx);
    if (!existing) {
      throw new NotFoundError(`Category not found: ${id}`);
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };

    const result = await client
      .update(channelCategories)
      .set(updateData)
      .where(eq(channelCategories.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error(`Failed to update category: ${id}`);
    }

    return result[0];
  }

  async delete(id: string, tx?: DbTransaction): Promise<void> {
    if (!id) {
      throw new BadRequestError('Category ID is required');
    }

    const client = this.getClient(tx);

    const existing = await this.findById(id, tx);
    if (!existing) {
      throw new NotFoundError(`Category not found: ${id}`);
    }

    const relatedChannels = await client
      .select({ count: count() })
      .from(salesChannels)
      .where(eq(salesChannels.categoryId, id));

    if (relatedChannels[0].count > 0) {
      throw new ConflictError(
        `Cannot delete category with existing channels. Found ${relatedChannels[0].count} related channels.`,
      );
    }

    await client.delete(channelCategories).where(eq(channelCategories.id, id));
  }
}
