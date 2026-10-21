import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull, max, sql } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { FieldCaptureActor, FieldCaptureBarcodeStatus, MIN_REFERENCE_PHOTOS } from '../sku-field-capture.rules';

export type CompleteFieldCaptureInput = {
  packageWidthMm: number;
  packageLengthMm: number;
  packageHeightMm: number;
  packageWeightG: number;
  barcodeStatus: FieldCaptureBarcodeStatus;
  scannedBarcode?: string;
  allFacesConfirmed: true;
  expectedLastCompletedAt?: string | null;
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
      await this.lockSku(trx, skuId);
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
      if (input.expectedLastCompletedAt !== undefined) {
        await this.assertNotChangedSince(trx, skuId, input.expectedLastCompletedAt);
      }

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
          packageWeightG: input.packageWeightG,
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
          // 취소된 완료를 다시 끝내면 처음 완료한 것으로 본다
          set: {
            ...captureValues,
            firstCompletedAt: sql`case when ${wmsTables.skuFieldCaptures.deletedAt} is null then ${wmsTables.skuFieldCaptures.firstCompletedAt} else now() end`,
            lastCompletedAt: sql`now()`,
            deletedAt: null,
            deletedById: null,
            deletedByLabel: null,
          },
        });

      await trx
        .insert(wmsTables.skuFieldCaptureEvents)
        .values({ skuId, workerId: actor.workerId, workerLabel: actor.workerLabel });
    }, tx);
  }

  /**
   * 잘못 끝낸 상품을 미완료로 되돌린다 — 소프트 삭제라 행은 남기고 취소 시각·취소자만 찍는다.
   * 이 상품의 내 작업 기록도 취소로 표시해 작업 수에서 뺀다. 치수·사진·바코드는 그대로 둔다(되살릴 수 있게).
   */
  async cancel(skuId: string, actor: FieldCaptureActor, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      await this.assertSkuExists(trx, skuId);
      const cap = wmsTables.skuFieldCaptures;
      const [capture] = await trx
        .select({ lastWorkerId: cap.lastWorkerId })
        .from(cap)
        .where(and(eq(cap.skuId, skuId), isNull(cap.deletedAt)));
      if (!capture) throw new NotFoundError('완료된 상품이 아니에요.');
      if (capture.lastWorkerId !== actor.workerId) {
        throw new ConflictError('다른 작업자가 마지막으로 끝낸 상품이라 취소할 수 없어요.');
      }

      await trx
        .update(cap)
        .set({ deletedAt: sql`now()`, deletedById: actor.workerId, deletedByLabel: actor.workerLabel })
        .where(eq(cap.skuId, skuId));
      const ev = wmsTables.skuFieldCaptureEvents;
      await trx
        .update(ev)
        .set({ cancelledAt: sql`now()` })
        .where(and(eq(ev.skuId, skuId), eq(ev.workerId, actor.workerId), isNull(ev.cancelledAt)));
    }, tx);
  }

  /** 화면을 연 뒤 다른 작업자가 먼저 저장(또는 취소)했으면 덮어쓰지 않는다. */
  private async assertNotChangedSince(trx: DbTx, skuId: string, expected: string | null): Promise<void> {
    const cap = wmsTables.skuFieldCaptures;
    const [row] = await trx
      .select({ lastCompletedAt: cap.lastCompletedAt })
      .from(cap)
      .where(and(eq(cap.skuId, skuId), isNull(cap.deletedAt)));
    const current = row ? row.lastCompletedAt.toISOString() : null;
    const want = expected === null ? null : new Date(expected).toISOString();
    if (current !== want) {
      throw new ConflictError('다른 작업자가 방금 이 상품을 저장했어요. 새로 불러와서 확인해 주세요.');
    }
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
    const sku = await this.lockSku(trx, skuId);
    if (!sku || sku.isDeleted) throw new NotFoundError(`SKU 를 찾을 수 없습니다: ${skuId}`);
  }

  // 사진 연결·삭제·완료를 SKU 행 잠금으로 줄 세운다 — 완료가 센 사진 수와 sortOrder 가 동시 삭제·추가에 어긋나지 않게
  private async lockSku(trx: DbTx, skuId: string): Promise<{ isDeleted: boolean } | undefined> {
    const [sku] = await trx
      .select({ isDeleted: wmsTables.skus.isDeleted })
      .from(wmsTables.skus)
      .where(eq(wmsTables.skus.id, skuId))
      .for('update');
    return sku;
  }
}
