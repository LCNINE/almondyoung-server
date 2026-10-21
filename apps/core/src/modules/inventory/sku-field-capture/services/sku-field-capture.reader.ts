import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, max, notInArray, or, sql } from 'drizzle-orm';
import { alias, AnyPgColumn } from 'drizzle-orm/pg-core';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { normalizePositionCode } from '../position-code';
import { FieldCaptureBarcodeStatus, FieldCaptureListFilter, likeContains } from '../sku-field-capture.rules';
import {
  BarcodeOwnerDto,
  FieldCaptureDetailDto,
  FieldCaptureProgressDto,
  FieldCaptureSkuSummaryDto,
  MyCaptureItemDto,
  ShelfPositionDto,
} from '../dto/sku-field-capture.dto';

/** DB 의 varchar 는 TS 에서 string 이라, CHECK 제약이 보장하는 값 집합으로 좁히는 자리. */
function asBarcodeStatus(raw: string): FieldCaptureBarcodeStatus {
  if (raw === 'scanned' || raw === 'no_manufacturer' || raw === 'none') return raw;
  throw new Error(`unexpected barcode_status: ${raw}`);
}

/** 「오늘」은 KST. getProgress 의 작업자별 today 와 countWorkerToday 가 같은 식을 쓴다. */
const completedTodayKst = (completedAt: AnyPgColumn) =>
  sql`(${completedAt} at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date`;

/** KST 날짜 범위(양끝 포함). 비어 있는 쪽은 열어 둔다. */
const completedBetweenKst = (completedAt: AnyPgColumn, from?: string, to?: string) =>
  and(
    from ? sql`(${completedAt} at time zone 'Asia/Seoul')::date >= ${from}::date` : undefined,
    to ? sql`(${completedAt} at time zone 'Asia/Seoul')::date <= ${to}::date` : undefined,
  );

/** 취소(소프트 삭제)되지 않은 완료만 붙인다 — 취소된 SKU 는 미완료로 보인다. */
const liveCaptureOf = (skuId: AnyPgColumn) =>
  and(eq(wmsTables.skuFieldCaptures.skuId, skuId), isNull(wmsTables.skuFieldCaptures.deletedAt));

@Injectable()
export class SkuFieldCaptureReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async findByPosition(rawCode: string, tx?: DbTx): Promise<ShelfPositionDto> {
    const positionCode = normalizePositionCode(rawCode);
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          skuId: wmsTables.skus.id,
          code: wmsTables.skus.code,
          name: wmsTables.skus.name,
          imageUrl: wmsTables.skuShelfPositions.imageUrl,
          barcodeStatus: wmsTables.skuFieldCaptures.barcodeStatus,
          lastWorkerLabel: wmsTables.skuFieldCaptures.lastWorkerLabel,
          lastCompletedAt: wmsTables.skuFieldCaptures.lastCompletedAt,
        })
        .from(wmsTables.skuShelfPositions)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.skuShelfPositions.skuId))
        .leftJoin(wmsTables.skuFieldCaptures, liveCaptureOf(wmsTables.skus.id))
        .where(and(eq(wmsTables.skuShelfPositions.positionCode, positionCode), eq(wmsTables.skus.isDeleted, false)))
        .orderBy(asc(wmsTables.skus.code), asc(wmsTables.skus.id));
      const skus: FieldCaptureSkuSummaryDto[] = rows.map((r) => ({
        skuId: r.skuId,
        code: r.code,
        name: r.name,
        imageUrl: r.imageUrl,
        completion:
          r.barcodeStatus && r.lastWorkerLabel && r.lastCompletedAt
            ? {
                barcodeStatus: asBarcodeStatus(r.barcodeStatus),
                lastWorkerLabel: r.lastWorkerLabel,
                lastCompletedAt: r.lastCompletedAt.toISOString(),
              }
            : null,
      }));
      return { positionCode, skus };
    }, tx);
  }

  async getDetail(skuId: string, tx?: DbTx): Promise<FieldCaptureDetailDto> {
    return this.dbService.run(async (trx) => {
      const conflictSku = alias(wmsTables.skus, 'conflict_sku');
      const [row] = await trx
        .select({
          skuId: wmsTables.skus.id,
          code: wmsTables.skus.code,
          name: wmsTables.skus.name,
          packageWidthMm: wmsTables.skus.packageWidthMm,
          packageLengthMm: wmsTables.skus.packageLengthMm,
          packageHeightMm: wmsTables.skus.packageHeightMm,
          packageWeightG: wmsTables.skus.packageWeightG,
          positionCode: wmsTables.skuShelfPositions.positionCode,
          imageUrl: wmsTables.skuShelfPositions.imageUrl,
          barcodeStatus: wmsTables.skuFieldCaptures.barcodeStatus,
          scannedBarcode: wmsTables.skuFieldCaptures.scannedBarcode,
          allFacesConfirmed: wmsTables.skuFieldCaptures.allFacesConfirmed,
          lastWorkerLabel: wmsTables.skuFieldCaptures.lastWorkerLabel,
          lastCompletedAt: wmsTables.skuFieldCaptures.lastCompletedAt,
          conflictId: conflictSku.id,
          conflictCode: conflictSku.code,
          conflictName: conflictSku.name,
        })
        .from(wmsTables.skus)
        .leftJoin(wmsTables.skuShelfPositions, eq(wmsTables.skuShelfPositions.skuId, wmsTables.skus.id))
        .leftJoin(wmsTables.skuFieldCaptures, liveCaptureOf(wmsTables.skus.id))
        .leftJoin(conflictSku, eq(conflictSku.id, wmsTables.skuFieldCaptures.barcodeConflictSkuId))
        .where(and(eq(wmsTables.skus.id, skuId), eq(wmsTables.skus.isDeleted, false)));
      if (!row) throw new NotFoundError(`SKU 를 찾을 수 없습니다: ${skuId}`);

      const barcodes = await trx
        .select({ barcode: wmsTables.skuBarcodes.barcode })
        .from(wmsTables.skuBarcodes)
        .where(eq(wmsTables.skuBarcodes.skuId, skuId))
        .orderBy(asc(wmsTables.skuBarcodes.createdAt), asc(wmsTables.skuBarcodes.id));

      const photos = await trx
        .select()
        .from(wmsTables.skuReferencePhotos)
        .where(eq(wmsTables.skuReferencePhotos.skuId, skuId))
        .orderBy(
          asc(wmsTables.skuReferencePhotos.sortOrder),
          asc(wmsTables.skuReferencePhotos.createdAt),
          asc(wmsTables.skuReferencePhotos.id),
        );

      const conflict: BarcodeOwnerDto | null =
        row.conflictId && row.conflictCode && row.conflictName
          ? { skuId: row.conflictId, code: row.conflictCode, name: row.conflictName }
          : null;

      return {
        skuId: row.skuId,
        code: row.code,
        name: row.name,
        imageUrl: row.imageUrl,
        positionCode: row.positionCode,
        packageWidthMm: row.packageWidthMm,
        packageLengthMm: row.packageLengthMm,
        packageHeightMm: row.packageHeightMm,
        packageWeightG: row.packageWeightG,
        barcodes: barcodes.map((b) => b.barcode),
        photos: photos.map((p) => ({
          id: p.id,
          fileId: p.fileId,
          sortOrder: p.sortOrder,
          takenByLabel: p.takenByLabel,
          createdAt: p.createdAt.toISOString(),
        })),
        completion:
          row.barcodeStatus && row.lastWorkerLabel && row.lastCompletedAt && row.allFacesConfirmed !== null
            ? {
                barcodeStatus: asBarcodeStatus(row.barcodeStatus),
                lastWorkerLabel: row.lastWorkerLabel,
                lastCompletedAt: row.lastCompletedAt.toISOString(),
                scannedBarcode: row.scannedBarcode,
                barcodeConflict: conflict,
                allFacesConfirmed: row.allFacesConfirmed,
              }
            : null,
      };
    }, tx);
  }

  async findBarcodeOwner(barcode: string, tx?: DbTx): Promise<BarcodeOwnerDto | null> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select({ skuId: wmsTables.skus.id, code: wmsTables.skus.code, name: wmsTables.skus.name })
        .from(wmsTables.skuBarcodes)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.skuBarcodes.skuId))
        .where(eq(wmsTables.skuBarcodes.barcode, barcode.trim()));
      return row ?? null;
    }, tx);
  }

  async countWorkerToday(workerId: string, tx?: DbTx): Promise<number> {
    return this.dbService.run(async (trx) => {
      const ev = wmsTables.skuFieldCaptureEvents;
      const [row] = await trx
        .select({ n: sql<number>`count(distinct ${ev.skuId})`.mapWith(Number) })
        .from(ev)
        .where(and(eq(ev.workerId, workerId), isNull(ev.cancelledAt), completedTodayKst(ev.completedAt)));
      return row?.n ?? 0;
    }, tx);
  }

  /**
   * 작업 기록 목록, 최근 완료순. mine 은 내 완료 이벤트 기준(완료 시각 = 그 기간에 내가 마지막으로 끝낸 때),
   * all 은 모든 작업자의 현재 완료 기준(완료 시각 = 누군가 마지막으로 끝낸 때).
   */
  async listItems(filter: FieldCaptureListFilter, workerId: string, tx?: DbTx): Promise<MyCaptureItemDto[]> {
    const { who, from, to, q } = filter;
    return this.dbService.run(async (trx) => {
      const ev = wmsTables.skuFieldCaptureEvents;
      const cap = wmsTables.skuFieldCaptures;
      const mine = trx
        .select({ skuId: ev.skuId, completedAt: max(ev.completedAt).as('completed_at') })
        .from(ev)
        .where(
          and(
            eq(ev.workerId, workerId),
            isNull(ev.cancelledAt),
            completedBetweenKst(ev.completedAt, from, to),
          ),
        )
        .groupBy(ev.skuId)
        .as('mine');
      const base = {
        skuId: wmsTables.skus.id,
        code: wmsTables.skus.code,
        name: wmsTables.skus.name,
        imageUrl: wmsTables.skuShelfPositions.imageUrl,
        positionCode: wmsTables.skuShelfPositions.positionCode,
        packageWidthMm: wmsTables.skus.packageWidthMm,
        packageLengthMm: wmsTables.skus.packageLengthMm,
        packageHeightMm: wmsTables.skus.packageHeightMm,
        barcodeStatus: cap.barcodeStatus,
        lastWorkerId: cap.lastWorkerId,
        lastWorkerLabel: cap.lastWorkerLabel,
        lastCompletedAt: cap.lastCompletedAt,
      };
      const search = q
        ? or(
            ilike(wmsTables.skus.name, likeContains(q)),
            ilike(wmsTables.skus.code, likeContains(q)),
            ilike(wmsTables.skuShelfPositions.positionCode, likeContains(q)),
          )
        : undefined;
      // ponytail: 한 번에 최근 500개. 넘기면 페이지를 단다
      const rows =
        who === 'all'
          ? await trx
              .select({ ...base, completedAt: cap.lastCompletedAt })
              .from(cap)
              .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, cap.skuId))
              .leftJoin(wmsTables.skuShelfPositions, eq(wmsTables.skuShelfPositions.skuId, wmsTables.skus.id))
              .where(
                and(
                  isNull(cap.deletedAt),
                  eq(wmsTables.skus.isDeleted, false),
                  completedBetweenKst(cap.lastCompletedAt, from, to),
                  search,
                ),
              )
              .orderBy(desc(cap.lastCompletedAt), asc(wmsTables.skus.id))
              .limit(500)
          : await trx
              .select({ ...base, completedAt: mine.completedAt })
              .from(mine)
              .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, mine.skuId))
              .leftJoin(wmsTables.skuShelfPositions, eq(wmsTables.skuShelfPositions.skuId, wmsTables.skus.id))
              .innerJoin(cap, liveCaptureOf(wmsTables.skus.id))
              .where(and(eq(wmsTables.skus.isDeleted, false), search))
              .orderBy(desc(mine.completedAt), asc(wmsTables.skus.id))
              .limit(500);
      return rows.flatMap((r) =>
        r.completedAt && r.barcodeStatus && r.lastWorkerId && r.lastWorkerLabel && r.lastCompletedAt
          ? [
              {
                skuId: r.skuId,
                code: r.code,
                name: r.name,
                imageUrl: r.imageUrl,
                positionCode: r.positionCode,
                completedAt: r.completedAt.toISOString(),
                lastCompletedAt: r.lastCompletedAt.toISOString(),
                lastWorkerLabel: r.lastWorkerLabel,
                packageWidthMm: r.packageWidthMm,
                packageLengthMm: r.packageLengthMm,
                packageHeightMm: r.packageHeightMm,
                barcodeStatus: asBarcodeStatus(r.barcodeStatus),
                canCancel: r.lastWorkerId === workerId,
              },
            ]
          : [],
      );
    }, tx);
  }

  async getProgress(tx?: DbTx): Promise<FieldCaptureProgressDto> {
    return this.dbService.run(async (trx) => {
      const stocked = trx
        .select({ skuId: wmsTables.stockLedgers.skuId })
        .from(wmsTables.stockLedgers)
        .where(eq(wmsTables.stockLedgers.stockState, 'ON_HAND'))
        .groupBy(wmsTables.stockLedgers.skuId)
        .having(gt(sql`sum(${wmsTables.stockLedgers.qty})`, 0));
      const captured = trx
        .select({ skuId: wmsTables.skuFieldCaptures.skuId })
        .from(wmsTables.skuFieldCaptures)
        .where(isNull(wmsTables.skuFieldCaptures.deletedAt));

      const [remaining] = await trx
        .select({ n: count() })
        .from(wmsTables.skus)
        .where(
          and(
            eq(wmsTables.skus.isDeleted, false),
            inArray(wmsTables.skus.id, stocked),
            notInArray(wmsTables.skus.id, captured),
          ),
        );

      const [totals] = await trx
        .select({
          completed: count(),
          sticker: sql<number>`count(*) filter (where ${wmsTables.skuFieldCaptures.barcodeStatus} = 'none')`.mapWith(
            Number,
          ),
        })
        .from(wmsTables.skuFieldCaptures)
        .where(isNull(wmsTables.skuFieldCaptures.deletedAt));

      const [conflicts] = await trx
        .select({ n: count() })
        .from(wmsTables.skuFieldCaptures)
        .where(
          and(
            isNotNull(wmsTables.skuFieldCaptures.barcodeConflictSkuId),
            isNull(wmsTables.skuFieldCaptures.deletedAt),
          ),
        );

      const ev = wmsTables.skuFieldCaptureEvents;
      const workers = await trx
        .select({
          workerId: ev.workerId,
          workerLabel: sql<string>`(array_agg(${ev.workerLabel} order by ${ev.completedAt} desc, ${ev.id} desc))[1]`,
          today:
            sql<number>`count(distinct ${ev.skuId}) filter (where ${completedTodayKst(ev.completedAt)})`.mapWith(
              Number,
            ),
          total: sql<number>`count(distinct ${ev.skuId})`.mapWith(Number),
        })
        .from(ev)
        .where(isNull(ev.cancelledAt))
        .groupBy(ev.workerId)
        .orderBy(desc(sql`count(distinct ${ev.skuId})`), asc(ev.workerId));

      return {
        remainingSkus: remaining?.n ?? 0,
        completedSkus: totals?.completed ?? 0,
        stickerNeededSkus: totals?.sticker ?? 0,
        barcodeConflictSkus: conflicts?.n ?? 0,
        workers,
      };
    }, tx);
  }
}
