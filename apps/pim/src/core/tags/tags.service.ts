import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { eq, and, sql } from 'drizzle-orm';
import {
  CreateTagGroupDto,
  UpdateTagGroupDto,
  TagGroupResponseDto,
  TagGroupDetailResponseDto,
  CreateTagValueDto,
  UpdateTagValueDto,
  TagValueResponseDto,
  TagValueItemDto,
} from './dto';
import {
  TagGroup,
  TagValue,
  NewTagGroup,
  NewTagValue,
  UpdateTagGroup,
  UpdateTagValue,
  DbTransaction,
} from '../../types';
import { type PimSchema, pimSchema } from '../../schema';

@Injectable()
export class TagsService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  // ===== TAG GROUPS =====

  async createTagGroup(
    data: CreateTagGroupDto,
    tx?: DbTransaction,
  ): Promise<TagGroupResponseDto> {
    const client = this.getClient(tx);

    const newTagGroupData: NewTagGroup = {
      name: data.name,
      description: data.description ?? null,
      displayOrder: data.displayOrder ?? 0,
      isActive: data.isActive ?? true,
    };

    const [newTagGroup] = await client
      .insert(pimSchema.tagGroups)
      .values(newTagGroupData)
      .returning();

    return this.mapTagGroupToResponse(newTagGroup);
  }

  async getTagGroup(
    id: string,
    tx?: DbTransaction,
  ): Promise<TagGroupResponseDto> {
    const client = this.getClient(tx);

    const [tagGroup] = await client
      .select()
      .from(pimSchema.tagGroups)
      .where(eq(pimSchema.tagGroups.id, id));

    if (!tagGroup) {
      throw new NotFoundException(`Tag group with ID ${id} not found`);
    }

    const [countResult] = await client
      .select({ count: sql<number>`count(*)::int` })
      .from(pimSchema.tagValues)
      .where(eq(pimSchema.tagValues.groupId, id));

    const response = this.mapTagGroupToResponse(tagGroup);
    response.valuesCount = countResult?.count ?? 0;

    return response;
  }

  async getTagGroupWithValues(
    id: string,
    tx?: DbTransaction,
  ): Promise<TagGroupDetailResponseDto> {
    const client = this.getClient(tx);

    const [tagGroup] = await client
      .select()
      .from(pimSchema.tagGroups)
      .where(eq(pimSchema.tagGroups.id, id));

    if (!tagGroup) {
      throw new NotFoundException(`Tag group with ID ${id} not found`);
    }

    const tagValues = await client
      .select()
      .from(pimSchema.tagValues)
      .where(eq(pimSchema.tagValues.groupId, id))
      .orderBy(pimSchema.tagValues.displayOrder, pimSchema.tagValues.name);

    const response: TagGroupDetailResponseDto = {
      ...tagGroup,
      values: tagValues.map(this.mapTagValueToItemDto),
    };

    return response;
  }

  async listTagGroups(
    filters?: { isActive?: boolean },
    tx?: DbTransaction,
  ): Promise<TagGroupResponseDto[]> {
    const client = this.getClient(tx);

    const conditions = [];
    if (filters?.isActive !== undefined) {
      conditions.push(eq(pimSchema.tagGroups.isActive, filters.isActive));
    }

    const tagGroups = await client
      .select()
      .from(pimSchema.tagGroups)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(pimSchema.tagGroups.displayOrder, pimSchema.tagGroups.name);

    const tagGroupsWithCounts = await Promise.all(
      tagGroups.map(async (group) => {
        const [countResult] = await client
          .select({ count: sql<number>`count(*)::int` })
          .from(pimSchema.tagValues)
          .where(eq(pimSchema.tagValues.groupId, group.id));

        const response = this.mapTagGroupToResponse(group);
        response.valuesCount = countResult?.count ?? 0;
        return response;
      }),
    );

    return tagGroupsWithCounts;
  }

  async updateTagGroup(
    id: string,
    data: UpdateTagGroupDto,
    tx?: DbTransaction,
  ): Promise<TagGroupResponseDto> {
    const client = this.getClient(tx);

    await this.getTagGroup(id, tx);

    const updateData: UpdateTagGroup = {
      name: data.name,
      description: data.description,
      displayOrder: data.displayOrder,
      isActive: data.isActive,
    };

    const [updatedTagGroup] = await client
      .update(pimSchema.tagGroups)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(pimSchema.tagGroups.id, id))
      .returning();

    return this.mapTagGroupToResponse(updatedTagGroup);
  }

  async deleteTagGroup(id: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    await this.getTagGroup(id, tx);

    const [valuesCount] = await client
      .select({ count: sql<number>`count(*)::int` })
      .from(pimSchema.tagValues)
      .where(eq(pimSchema.tagValues.groupId, id));

    if (valuesCount && valuesCount.count > 0) {
      throw new BadRequestException(
        `Cannot delete tag group with ${valuesCount.count} tag values. Delete values first.`,
      );
    }

    await client
      .delete(pimSchema.tagGroups)
      .where(eq(pimSchema.tagGroups.id, id));
  }

  // ===== TAG VALUES =====

  async createTagValue(
    data: CreateTagValueDto,
    tx?: DbTransaction,
  ): Promise<TagValueResponseDto> {
    const client = this.getClient(tx);

    await this.getTagGroup(data.groupId, tx);

    const [existing] = await client
      .select()
      .from(pimSchema.tagValues)
      .where(
        and(
          eq(pimSchema.tagValues.groupId, data.groupId),
          eq(pimSchema.tagValues.name, data.name),
        ),
      );

    if (existing) {
      throw new BadRequestException(
        `Tag value with name "${data.name}" already exists in this group`,
      );
    }

    const newTagValueData: NewTagValue = {
      groupId: data.groupId,
      name: data.name,
      displayOrder: data.displayOrder ?? 0,
      isActive: data.isActive ?? true,
    };

    const [newTagValue] = await client
      .insert(pimSchema.tagValues)
      .values(newTagValueData)
      .returning();

    return this.mapTagValueToResponse(newTagValue);
  }

  async getTagValue(
    id: string,
    tx?: DbTransaction,
  ): Promise<TagValueResponseDto> {
    const client = this.getClient(tx);

    const [tagValue] = await client
      .select({
        value: pimSchema.tagValues,
        group: pimSchema.tagGroups,
      })
      .from(pimSchema.tagValues)
      .leftJoin(
        pimSchema.tagGroups,
        eq(pimSchema.tagValues.groupId, pimSchema.tagGroups.id),
      )
      .where(eq(pimSchema.tagValues.id, id));

    if (!tagValue) {
      throw new NotFoundException(`Tag value with ID ${id} not found`);
    }

    const response = this.mapTagValueToResponse(tagValue.value);
    if (tagValue.group) {
      response.groupName = tagValue.group.name;
    }

    return response;
  }

  async listTagValuesByGroup(
    groupId: string,
    tx?: DbTransaction,
  ): Promise<TagValueResponseDto[]> {
    const client = this.getClient(tx);

    await this.getTagGroup(groupId, tx);

    const tagValues = await client
      .select()
      .from(pimSchema.tagValues)
      .where(eq(pimSchema.tagValues.groupId, groupId))
      .orderBy(pimSchema.tagValues.displayOrder, pimSchema.tagValues.name);

    return tagValues.map(this.mapTagValueToResponse);
  }

  async updateTagValue(
    id: string,
    data: UpdateTagValueDto,
    tx?: DbTransaction,
  ): Promise<TagValueResponseDto> {
    const client = this.getClient(tx);

    const existingValue = await this.getTagValue(id, tx);

    if (data.name) {
      const [duplicate] = await client
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
        throw new BadRequestException(
          `Tag value with name "${data.name}" already exists in this group`,
        );
      }
    }

    const updateData: UpdateTagValue = {
      name: data.name,
      displayOrder: data.displayOrder,
      isActive: data.isActive,
    };

    const [updatedTagValue] = await client
      .update(pimSchema.tagValues)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(pimSchema.tagValues.id, id))
      .returning();

    return this.mapTagValueToResponse(updatedTagValue);
  }

  async deleteTagValue(id: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    await this.getTagValue(id, tx);

    await client
      .delete(pimSchema.tagValues)
      .where(eq(pimSchema.tagValues.id, id));
  }

  // ===== HELPER METHODS =====

  private mapTagGroupToResponse(tagGroup: TagGroup): TagGroupResponseDto {
    return {
      id: tagGroup.id,
      name: tagGroup.name,
      description: tagGroup.description,
      displayOrder: tagGroup.displayOrder,
      isActive: tagGroup.isActive,
      createdAt: tagGroup.createdAt,
      updatedAt: tagGroup.updatedAt,
    };
  }

  private mapTagValueToResponse(tagValue: TagValue): TagValueResponseDto {
    return {
      id: tagValue.id,
      groupId: tagValue.groupId,
      name: tagValue.name,
      displayOrder: tagValue.displayOrder,
      isActive: tagValue.isActive,
      createdAt: tagValue.createdAt,
      updatedAt: tagValue.updatedAt,
    };
  }

  private mapTagValueToItemDto(tagValue: TagValue): TagValueItemDto {
    return {
      id: tagValue.id,
      name: tagValue.name,
      displayOrder: tagValue.displayOrder,
      isActive: tagValue.isActive,
      createdAt: tagValue.createdAt,
      updatedAt: tagValue.updatedAt,
    };
  }
}

