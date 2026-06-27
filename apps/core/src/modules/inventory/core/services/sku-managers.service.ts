import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { eq, or } from 'drizzle-orm';
import { CreateSkuManagersDto } from '../dto/sku-managers/create-sku-managers.dto';
import { UpdateSkuManagersDto } from '../dto/sku-managers/update-sku-managers.dto';
import { SkuManagersResponseDto } from '../dto/sku-managers/sku-managers-response.dto';

@Injectable()
export class SkuManagersService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * Assign managers to SKU (create or update)
   */
  async assignManagers(dto: CreateSkuManagersDto, tx?: DbTx): Promise<SkuManagersResponseDto> {
    return this.dbService.run(async (tx) => {
      const { skuManagers, skus } = wmsTables;

      // Validate SKU exists
      const sku = await tx.select().from(skus).where(eq(skus.id, dto.skuId)).limit(1);

      if (!sku[0]) {
        throw new NotFoundException(`SKU with ID ${dto.skuId} not found`);
      }

      // Validate at least one manager is provided
      if (!dto.designerId && !dto.purchaseManagerId && !dto.registrationManagerId) {
        throw new BadRequestException('At least one manager ID must be provided');
      }

      // Check if managers already exist for this SKU
      const existing = await tx.select().from(skuManagers).where(eq(skuManagers.skuId, dto.skuId)).limit(1);

      if (existing[0]) {
        // Update existing managers
        const updated = await tx
          .update(skuManagers)
          .set({
            designerId: dto.designerId,
            purchaseManagerId: dto.purchaseManagerId,
            registrationManagerId: dto.registrationManagerId,
            updatedAt: new Date(),
          })
          .where(eq(skuManagers.skuId, dto.skuId))
          .returning();

        return this.mapToResponseDto(updated[0]);
      } else {
        // Create new manager assignment
        const created = await tx
          .insert(skuManagers)
          .values({
            skuId: dto.skuId,
            designerId: dto.designerId,
            purchaseManagerId: dto.purchaseManagerId,
            registrationManagerId: dto.registrationManagerId,
          })
          .returning();

        return this.mapToResponseDto(created[0]);
      }
    }, tx);
  }

  /**
   * Update managers for a SKU
   */
  async updateManagers(skuId: string, dto: UpdateSkuManagersDto, tx?: DbTx): Promise<SkuManagersResponseDto> {
    return this.dbService.run(async (tx) => {
      const { skuManagers } = wmsTables;

      // Check if managers exist
      const existing = await tx.select().from(skuManagers).where(eq(skuManagers.skuId, skuId)).limit(1);

      if (!existing[0]) {
        throw new NotFoundException(`Managers for SKU ${skuId} not found`);
      }

      // Update managers (partial update supported)
      const updated = await tx
        .update(skuManagers)
        .set({
          ...dto,
          updatedAt: new Date(),
        })
        .where(eq(skuManagers.skuId, skuId))
        .returning();

      return this.mapToResponseDto(updated[0]);
    }, tx);
  }

  /**
   * Get managers by SKU ID
   */
  async getManagersBySkuId(skuId: string, tx?: DbTx): Promise<SkuManagersResponseDto | null> {
    return this.dbService.run(async (tx) => {
      const { skuManagers } = wmsTables;

      const result = await tx.select().from(skuManagers).where(eq(skuManagers.skuId, skuId)).limit(1);

      if (!result[0]) {
        return null;
      }

      return this.mapToResponseDto(result[0]);
    }, tx);
  }

  /**
   * Get all SKUs managed by a specific manager (any role)
   */
  async getSkusByManagerId(
    managerId: string,
    tx?: DbTx,
  ): Promise<
    Array<{
      skuId: string;
      role: 'designer' | 'purchaseManager' | 'registrationManager';
      assignedAt: Date;
    }>
  > {
    return this.dbService.run(async (tx) => {
      const { skuManagers } = wmsTables;

      const results = await tx
        .select()
        .from(skuManagers)
        .where(
          or(
            eq(skuManagers.designerId, managerId),
            eq(skuManagers.purchaseManagerId, managerId),
            eq(skuManagers.registrationManagerId, managerId),
          ),
        );

      // Flatten results to show each role separately
      const skuList: Array<{
        skuId: string;
        role: 'designer' | 'purchaseManager' | 'registrationManager';
        assignedAt: Date;
      }> = [];

      for (const row of results) {
        if (row.designerId === managerId) {
          skuList.push({
            skuId: row.skuId,
            role: 'designer',
            assignedAt: row.createdAt,
          });
        }
        if (row.purchaseManagerId === managerId) {
          skuList.push({
            skuId: row.skuId,
            role: 'purchaseManager',
            assignedAt: row.createdAt,
          });
        }
        if (row.registrationManagerId === managerId) {
          skuList.push({
            skuId: row.skuId,
            role: 'registrationManager',
            assignedAt: row.createdAt,
          });
        }
      }

      return skuList;
    }, tx);
  }

  /**
   * Remove all managers from a SKU
   */
  async removeManagers(skuId: string, tx?: DbTx): Promise<{ success: boolean; message: string }> {
    return this.dbService.run(async (tx) => {
      const { skuManagers } = wmsTables;

      // Check if exists
      const existing = await tx.select().from(skuManagers).where(eq(skuManagers.skuId, skuId)).limit(1);

      if (!existing[0]) {
        throw new NotFoundException(`Managers for SKU ${skuId} not found`);
      }

      await tx.delete(skuManagers).where(eq(skuManagers.skuId, skuId));

      return {
        success: true,
        message: `Managers for SKU ${skuId} removed successfully`,
      };
    }, tx);
  }

  /**
   * Remove specific manager role from SKU
   */
  async removeManagerRole(
    skuId: string,
    role: 'designer' | 'purchaseManager' | 'registrationManager',
    tx?: DbTx,
  ): Promise<SkuManagersResponseDto> {
    return this.dbService.run(async (tx) => {
      const { skuManagers } = wmsTables;

      // Check if exists
      const existing = await tx.select().from(skuManagers).where(eq(skuManagers.skuId, skuId)).limit(1);

      if (!existing[0]) {
        throw new NotFoundException(`Managers for SKU ${skuId} not found`);
      }

      // Update to null the specific role
      const updateData: any = { updatedAt: new Date() };

      if (role === 'designer') {
        updateData.designerId = null;
      } else if (role === 'purchaseManager') {
        updateData.purchaseManagerId = null;
      } else if (role === 'registrationManager') {
        updateData.registrationManagerId = null;
      }

      const updated = await tx.update(skuManagers).set(updateData).where(eq(skuManagers.skuId, skuId)).returning();

      return this.mapToResponseDto(updated[0]);
    }, tx);
  }

  /**
   * Get all manager assignments
   */
  async getAllManagerAssignments(tx?: DbTx): Promise<SkuManagersResponseDto[]> {
    return this.dbService.run(async (tx) => {
      const { skuManagers } = wmsTables;

      const results = await tx.select().from(skuManagers).orderBy(skuManagers.createdAt);

      return results.map((row) => this.mapToResponseDto(row));
    }, tx);
  }

  /**
   * Map database row to response DTO
   */
  private mapToResponseDto(row: any): SkuManagersResponseDto {
    return {
      id: row.id,
      skuId: row.skuId,
      designerId: row.designerId,
      purchaseManagerId: row.purchaseManagerId,
      registrationManagerId: row.registrationManagerId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

}
