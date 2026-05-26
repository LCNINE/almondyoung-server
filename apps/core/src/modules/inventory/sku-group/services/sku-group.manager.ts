import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { CreateSkuGroupDto, UpdateSkuGroupDto } from '../dto/create-sku-group.dto';
import { AddSkuToGroupDto, BulkAddSkusToGroupDto } from '../dto/manage-group-members.dto';
import { SkuGroupResponseDto, BulkAddSkusResponseDto, BulkAddResultItemDto } from '../dto/sku-group-response.dto';
import { SkuGroupReader } from './sku-group.reader';

@Injectable()
export class SkuGroupManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: SkuGroupReader,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async create(createDto: CreateSkuGroupDto, tx?: DbTx): Promise<SkuGroupResponseDto> {
    return this.inTx(async (trx) => {
      const { skuGroups } = wmsTables;

      const groupCode = createDto.code || `G${Math.floor(100000 + Math.random() * 900000)}`;

      const [existingCode] = await trx.select().from(skuGroups).where(eq(skuGroups.code, groupCode)).limit(1);

      if (existingCode) {
        throw new ConflictError(`Group code ${groupCode} already exists`);
      }

      const [group] = await trx
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

  async update(groupId: string, updateDto: UpdateSkuGroupDto, tx?: DbTx): Promise<SkuGroupResponseDto> {
    return this.inTx(async (trx) => {
      const { skuGroups } = wmsTables;

      const [existing] = await trx.select().from(skuGroups).where(eq(skuGroups.id, groupId)).limit(1);

      if (!existing) {
        throw new NotFoundError(`SKU group ${groupId} not found`);
      }

      await trx
        .update(skuGroups)
        .set({
          ...updateDto,
          updatedAt: new Date(),
        })
        .where(eq(skuGroups.id, groupId));

      return this.reader.getById(groupId, trx);
    }, tx);
  }

  async remove(groupId: string, tx?: DbTx): Promise<void> {
    return this.inTx(async (trx) => {
      const { skuGroups } = wmsTables;

      const [group] = await trx.select().from(skuGroups).where(eq(skuGroups.id, groupId)).limit(1);

      if (!group) {
        throw new NotFoundError(`SKU group ${groupId} not found`);
      }

      // ON DELETE SET NULL will detach members automatically
      await trx.delete(skuGroups).where(eq(skuGroups.id, groupId));
    }, tx);
  }

  async addSku(
    groupId: string,
    addDto: AddSkuToGroupDto,
    tx?: DbTx,
  ): Promise<{ success: boolean; skuId: string; groupId: string }> {
    return this.inTx(async (trx) => {
      const { skuGroups, skus } = wmsTables;

      const [group] = await trx.select().from(skuGroups).where(eq(skuGroups.id, groupId)).limit(1);

      if (!group) {
        throw new NotFoundError(`SKU group ${groupId} not found`);
      }

      const [sku] = await trx.select().from(skus).where(eq(skus.id, addDto.skuId)).limit(1);

      if (!sku) {
        throw new NotFoundError(`SKU ${addDto.skuId} not found`);
      }

      await trx
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

  async bulkAddSkus(groupId: string, bulkDto: BulkAddSkusToGroupDto, tx?: DbTx): Promise<BulkAddSkusResponseDto> {
    return this.inTx(async (trx) => {
      const results: BulkAddResultItemDto[] = [];
      let successCount = 0;
      let failedCount = 0;

      for (const skuId of bulkDto.skuIds) {
        try {
          await this.addSku(groupId, { skuId }, trx);
          results.push({ skuId, success: true });
          successCount++;
        } catch (error) {
          results.push({
            skuId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
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

  async removeSku(skuId: string, tx?: DbTx): Promise<{ success: boolean }> {
    return this.inTx(async (trx) => {
      const { skus } = wmsTables;

      const [sku] = await trx.select().from(skus).where(eq(skus.id, skuId)).limit(1);

      if (!sku) {
        throw new NotFoundError(`SKU ${skuId} not found`);
      }

      await trx
        .update(skus)
        .set({
          groupId: null,
          updatedAt: new Date(),
        })
        .where(eq(skus.id, skuId));

      return { success: true };
    }, tx);
  }
}
