import { Injectable } from '@nestjs/common';
import { and, count, eq, max, sql } from 'drizzle-orm';
import { BadRequestError, NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { FieldCaptureActor, FieldCaptureBarcodeStatus, MIN_REFERENCE_PHOTOS } from '../sku-field-capture.rules';

export type CompleteFieldCaptureInput = {
  packageWidthMm: number;
  packageLengthMm: number;
  packageHeightMm: number;
  barcodeStatus: FieldCaptureBarcodeStatus;
  scannedBarcode?: string;
  allFacesConfirmed: true;
};

@Injectable()
export class SkuFieldCaptureManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async attachPhoto(skuId: string, fileId: string, actor: FieldCaptureActor, tx?: DbTx): Promise<{ id: string }> {
    return this.dbService.run(async (trx) => {
      await this.assertSkuExists(trx, skuId);
      const [agg] = await trx
        .select({ top: max(wmsTables.skuReferencePhotos.sortOrder) })
        .from(wmsTables.skuReferencePhotos)
        .where(eq(wmsTables.skuReferencePhotos.skuId, skuId));
      const [row] = await trx
        .insert(wmsTables.skuReferencePhotos)
        .values({
          skuId,
          fileId,
          sortOrder: (agg?.top ?? -1) + 1,
          takenById: actor.workerId,
          takenByLabel: actor.workerLabel,
        })
        .returning({ id: wmsTables.skuReferencePhotos.id });
      if (!row) throw new Error('sku_reference_photos insert returned no row');
      return row;
    }, tx);
  }

  async removePhoto(skuId: string, photoId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const deleted = await trx
        .delete(wmsTables.skuReferencePhotos)
        .where(and(eq(wmsTables.skuReferencePhotos.id, photoId), eq(wmsTables.skuReferencePhotos.skuId, skuId)))
        .returning({ id: wmsTables.skuReferencePhotos.id });
      if (deleted.length === 0) throw new NotFoundError(`사진을 찾을 수 없습니다: ${photoId}`);
    }, tx);
  }

  async complete(skuId: string, input: CompleteFieldCaptureInput, actor: FieldCaptureActor, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      await this.assertSkuExists(trx, skuId);

      const [photos] = await trx
        .select({ n: count() })
        .from(wmsTables.skuReferencePhotos)
        .where(eq(wmsTables.skuReferencePhotos.skuId, skuId));
      if ((photos?.n ?? 0) < MIN_REFERENCE_PHOTOS) {
        throw new BadRequestError(`사진이 ${MIN_REFERENCE_PHOTOS}장 이상 필요해요.`);
      }

      const scanned = input.scannedBarcode?.trim();
      if (input.barcodeStatus === 'scanned' && !scanned) {
        throw new BadRequestError('바코드를 스캔해 주세요.');
      }

      const barcode = input.barcodeStatus === 'scanned' ? scanned : undefined;
      let conflictSkuId: string | null = null;
      if (barcode) conflictSkuId = await this.attachBarcode(trx, skuId, barcode);

      await trx
        .update(wmsTables.skus)
        .set({
          packageWidthMm: input.packageWidthMm,
          packageLengthMm: input.packageLengthMm,
          packageHeightMm: input.packageHeightMm,
          updatedAt: sql`now()`,
        })
        .where(eq(wmsTables.skus.id, skuId));

      const captureValues = {
        barcodeStatus: input.barcodeStatus,
        scannedBarcode: barcode ?? null,
        barcodeConflictSkuId: conflictSkuId,
        allFacesConfirmed: input.allFacesConfirmed,
        lastWorkerId: actor.workerId,
        lastWorkerLabel: actor.workerLabel,
      };
      await trx
        .insert(wmsTables.skuFieldCaptures)
        .values({ skuId, ...captureValues, firstCompletedAt: sql`now()`, lastCompletedAt: sql`now()` })
        .onConflictDoUpdate({
          target: wmsTables.skuFieldCaptures.skuId,
          set: { ...captureValues, lastCompletedAt: sql`now()` },
        });

      await trx
        .insert(wmsTables.skuFieldCaptureEvents)
        .values({ skuId, workerId: actor.workerId, workerLabel: actor.workerLabel });
    }, tx);
  }

  /** 충돌(다른 SKU 소유)이면 그 SKU id, 아니면 null. 사전 조회 없이 ON CONFLICT 로 동시 입력에도 unique 위반이 나지 않게 한다. */
  private async attachBarcode(trx: DbTx, skuId: string, barcode: string): Promise<string | null> {
    const inserted = await trx
      .insert(wmsTables.skuBarcodes)
      .values({ skuId, barcode, isPrimary: false })
      .onConflictDoNothing({ target: wmsTables.skuBarcodes.barcode })
      .returning({ id: wmsTables.skuBarcodes.id });
    if (inserted.length > 0) return null;
    const [owner] = await trx
      .select({ skuId: wmsTables.skuBarcodes.skuId })
      .from(wmsTables.skuBarcodes)
      .where(eq(wmsTables.skuBarcodes.barcode, barcode));
    return owner && owner.skuId !== skuId ? owner.skuId : null;
  }

  private async assertSkuExists(trx: DbTx, skuId: string): Promise<void> {
    const [sku] = await trx
      .select({ id: wmsTables.skus.id })
      .from(wmsTables.skus)
      .where(and(eq(wmsTables.skus.id, skuId), eq(wmsTables.skus.isDeleted, false)));
    if (!sku) throw new NotFoundError(`SKU 를 찾을 수 없습니다: ${skuId}`);
  }
}
