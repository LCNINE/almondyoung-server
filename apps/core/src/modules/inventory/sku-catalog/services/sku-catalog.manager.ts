import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx, SkuBarcode } from '../../schema/inventory.schema';
import { CreateSkuDto } from '../dto/create-sku.dto';
import { UpdateSkuDto } from '../dto/update-sku.dto';
import { AddBarcodeDto } from '../dto/add-barcode.dto';
import { SkuResponseDto } from '../dto/sku-response.dto';
import { SkuCatalogReader } from './sku-catalog.reader';
import { deliveryProfileViolation, type SkuProfileState } from '../sku-delivery-profile.rule';
import { SkuDeliveryProfileNotFoundError, SkuDeliveryProfileRequiredError } from '../sku-catalog.errors';

@Injectable()
export class SkuCatalogManager {
  private readonly logger = new Logger(SkuCatalogManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: SkuCatalogReader,
  ) {}

  async create(dto: CreateSkuDto, tx?: DbTx): Promise<SkuResponseDto> {
    return this.dbService.run(async (trx) => {
      const { supplierIds, categoryIds, source, skuGroupId, imageUploadIds, ...skuData } = dto;

      await this.assertDeliveryProfile(trx, skuData.name, null, {
        // 컬럼 DEFAULT 와 같은 기본값 — 안 보내면 physical 로 들어간다
        stockType: skuData.stockType ?? 'physical',
        deliveryProfileId: skuData.deliveryProfileId ?? null,
      });

      const [newSku] = await trx
        .insert(wmsTables.skus)
        .values({
          ...skuData,
          ...(skuGroupId && { groupId: skuGroupId }),
          code: await this.generateSkuCode(trx),
        })
        .returning();

      if (supplierIds && supplierIds.length > 0) {
        await trx
          .insert(wmsTables.skuSuppliers)
          .values(supplierIds.map((supplierId) => ({ skuId: newSku.id, supplierId })));
      }

      if (categoryIds && categoryIds.length > 0) {
        await trx
          .insert(wmsTables.skuCategories)
          .values(categoryIds.map((categoryId) => ({ skuId: newSku.id, categoryId })));
      }

      if (imageUploadIds && imageUploadIds.length > 0) {
        const imageRecords = imageUploadIds.map((uploadId, index) => ({
          skuId: newSku.id,
          uploadId,
          isPrimary: index === 0,
          sortOrder: index,
        }));
        await trx.insert(wmsTables.skuImages).values(imageRecords);
      }

      // Create primary barcode that equals SKU code
      await trx.insert(wmsTables.skuBarcodes).values({
        skuId: newSku.id,
        barcode: newSku.code,
        isPrimary: true,
      });

      return this.reader.getById(newSku.id, trx);
    }, tx);
  }

  async update(skuId: string, dto: UpdateSkuDto, tx?: DbTx): Promise<SkuResponseDto> {
    return this.dbService.run(async (trx) => {
      const { supplierIds, categoryIds, skuGroupId, imageUploadIds, ...updateData } = dto;

      const before = await this.loadProfileState(trx, skuId);
      await this.assertDeliveryProfile(trx, updateData.name ?? before.name, before, {
        stockType: updateData.stockType ?? before.stockType,
        // undefined = 안 건드림, null = 지움
        deliveryProfileId:
          updateData.deliveryProfileId === undefined ? before.deliveryProfileId : updateData.deliveryProfileId,
      });

      const skuUpdatePayload = {
        ...updateData,
        ...(skuGroupId !== undefined && { groupId: skuGroupId }),
      };

      if (Object.keys(skuUpdatePayload).length > 0) {
        await trx.update(wmsTables.skus).set(skuUpdatePayload).where(eq(wmsTables.skus.id, skuId));
      }

      if (supplierIds !== undefined) {
        await trx.delete(wmsTables.skuSuppliers).where(eq(wmsTables.skuSuppliers.skuId, skuId));

        if (supplierIds.length > 0) {
          await trx.insert(wmsTables.skuSuppliers).values(supplierIds.map((supplierId) => ({ skuId, supplierId })));
        }
      }

      if (categoryIds !== undefined) {
        await trx.delete(wmsTables.skuCategories).where(eq(wmsTables.skuCategories.skuId, skuId));

        if (categoryIds.length > 0) {
          await trx.insert(wmsTables.skuCategories).values(categoryIds.map((categoryId) => ({ skuId, categoryId })));
        }
      }

      if (imageUploadIds !== undefined) {
        await trx.delete(wmsTables.skuImages).where(eq(wmsTables.skuImages.skuId, skuId));

        if (imageUploadIds.length > 0) {
          const imageRecords = imageUploadIds.map((uploadId, index) => ({
            skuId,
            uploadId,
            isPrimary: index === 0,
            sortOrder: index,
          }));
          await trx.insert(wmsTables.skuImages).values(imageRecords);
        }
      }

      return this.reader.getById(skuId, trx);
    }, tx);
  }

  async delete(skuId: string, tx?: DbTx): Promise<void> {
    if (!skuId || typeof skuId !== 'string') {
      throw new BadRequestError('Valid SKU ID is required');
    }

    await this.dbService.run(async (trx) => {
      const [sku] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, skuId)).limit(1);

      if (!sku) {
        throw new NotFoundError(`SKU with ID ${skuId} not found`);
      }

      const [stockAgg] = await trx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}),0)` })
        .from(wmsTables.stockLedgers)
        .where(eq(wmsTables.stockLedgers.skuId, skuId));

      const totalStock = stockAgg?.qty ?? 0;
      if (totalStock > 0) {
        throw new ConflictError(
          `Cannot delete SKU ${skuId}: Has active stock of ${totalStock} units. Please adjust stock to zero before deletion.`,
        );
      }

      const matchings = await trx
        .select({ productMatchingId: wmsTables.productVariantSkuLinks.productMatchingId })
        .from(wmsTables.productVariantSkuLinks)
        .where(eq(wmsTables.productVariantSkuLinks.skuId, skuId));

      if (matchings.length > 0) {
        const matchingIds = matchings.map((m) => m.productMatchingId).join(', ');
        throw new ConflictError(
          `Cannot delete SKU ${skuId}: Used in ${matchings.length} product matching(s): ${matchingIds}. Please remove from product matchings first.`,
        );
      }

      const reservations = await trx
        .select({ id: wmsTables.stockReservations.id })
        .from(wmsTables.stockReservations)
        .where(and(eq(wmsTables.stockReservations.skuId, skuId), eq(wmsTables.stockReservations.status, 'confirmed')));

      if (reservations.length > 0) {
        throw new ConflictError(
          `Cannot delete SKU ${skuId}: Has ${reservations.length} active reservation(s). Please release all reservations first.`,
        );
      }

      const deleteResult = await trx
        .update(wmsTables.skus)
        .set({ isDeleted: true, deletedAt: new Date() })
        .where(eq(wmsTables.skus.id, skuId))
        .returning();

      if (deleteResult.length === 0) {
        throw new ConflictError(`Failed to delete SKU ${skuId}. It may have been deleted by another process.`);
      }

      this.logger.log(`SKU ${skuId} (${sku.name}) deleted successfully`);
    }, tx);
  }

  async restore(skuId: string, tx?: DbTx): Promise<SkuResponseDto> {
    if (!skuId || typeof skuId !== 'string') {
      throw new BadRequestError('Valid SKU ID is required');
    }

    return this.dbService.run(async (trx) => {
      const [sku] = await trx
        .select()
        .from(wmsTables.skus)
        .where(and(eq(wmsTables.skus.id, skuId), eq(wmsTables.skus.isDeleted, true)))
        .limit(1);

      if (!sku) {
        throw new NotFoundError(`Deleted SKU with ID ${skuId} not found. It may not exist or may not be deleted.`);
      }

      const [restored] = await trx
        .update(wmsTables.skus)
        .set({ isDeleted: false, deletedAt: null, updatedAt: new Date() })
        .where(eq(wmsTables.skus.id, skuId))
        .returning();

      if (!restored) {
        throw new ConflictError(`Failed to restore SKU ${skuId}`);
      }

      this.logger.log(`SKU ${skuId} (${sku.name}) restored successfully`);
      return this.reader.getById(skuId, trx);
    }, tx);
  }

  async addBarcode(skuId: string, dto: AddBarcodeDto, tx?: DbTx): Promise<SkuBarcode> {
    const sku = await this.reader.findById(skuId);
    if (!sku) {
      throw new NotFoundError(`SKU with ID ${skuId} not found`);
    }

    return this.dbService.run(async (trx) => {
      const [existing] = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(eq(wmsTables.skuBarcodes.barcode, dto.barcode))
        .limit(1);

      if (existing) {
        throw new ConflictError(`Barcode ${dto.barcode} already exists`);
      }

      const [newBarcode] = await trx
        .insert(wmsTables.skuBarcodes)
        .values({
          skuId,
          barcode: dto.barcode,
          isPrimary: false,
          packingUnit: dto.packingUnit ?? null,
        })
        .returning();

      return newBarcode;
    }, tx);
  }

  async removeBarcode(skuId: string, barcodeId: string, tx?: DbTx): Promise<void> {
    const sku = await this.reader.findById(skuId);
    if (!sku) {
      throw new NotFoundError(`SKU with ID ${skuId} not found`);
    }

    const barcode = await this.dbService.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.skuBarcodes)
        .where(and(eq(wmsTables.skuBarcodes.id, barcodeId), eq(wmsTables.skuBarcodes.skuId, skuId)))
        .limit(1);
      return row;
    }, tx);

    if (!barcode) {
      throw new NotFoundError(`Barcode with ID ${barcodeId} not found for SKU ${skuId}`);
    }

    if (barcode.isPrimary) {
      throw new BadRequestError('Cannot remove primary barcode');
    }

    await this.dbService.run(
      async (trx) => trx.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.id, barcodeId)),
      tx,
    );

    this.logger.log(`Barcode ${barcodeId} removed from SKU ${skuId}`);
  }

  /** 규칙 위반이면 던진다. 프로필 id 가 있으면 존재부터 확인한다 — 없으면 FK 위반이 500 이 된다. */
  private async assertDeliveryProfile(
    trx: DbTx,
    skuName: string,
    before: SkuProfileState | null,
    after: SkuProfileState,
  ): Promise<void> {
    if (after.deliveryProfileId && after.deliveryProfileId !== before?.deliveryProfileId) {
      const [profile] = await trx
        .select({ id: wmsTables.deliveryProfiles.id })
        .from(wmsTables.deliveryProfiles)
        .where(eq(wmsTables.deliveryProfiles.id, after.deliveryProfileId))
        .limit(1);
      if (!profile) {
        throw new SkuDeliveryProfileNotFoundError(`배송 프로필을 찾을 수 없습니다: ${after.deliveryProfileId}`);
      }
    }
    if (deliveryProfileViolation(before, after)) {
      throw new SkuDeliveryProfileRequiredError(
        `재고 유형 ${after.stockType} 인 SKU(${skuName})는 배송 프로필이 필요합니다`,
      );
    }
  }

  private async loadProfileState(trx: DbTx, skuId: string): Promise<SkuProfileState & { name: string }> {
    const [row] = await trx
      .select({
        name: wmsTables.skus.name,
        stockType: wmsTables.skus.stockType,
        deliveryProfileId: wmsTables.skus.deliveryProfileId,
      })
      .from(wmsTables.skus)
      .where(eq(wmsTables.skus.id, skuId))
      .for('update');
    if (!row) throw new NotFoundError(`SKU not found: ${skuId}`);
    return row;
  }

  private async generateSkuCode(tx: DbTx): Promise<string> {
    const prefix = 'P';

    const [lastSku] = await tx
      .select({ code: wmsTables.skus.code })
      .from(wmsTables.skus)
      .where(like(wmsTables.skus.code, `${prefix}%`))
      .orderBy(desc(wmsTables.skus.code))
      .limit(1);

    let nextNumber = 1;
    if (lastSku) {
      const numericPart = lastSku.code.substring(prefix.length);
      const lastNumber = parseInt(numericPart, 10);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }

    return `${prefix}${String(nextNumber).padStart(5, '0')}`;
  }
}
