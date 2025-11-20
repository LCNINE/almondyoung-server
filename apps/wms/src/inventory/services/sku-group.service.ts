import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { eq, and, isNull, desc, count } from 'drizzle-orm';
import { CreateSkuGroupDto, UpdateSkuGroupDto } from '../dto/sku-groups/create-sku-group.dto';
import { AddSkuToGroupDto, BulkAddSkusToGroupDto } from '../dto/sku-groups/manage-group-members.dto';
import {
  SkuGroupResponseDto,
  SkuGroupMemberDto,
  SkuGroupMembersResponseDto,
  BulkAddSkusResponseDto,
  BulkAddResultItemDto
} from '../dto/sku-groups/sku-group-response.dto';

@Injectable()
export class SkuGroupService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) { }

  private get db() {
    return this.dbService.db;
  }

  /**
   * Create a new SKU group
   */
  async createSkuGroup(createDto: CreateSkuGroupDto, tx?: DbTx): Promise<SkuGroupResponseDto> {
    return this.inTx(async (tx) => {
      const { skuGroups, skus } = wmsTables;

      // Generate code if not provided
      const groupCode = createDto.code || `G${Math.floor(100000 + Math.random() * 900000)}`;

      // Check code uniqueness
      const [existingCode] = await tx
        .select()
        .from(skuGroups)
        .where(eq(skuGroups.code, groupCode))
        .limit(1);

      if (existingCode) {
        throw new ConflictException(`Group code ${groupCode} already exists`);
      }

      // Create group
      const [group] = await tx
        .insert(skuGroups)
        .values({
          name: createDto.name,
          code: groupCode,
          description: createDto.description ?? null,
        })
        .returning();

      return {
        id: group.id,
        name: group.name,
        code: group.code,
        description: group.description,
        memberCount: 0,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      };
    }, tx);
  }

  /**
   * Get SKU group by ID with member count
   */
  async getSkuGroupById(groupId: string, tx?: DbTx): Promise<SkuGroupResponseDto> {
    return this.inTx(async (tx) => {
      const { skuGroups, skus } = wmsTables;

      const [group] = await tx
        .select()
        .from(skuGroups)
        .where(eq(skuGroups.id, groupId))
        .limit(1);

      if (!group) {
        throw new NotFoundException(`SKU group ${groupId} not found`);
      }

      // Count members
      const [memberCountResult] = await tx
        .select({ count: count() })
        .from(skus)
        .where(eq(skus.groupId, groupId));

      const memberCount = Number(memberCountResult?.count ?? 0);

      return {
        id: group.id,
        name: group.name,
        code: group.code,
        description: group.description,
        memberCount,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      };
    }, tx);
  }

  /**
   * List all SKU groups with member counts
   */
  async listSkuGroups(tx?: DbTx): Promise<SkuGroupResponseDto[]> {
    return this.inTx(async (tx) => {
      const { skuGroups, skus } = wmsTables;

      const groups = await tx
        .select()
        .from(skuGroups)
        .orderBy(desc(skuGroups.createdAt));

      // Get member counts for all groups in a single query
      const groupIds = groups.map(g => g.id);

      if (groupIds.length === 0) {
        return [];
      }

      // Count members for each group
      const memberCounts: Record<string, number> = {};

      for (const group of groups) {
        const [result] = await tx
          .select({ count: count() })
          .from(skus)
          .where(eq(skus.groupId, group.id));

        memberCounts[group.id] = Number(result?.count ?? 0);
      }

      return groups.map(group => ({
        id: group.id,
        name: group.name,
        code: group.code,
        description: group.description,
        memberCount: memberCounts[group.id] || 0,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      }));
    }, tx);
  }

  /**
   * Update SKU group
   */
  async updateSkuGroup(
    groupId: string,
    updateDto: UpdateSkuGroupDto,
    tx?: DbTx
  ): Promise<SkuGroupResponseDto> {
    return this.inTx(async (tx) => {
      const { skuGroups } = wmsTables;

      const [existing] = await tx
        .select()
        .from(skuGroups)
        .where(eq(skuGroups.id, groupId))
        .limit(1);

      if (!existing) {
        throw new NotFoundException(`SKU group ${groupId} not found`);
      }

      await tx
        .update(skuGroups)
        .set({
          ...updateDto,
          updatedAt: new Date(),
        })
        .where(eq(skuGroups.id, groupId));

      return this.getSkuGroupById(groupId, tx);
    }, tx);
  }

  /**
   * Delete SKU group (sets groupId to null for all members)
   */
  async deleteSkuGroup(groupId: string, tx?: DbTx): Promise<void> {
    return this.inTx(async (tx) => {
      const { skuGroups } = wmsTables;

      const [group] = await tx
        .select()
        .from(skuGroups)
        .where(eq(skuGroups.id, groupId))
        .limit(1);

      if (!group) {
        throw new NotFoundException(`SKU group ${groupId} not found`);
      }

      // Note: ON DELETE SET NULL will automatically set groupId to null for all members
      await tx
        .delete(skuGroups)
        .where(eq(skuGroups.id, groupId));
    }, tx);
  }

  /**
   * Add SKU to group
   */
  async addSkuToGroup(
    groupId: string,
    addDto: AddSkuToGroupDto,
    tx?: DbTx
  ): Promise<{ success: boolean; skuId: string; groupId: string }> {
    return this.inTx(async (tx) => {
      const { skuGroups, skus } = wmsTables;

      // Validate group exists
      const [group] = await tx
        .select()
        .from(skuGroups)
        .where(eq(skuGroups.id, groupId))
        .limit(1);

      if (!group) {
        throw new NotFoundException(`SKU group ${groupId} not found`);
      }

      // Validate SKU exists
      const [sku] = await tx
        .select()
        .from(skus)
        .where(eq(skus.id, addDto.skuId))
        .limit(1);

      if (!sku) {
        throw new NotFoundException(`SKU ${addDto.skuId} not found`);
      }

      // Update SKU to link to group
      await tx
        .update(skus)
        .set({
          groupId,
          updatedAt: new Date(),
        })
        .where(eq(skus.id, addDto.skuId));

      return {
        success: true,
        skuId: addDto.skuId,
        groupId,
      };
    }, tx);
  }

  /**
   * Bulk add SKUs to group
   */
  async bulkAddSkusToGroup(
    groupId: string,
    bulkDto: BulkAddSkusToGroupDto,
    tx?: DbTx
  ): Promise<BulkAddSkusResponseDto> {
    return this.inTx(async (tx) => {
      const results: BulkAddResultItemDto[] = [];
      let successCount = 0;
      let failedCount = 0;

      for (const skuId of bulkDto.skuIds) {
        try {
          await this.addSkuToGroup(groupId, { skuId }, tx);
          results.push({ skuId, success: true });
          successCount++;
        } catch (error) {
          results.push({
            skuId,
            success: false,
            error: error.message,
          });
          failedCount++;
        }
      }

      return {
        success: successCount > 0,
        totalCount: bulkDto.skuIds.length,
        successCount,
        failedCount,
        results,
      };
    }, tx);
  }

  /**
   * Remove SKU from group
   */
  async removeSkuFromGroup(skuId: string, tx?: DbTx): Promise<{ success: boolean }> {
    return this.inTx(async (tx) => {
      const { skus } = wmsTables;

      const [sku] = await tx
        .select()
        .from(skus)
        .where(eq(skus.id, skuId))
        .limit(1);

      if (!sku) {
        throw new NotFoundException(`SKU ${skuId} not found`);
      }

      await tx
        .update(skus)
        .set({
          groupId: null,
          updatedAt: new Date(),
        })
        .where(eq(skus.id, skuId));

      return { success: true };
    }, tx);
  }

  /**
   * Get all SKUs in a group
   */
  async getGroupMembers(
    groupId: string,
    tx?: DbTx
  ): Promise<SkuGroupMembersResponseDto> {
    return this.inTx(async (tx) => {
      const { skuGroups, skus } = wmsTables;

      // Validate group exists
      const [group] = await tx
        .select()
        .from(skuGroups)
        .where(eq(skuGroups.id, groupId))
        .limit(1);

      if (!group) {
        throw new NotFoundException(`SKU group ${groupId} not found`);
      }

      // Get all SKUs in group
      const members = await tx
        .select({
          id: skus.id,
          name: skus.name,
          code: skus.code,
          defaultBarcode: skus.defaultBarcode,
          safetyStock: skus.safetyStock,
          primaryLocationId: skus.primaryLocationId,
        })
        .from(skus)
        .where(eq(skus.groupId, groupId))
        .orderBy(skus.createdAt);

      const memberDtos: SkuGroupMemberDto[] = members.map(m => ({
        id: m.id,
        name: m.name,
        code: m.code,
        defaultBarcode: m.defaultBarcode,
        safetyStock: m.safetyStock,
        primaryLocationId: m.primaryLocationId,
      }));

      return {
        groupId: group.id,
        groupName: group.name,
        totalMembers: memberDtos.length,
        members: memberDtos,
      };
    }, tx);
  }

  /**
   * Get ungrouped SKUs (groupId is null)
   */
  async getUngroupedSkus(
    limit: number = 50,
    offset: number = 0,
    tx?: DbTx
  ): Promise<SkuGroupMemberDto[]> {
    return this.inTx(async (tx) => {
      const { skus } = wmsTables;

      const ungrouped = await tx
        .select({
          id: skus.id,
          name: skus.name,
          code: skus.code,
          defaultBarcode: skus.defaultBarcode,
          safetyStock: skus.safetyStock,
          primaryLocationId: skus.primaryLocationId,
        })
        .from(skus)
        .where(isNull(skus.groupId))
        .orderBy(skus.createdAt)
        .limit(limit)
        .offset(offset);

      return ungrouped.map(s => ({
        id: s.id,
        name: s.name,
        code: s.code,
        defaultBarcode: s.defaultBarcode,
        safetyStock: s.safetyStock,
        primaryLocationId: s.primaryLocationId,
      }));
    }, tx);
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }
}

