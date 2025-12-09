import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { eq, and, sql, SQL } from 'drizzle-orm';
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
import { TagMapper } from './mappers';
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
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) { }

  private get client() {
    return this.db.db;
  }

  private async inTx<T>(
    fn: (tx: DbTransaction) => Promise<T>,
    tx?: DbTransaction,
  ): Promise<T> {
    return tx ? fn(tx) : this.client.transaction(fn);
  }

  // ===== TAG GROUPS =====

  async createTagGroup(
    data: CreateTagGroupDto,
    tx?: DbTransaction,
  ): Promise<TagGroupResponseDto> {
    return this.inTx(async (tx) => {
      const newTagGroupData: NewTagGroup = {
        name: data.name,
        description: data.description ?? null,
        displayOrder: data.displayOrder ?? 0,
        isActive: data.isActive ?? true,
      };

      const [newTagGroup] = await tx
        .insert(pimSchema.tagGroups)
        .values(newTagGroupData)
        .returning();

      return this.mapTagGroupToResponse(newTagGroup);
    }, tx)
  }

  async getTagGroup(
    id: string,
    tx?: DbTransaction,
  ): Promise<TagGroupResponseDto> {
    return this.inTx(async (tx) => {
      const [tagGroup] = await tx
        .select()
        .from(pimSchema.tagGroups)
        .where(eq(pimSchema.tagGroups.id, id));

      if (!tagGroup) {
        throw new NotFoundException(`Tag group with ID ${id} not found`);
      }

      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(pimSchema.tagValues)
        .where(eq(pimSchema.tagValues.groupId, id));

      const response = this.mapTagGroupToResponse(tagGroup);
      response.valuesCount = countResult?.count ?? 0;

      return response;
    }, tx)
  }

  async getTagGroupWithValues(
    id: string,
    tx?: DbTransaction,
  ): Promise<TagGroupDetailResponseDto> {
    return this.inTx(async (tx) => {
      const [tagGroup] = await tx
        .select()
        .from(pimSchema.tagGroups)
        .where(eq(pimSchema.tagGroups.id, id));

      if (!tagGroup) {
        throw new NotFoundException(`Tag group with ID ${id} not found`);
      }

      const tagValues = await tx
        .select()
        .from(pimSchema.tagValues)
        .where(
          and(
            eq(pimSchema.tagValues.groupId, id),
            eq(pimSchema.tagValues.isActive, true)
          )
        )
        .orderBy(pimSchema.tagValues.displayOrder, pimSchema.tagValues.name);

      const response: TagGroupDetailResponseDto = {
        ...tagGroup,
        values: tagValues.map(this.mapTagValueToItemDto),
      };

      return response;
    }, tx)


  }

  async listTagGroups(
    filters?: { isActive?: boolean },
    tx?: DbTransaction,
  ): Promise<TagGroupResponseDto[]> {
    return this.inTx(async (tx) => {

      const conditions: SQL[] = [];
      const isActiveFilter = filters?.isActive !== undefined ? filters.isActive : true;
      conditions.push(eq(pimSchema.tagGroups.isActive, isActiveFilter));

      const tagGroups = await tx
        .select()
        .from(pimSchema.tagGroups)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(pimSchema.tagGroups.displayOrder, pimSchema.tagGroups.name);

      const tagGroupsWithCounts = await Promise.all(
        tagGroups.map(async (group) => {
          const [countResult] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(pimSchema.tagValues)
            .where(eq(pimSchema.tagValues.groupId, group.id));

          const response = this.mapTagGroupToResponse(group);
          response.valuesCount = countResult?.count ?? 0;
          return response;
        }),
      );

      return tagGroupsWithCounts;
    }, tx)

  }

  async updateTagGroup(
    id: string,
    data: UpdateTagGroupDto,
    tx?: DbTransaction,
  ): Promise<TagGroupResponseDto> {
    return this.inTx(async (tx) => {
      await this.getTagGroup(id, tx);

      const updateData: UpdateTagGroup = {
        name: data.name,
        description: data.description,
        displayOrder: data.displayOrder,
        isActive: data.isActive,
      };

      const [updatedTagGroup] = await tx
        .update(pimSchema.tagGroups)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagGroups.id, id))
        .returning();

      return this.mapTagGroupToResponse(updatedTagGroup);
    }, tx)
  }

  async deleteTagGroup(id: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      await this.getTagGroup(id, tx);

      const [valuesCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(pimSchema.tagValues)
        .where(eq(pimSchema.tagValues.groupId, id));

      if (valuesCount && valuesCount.count > 0) {
        throw new BadRequestException(
          `Cannot delete tag group with ${valuesCount.count} tag values. Delete values first.`,
        );
      }

      await tx
        .update(pimSchema.tagGroups)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagGroups.id, id));
    }, tx)
  }

  // ===== TAG VALUES =====

  async createTagValue(
    data: CreateTagValueDto,
    tx?: DbTransaction,
  ): Promise<TagValueResponseDto> {
    return this.inTx(async (tx) => {
      await this.getTagGroup(data.groupId, tx);

      const [existing] = await tx
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

      const [newTagValue] = await tx
        .insert(pimSchema.tagValues)
        .values(newTagValueData)
        .returning();

      return this.mapTagValueToResponse(newTagValue);
    }, tx)

  }

  async getTagValue(
    id: string,
    tx?: DbTransaction,
  ): Promise<TagValueResponseDto> {
    return this.inTx(async (tx) => {
      const [tagValue] = await tx
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
    }, tx)
  }

  async listTagValuesByGroup(
    groupId: string,
    tx?: DbTransaction,
  ): Promise<TagValueResponseDto[]> {
    return this.inTx(async (tx) => {
      await this.getTagGroup(groupId, tx);

      const tagValues = await tx
        .select()
        .from(pimSchema.tagValues)
        .where(
          and(
            eq(pimSchema.tagValues.groupId, groupId),
            eq(pimSchema.tagValues.isActive, true)
          )
        )
        .orderBy(pimSchema.tagValues.displayOrder, pimSchema.tagValues.name);

      return tagValues.map(this.mapTagValueToResponse);
    }, tx)
  }

  async updateTagValue(
    id: string,
    data: UpdateTagValueDto,
    tx?: DbTransaction,
  ): Promise<TagValueResponseDto> {
    return this.inTx(async (tx) => {
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

      const [updatedTagValue] = await tx
        .update(pimSchema.tagValues)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagValues.id, id))
        .returning();

      return this.mapTagValueToResponse(updatedTagValue);
    }, tx)

  }

  async deleteTagValue(id: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      await this.getTagValue(id, tx);

      await tx
        .update(pimSchema.tagValues)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.tagValues.id, id));
    }, tx)
  }

  // ===== HELPER METHODS =====

  private mapTagGroupToResponse(tagGroup: TagGroup): TagGroupResponseDto {
    return TagMapper.toGroupDto(tagGroup);
  }

  private mapTagValueToResponse(tagValue: TagValue): TagValueResponseDto {
    return TagMapper.toValueDto(tagValue);
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

