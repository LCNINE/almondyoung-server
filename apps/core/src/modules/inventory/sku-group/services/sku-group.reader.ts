import { Injectable } from '@nestjs/common';
import { eq, isNull, desc, count } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { SkuGroupResponseDto, SkuGroupMemberDto, SkuGroupMembersResponseDto } from '../dto/sku-group-response.dto';

@Injectable()
export class SkuGroupReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async getById(groupId: string, tx?: DbTx): Promise<SkuGroupResponseDto> {
    return this.dbService.run(async (trx) => {
      const { skuGroups, skus } = wmsTables;

      const [group] = await trx.select().from(skuGroups).where(eq(skuGroups.id, groupId)).limit(1);

      if (!group) {
        throw new NotFoundError(`SKU group ${groupId} not found`);
      }

      const [memberCountResult] = await trx.select({ count: count() }).from(skus).where(eq(skus.groupId, groupId));

      return {
        id: group.id,
        name: group.name,
        code: group.code,
        description: group.description,
        memberCount: Number(memberCountResult?.count ?? 0),
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      };
    }, tx);
  }

  async list(tx?: DbTx): Promise<SkuGroupResponseDto[]> {
    return this.dbService.run(async (trx) => {
      const { skuGroups, skus } = wmsTables;

      const groups = await trx.select().from(skuGroups).orderBy(desc(skuGroups.createdAt));

      if (groups.length === 0) {
        return [];
      }

      const memberCounts: Record<string, number> = {};

      for (const group of groups) {
        const [result] = await trx.select({ count: count() }).from(skus).where(eq(skus.groupId, group.id));

        memberCounts[group.id] = Number(result?.count ?? 0);
      }

      return groups.map((group) => ({
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

  async getMembers(groupId: string, tx?: DbTx): Promise<SkuGroupMembersResponseDto> {
    return this.dbService.run(async (trx) => {
      const { skuGroups, skus } = wmsTables;

      const [group] = await trx.select().from(skuGroups).where(eq(skuGroups.id, groupId)).limit(1);

      if (!group) {
        throw new NotFoundError(`SKU group ${groupId} not found`);
      }

      const members = await trx
        .select({
          id: skus.id,
          name: skus.name,
          code: skus.code,
          safetyStock: skus.safetyStock,
          primaryLocationId: skus.primaryLocationId,
        })
        .from(skus)
        .where(eq(skus.groupId, groupId))
        .orderBy(skus.createdAt);

      const memberDtos: SkuGroupMemberDto[] = members.map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
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

  async getUngroupedSkus(limit: number = 50, offset: number = 0, tx?: DbTx): Promise<SkuGroupMemberDto[]> {
    return this.dbService.run(async (trx) => {
      const { skus } = wmsTables;

      const ungrouped = await trx
        .select({
          id: skus.id,
          name: skus.name,
          code: skus.code,
          safetyStock: skus.safetyStock,
          primaryLocationId: skus.primaryLocationId,
        })
        .from(skus)
        .where(isNull(skus.groupId))
        .orderBy(skus.createdAt)
        .limit(limit)
        .offset(offset);

      return ungrouped.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        safetyStock: s.safetyStock,
        primaryLocationId: s.primaryLocationId,
      }));
    }, tx);
  }
}
