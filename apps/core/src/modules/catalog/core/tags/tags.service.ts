import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { eq, and, sql, SQL, inArray } from 'drizzle-orm';
import { CreateTagGroupDto, UpdateTagGroupDto, CreateTagValueDto, UpdateTagValueDto } from './dto';
import { TagGroupWithValues } from './mappers';
import {
  TagGroup,
  TagValue,
  NewTagGroup,
  NewTagValue,
  UpdateTagGroup,
  UpdateTagValue,
  DbTransaction,
} from '../../catalog.types';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { TagValueEntity } from '../../schema/catalog.schema.types';

@Injectable()
export class TagsService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  // ===== TAG GROUPS =====

  async createTagGroup(data: CreateTagGroupDto, tx?: DbTransaction): Promise<TagGroupWithValues> {
    return this.db.run(async (tx) => {
      const newTagGroupData: NewTagGroup = {
        name: data.name,
        description: data.description ?? null,
        displayOrder: data.displayOrder ?? 0,
        isActive: data.isActive ?? true,
      };

      const [newTagGroup] = await tx.insert(pimSchema.tagGroups).values(newTagGroupData).returning();

      return { ...newTagGroup, values: [] };
    }, tx);
  }

  async getTagGroup(id: string, tx?: DbTransaction): Promise<TagGroupWithValues> {
    return this.db.run(async (tx) => {
      const [tagGroup] = await tx.select().from(pimSchema.tagGroups).where(eq(pimSchema.tagGroups.id, id));

      if (!tagGroup) {
        throw new NotFoundException(`Tag group with ID ${id} not found`);
      }

      const tagValues = await tx
        .select()
        .from(pimSchema.tagValues)
        .where(eq(pimSchema.tagValues.groupId, id))
        .orderBy(pimSchema.tagValues.displayOrder, pimSchema.tagValues.name);

      return { ...tagGroup, values: tagValues };
    }, tx);
  }

  async getTagGroupWithValues(id: string, tx?: DbTransaction): Promise<TagGroupWithValues> {
    return this.db.run(async (tx) => {
      const [tagGroup] = await tx.select().from(pimSchema.tagGroups).where(eq(pimSchema.tagGroups.id, id));

      if (!tagGroup) {
        throw new NotFoundException(`Tag group with ID ${id} not found`);
      }

      const tagValues = await tx
        .select()
        .from(pimSchema.tagValues)
        .where(and(eq(pimSchema.tagValues.groupId, id), eq(pimSchema.tagValues.isActive, true)))
        .orderBy(pimSchema.tagValues.displayOrder, pimSchema.tagValues.name);

      return { ...tagGroup, values: tagValues };
    }, tx);
  }

  async listTagGroups(filters?: { isActive?: boolean }, tx?: DbTransaction): Promise<TagGroupWithValues[]> {
    return this.db.run(async (tx) => {
      const conditions: SQL[] = [];
      const isActiveFilter = filters?.isActive !== undefined ? filters.isActive : true;
      conditions.push(eq(pimSchema.tagGroups.isActive, isActiveFilter));

      const tagGroups = await tx
        .select()
        .from(pimSchema.tagGroups)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(pimSchema.tagGroups.displayOrder, pimSchema.tagGroups.name);

      const tagValues = await tx
        .select()
        .from(pimSchema.tagValues)
        .where(
          inArray(
            pimSchema.tagValues.groupId,
            tagGroups.map((group) => group.id),
          ),
        );

      const valueMap = new Map<string, TagValue[]>();
      for (const tagValue of tagValues) {
        valueMap.set(tagValue.groupId, [...(valueMap.get(tagValue.groupId) || []), tagValue]);
      }

      return tagGroups.map((group) => ({ ...group, values: valueMap.get(group.id) || [] }));
    }, tx);
  }

  async updateTagGroup(id: string, data: UpdateTagGroupDto, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      await this.getTagGroup(id, tx);

      const updateData: UpdateTagGroup = {
        name: data.name,
        description: data.description,
        displayOrder: data.displayOrder,
        isActive: data.isActive,
      };

      const updatedTagGroups = await tx
        .update(pimSchema.tagGroups)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagGroups.id, id))
        .returning();

      if (updatedTagGroups.length === 0) {
        throw new NotFoundException(`Updated tag group with ID ${id} not found`);
      }
    }, tx);
  }

  async deleteTagGroup(id: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      await this.getTagGroup(id, tx);

      await tx
        .update(pimSchema.tagValues)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagValues.groupId, id));

      await tx
        .update(pimSchema.tagGroups)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagGroups.id, id));
    }, tx);
  }

  // ===== TAG VALUES =====

  async createTagValue(data: CreateTagValueDto, tx?: DbTransaction): Promise<TagValueEntity> {
    return this.db.run(async (tx) => {
      const tagGroup = await this.getTagGroup(data.groupId, tx);

      if (tagGroup.values.some((value) => value.name === data.name)) {
        throw new BadRequestException(`Tag value with name "${data.name}" already exists in this group`);
      }

      const newTagValueData: NewTagValue = {
        groupId: data.groupId,
        name: data.name,
        displayOrder: data.displayOrder ?? tagGroup.values.reduce((max, cur) => Math.max(max, cur.displayOrder), 0) + 1,
        isActive: data.isActive ?? true,
      };

      const newTagValues = await tx.insert(pimSchema.tagValues).values(newTagValueData).returning();

      if (newTagValues.length === 0) {
        throw new Error('Failed to get created tag value');
      }

      return newTagValues[0];
    }, tx);
  }

  async getTagValue(id: string, tx?: DbTransaction): Promise<TagValueEntity> {
    return this.db.run(async (tx) => {
      const [tagValue] = await tx.select().from(pimSchema.tagValues).where(eq(pimSchema.tagValues.id, id));

      if (!tagValue) {
        throw new NotFoundException(`Tag value with ID ${id} not found`);
      }

      return tagValue;
    }, tx);
  }

  async updateTagValue(id: string, data: UpdateTagValueDto, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const existingValue = await this.getTagValue(id, tx);

      if (data.name) {
        const [duplicate] = await tx
          .select()
          .from(pimSchema.tagValues)
          .where(
            and(
              eq(pimSchema.tagValues.groupId, existingValue.groupId),
              eq(pimSchema.tagValues.name, data.name),
              sql`${pimSchema.tagValues.id} != ${id}`,
            ),
          );

        if (duplicate) {
          throw new BadRequestException(`Tag value with name "${data.name}" already exists in this group`);
        }
      }

      const updateData: UpdateTagValue = {
        name: data.name,
        displayOrder: data.displayOrder,
        isActive: data.isActive,
      };

      const updatedTagValues = await tx
        .update(pimSchema.tagValues)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagValues.id, id))
        .returning();

      if (updatedTagValues.length === 0) {
        throw new NotFoundException(`Updated tag value with ID ${id} not found`);
      }
    }, tx);
  }

  async deleteTagValue(id: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      await this.getTagValue(id, tx);

      await tx
        .update(pimSchema.tagValues)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagValues.id, id));
    }, tx);
  }
}
