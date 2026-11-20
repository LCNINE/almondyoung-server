import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  min,
  notInArray,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import { alias, AnyPgColumn, union } from 'drizzle-orm/pg-core';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { normalizePositionCode } from '../position-code';
import {
  FieldCaptureBarcodeStatus,
  FieldCaptureListFilter,
  FieldCapturePhotoFilter,
  FIELD_CAPTURE_EXCLUDED_ROWS,
  likeContains,
  summarizeRemaining,
} from '../sku-field-capture.rules';
import {
  BarcodeOwnerDto,
  FieldCaptureDetailDto,
  FieldCapturePhotosDto,
  FieldCaptureProgressDto,
  FieldCaptureRemainingDto,
  FieldCaptureSkuSummaryDto,
  MyCaptureItemsDto,
  ShelfPositionDto,
} from '../dto/sku-field-capture.dto';

/** DB 의 varchar 는 TS 에서 string 이라, CHECK 제약이 보장하는 값 집합으로 좁히는 자리. */
function asBarcodeStatus(raw: string): FieldCaptureBarcodeStatus {
  if (raw === 'scanned' || raw === 'no_manufacturer' || raw === 'none') return raw;
  throw new Error(`unexpected barcode_status: ${raw}`);
}

const PHOTO_PAGE_SIZE = 200;
const ITEM_PAGE_SIZE = 200;

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

/**
 * SKU 의 위치 (#1237). 원장이 먼저다 — ON_HAND 재고가 실제 선반(standard) 로케이션에 있으면 그 로케이션 코드(여럿일 수
 * 있다)가 위치이고, 셀메이트 «상품위치»(sku_shelf_positions)는 그런 재고가 하나도 없는 SKU 에만 쓴다.
 * 시스템·zone 로케이션(입고기본존 등)은 위치가 아니다 — 셀메이트 sync 가 재고를 전부 입고기본존에 두기 때문이다.
 * 실제 로케이션 기준은 컷오버 적치 스크립트(scripts/sellmate/move-stock-to-shelf.ts)와 같다.
 * 송장 위치(waybill/label/label-items.ts)는 «배정된 로케이션»이 기준이라 이 규칙과 따로다.
 */
const sl = wmsTables.stockLedgers;
const loc = wmsTables.locations;
const shelf = wmsTables.skuShelfPositions;
const shelfStock = and(eq(sl.stockState, 'ON_HAND'), gt(sl.qty, 0), eq(loc.locationType, 'standard'));

/** 원장 선반 재고가 있는 SKU — 조건을 더 붙여 상관 없는 IN 으로 쓴다. */
const ledgerShelfSkus = (trx: DbTx, where?: SQL) =>
  trx.select({ skuId: sl.skuId }).from(sl).innerJoin(loc, eq(loc.id, sl.locationId)).where(and(shelfStock, where));

/**
 * SKU 마다 원장 선반 코드 중 가장 앞의 것. 한 번 묶어 SKU 에 left join 한다 — 행마다 상관 서브쿼리로 물으면 플래너가
 * 로케이션을 매번 훑어 목록 검색이 5배 느려졌다(라이브 실측, PR #1466).
 */
const ledgerPositionsOf = (trx: DbTx) =>
  trx
    .select({ skuId: sl.skuId, code: min(loc.code).as('ledger_code') })
    .from(sl)
    .innerJoin(loc, eq(loc.id, sl.locationId))
    .where(shelfStock)
    .groupBy(sl.skuId)
    .as('ledger_pos');
type LedgerPositions = ReturnType<typeof ledgerPositionsOf>;

/** 화면에 찍을 위치 하나 — 원장 선반 코드, 없으면 셀메이트 위치. `lp`·`shelf` 가 left join 돼 있어야 한다. */
const positionOf = (lp: LedgerPositions) => sql<string | null>`coalesce(${lp.code}, ${shelf.positionCode})`;

/** 위치 검색 — 원장 선반 코드 어느 것이든, 원장 선반 재고가 없으면 셀메이트 위치. `lp`·`shelf` 가 left join 돼 있어야 한다. */
const positionLike = (trx: DbTx, lp: LedgerPositions, pattern: string) =>
  or(
    inArray(wmsTables.skus.id, ledgerShelfSkus(trx, ilike(loc.code, pattern))),
    and(ilike(shelf.positionCode, pattern), isNull(lp.skuId)),
  );

@Injectable()
export class SkuFieldCaptureReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async findByPosition(rawCode: string, tx?: DbTx): Promise<ShelfPositionDto> {
    const positionCode = normalizePositionCode(rawCode);
    return this.dbService.run(async (trx) => {
      // 후보를 이 코드에서 먼저 뽑는다(로케이션 코드·셀메이트 위치 인덱스) — SKU 전체에 EXISTS 를 돌리지 않게.
      const atCode = union(
        ledgerShelfSkus(trx, sql`upper(${loc.code}) = ${positionCode}`),
        trx
          .select({ skuId: shelf.skuId })
          .from(shelf)
          .where(and(eq(shelf.positionCode, positionCode), notInArray(shelf.skuId, ledgerShelfSkus(trx)))),
      );
      const rows = await trx
        .select({
          skuId: wmsTables.skus.id,
          code: wmsTables.skus.code,
          name: wmsTables.skus.name,
          imageUrl: shelf.imageUrl,
          barcodeStatus: wmsTables.skuFieldCaptures.barcodeStatus,
          lastWorkerLabel: wmsTables.skuFieldCaptures.lastWorkerLabel,
          lastCompletedAt: wmsTables.skuFieldCaptures.lastCompletedAt,
        })
        .from(wmsTables.skus)
        .leftJoin(shelf, eq(shelf.skuId, wmsTables.skus.id))
        .leftJoin(wmsTables.skuFieldCaptures, liveCaptureOf(wmsTables.skus.id))
        .where(and(inArray(wmsTables.skus.id, atCode), eq(wmsTables.skus.isDeleted, false)))
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
      const lp = ledgerPositionsOf(trx);
      const [row] = await trx
        .select({
          skuId: wmsTables.skus.id,
          code: wmsTables.skus.code,
          name: wmsTables.skus.name,
          packageWidthMm: wmsTables.skus.packageWidthMm,
          packageLengthMm: wmsTables.skus.packageLengthMm,
          packageHeightMm: wmsTables.skus.packageHeightMm,
          packageWeightG: wmsTables.skus.packageWeightG,
          positionCode: positionOf(lp),
          imageUrl: shelf.imageUrl,
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
        .leftJoin(shelf, eq(shelf.skuId, wmsTables.skus.id))
        .leftJoin(lp, eq(lp.skuId, wmsTables.skus.id))
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
  async listItems(filter: FieldCaptureListFilter, workerId: string, tx?: DbTx): Promise<MyCaptureItemsDto> {
    const { who, from, to, q, offset = 0 } = filter;
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
      const lp = ledgerPositionsOf(trx);
      const base = {
        skuId: wmsTables.skus.id,
        code: wmsTables.skus.code,
        name: wmsTables.skus.name,
        imageUrl: shelf.imageUrl,
        positionCode: positionOf(lp),
        packageWidthMm: wmsTables.skus.packageWidthMm,
        packageLengthMm: wmsTables.skus.packageLengthMm,
        packageHeightMm: wmsTables.skus.packageHeightMm,
        barcodeStatus: cap.barcodeStatus,
        lastWorkerId: cap.lastWorkerId,
        lastWorkerLabel: cap.lastWorkerLabel,
        lastCompletedAt: cap.lastCompletedAt,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      };
      const search = q
        ? or(
            ilike(wmsTables.skus.name, likeContains(q)),
            ilike(wmsTables.skus.code, likeContains(q)),
            positionLike(trx, lp, likeContains(q)),
          )
        : undefined;
      // ponytail: offset 페이지 — 넘기는 사이 새로 끝낸 상품이 생기면 한 줄 겹친다. 화면이 skuId 로 거른다
      const rows =
        who === 'all'
          ? await trx
              .select({ ...base, completedAt: cap.lastCompletedAt })
              .from(cap)
              .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, cap.skuId))
              .leftJoin(shelf, eq(shelf.skuId, wmsTables.skus.id))
              .leftJoin(lp, eq(lp.skuId, wmsTables.skus.id))
              .where(
                and(
                  isNull(cap.deletedAt),
                  eq(wmsTables.skus.isDeleted, false),
                  completedBetweenKst(cap.lastCompletedAt, from, to),
                  search,
                ),
              )
              .orderBy(desc(cap.lastCompletedAt), asc(wmsTables.skus.id))
              .limit(ITEM_PAGE_SIZE)
              .offset(offset)
          : await trx
              .select({ ...base, completedAt: mine.completedAt })
              .from(mine)
              .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, mine.skuId))
              .leftJoin(shelf, eq(shelf.skuId, wmsTables.skus.id))
              .leftJoin(lp, eq(lp.skuId, wmsTables.skus.id))
              .innerJoin(cap, liveCaptureOf(wmsTables.skus.id))
              .where(and(eq(wmsTables.skus.isDeleted, false), search))
              .orderBy(desc(mine.completedAt), asc(wmsTables.skus.id))
              .limit(ITEM_PAGE_SIZE)
              .offset(offset);
      const total = rows[0]?.total ?? 0;
      const items = rows.flatMap((r) =>
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
      const fetched = offset + rows.length;

      return { items, total, nextOffset: fetched < total ? fetched : null };
    }, tx);
  }

  /** 찍힌 사진 전체, 최근순 — 어떤 선반·상품을 누가 찍었는지. 기간(KST)·상품명·코드·선반·작업자로 거른다. */
  async listPhotos(filter: FieldCapturePhotoFilter, tx?: DbTx): Promise<FieldCapturePhotosDto> {
    const { from, to, q, before } = filter;
    return this.dbService.run(async (trx) => {
      const ph = wmsTables.skuReferencePhotos;
      const cur = alias(ph, 'cur');
      // 커서는 사진 id — 시각은 DB 의 마이크로초 그대로 비교해야 같은 밀리초에 찍힌 사진이 빠지지 않는다
      const after = before
        ? sql`(${ph.createdAt}, ${ph.id}) < (${trx
            .select({ createdAt: cur.createdAt, id: cur.id })
            .from(cur)
            .where(eq(cur.id, before))})`
        : undefined;
      const lp = ledgerPositionsOf(trx);
      const rows = await trx
        .select({
          id: ph.id,
          fileId: ph.fileId,
          takenByLabel: ph.takenByLabel,
          createdAt: ph.createdAt,
          skuId: wmsTables.skus.id,
          code: wmsTables.skus.code,
          name: wmsTables.skus.name,
          positionCode: positionOf(lp),
          packageWidthMm: wmsTables.skus.packageWidthMm,
          packageLengthMm: wmsTables.skus.packageLengthMm,
          packageHeightMm: wmsTables.skus.packageHeightMm,
          packageWeightG: wmsTables.skus.packageWeightG,
        })
        .from(ph)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, ph.skuId))
        .leftJoin(shelf, eq(shelf.skuId, wmsTables.skus.id))
        .leftJoin(lp, eq(lp.skuId, wmsTables.skus.id))
        .where(
          and(
            eq(wmsTables.skus.isDeleted, false),
            completedBetweenKst(ph.createdAt, from, to),
            after,
            q
              ? or(
                  ilike(wmsTables.skus.name, likeContains(q)),
                  ilike(wmsTables.skus.code, likeContains(q)),
                  positionLike(trx, lp, likeContains(q)),
                  ilike(ph.takenByLabel, likeContains(q)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(ph.createdAt), desc(ph.id))
        .limit(PHOTO_PAGE_SIZE + 1);
      const page = rows.slice(0, PHOTO_PAGE_SIZE);
      return {
        photos: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        nextCursor: rows.length > PHOTO_PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
      };
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
          and(isNotNull(wmsTables.skuFieldCaptures.barcodeConflictSkuId), isNull(wmsTables.skuFieldCaptures.deletedAt)),
        );

      const ev = wmsTables.skuFieldCaptureEvents;
      const workers = await trx
        .select({
          workerId: ev.workerId,
          workerLabel: sql<string>`(array_agg(${ev.workerLabel} order by ${ev.completedAt} desc, ${ev.id} desc))[1]`,
          today: sql<number>`count(distinct ${ev.skuId}) filter (where ${completedTodayKst(ev.completedAt)})`.mapWith(
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

  /** 남은 선반 — 미완료 기준은 getProgress 의 remaining, 위치는 positionOf 와 같다. 완료는 재고가 없어도 줄 요약에 센다. */
  async getRemaining(tx?: DbTx): Promise<FieldCaptureRemainingDto> {
    return this.dbService.run(async (trx) => {
      const lp = ledgerPositionsOf(trx);
      const stocked = trx
        .select({ skuId: sl.skuId, qty: sql<number>`sum(${sl.qty})::int`.as('stocked_qty') })
        .from(sl)
        .where(eq(sl.stockState, 'ON_HAND'))
        .groupBy(sl.skuId)
        .having(gt(sql`sum(${sl.qty})`, 0))
        .as('stocked');
      const capture = wmsTables.skuFieldCaptures;

      const sources = await trx
        .select({
          skuId: wmsTables.skus.id,
          code: wmsTables.skus.code,
          name: wmsTables.skus.name,
          positionCode: sql<string | null>`upper(${positionOf(lp)})`,
          qty: sql<number>`coalesce(${stocked.qty}, 0)`.mapWith(Number),
          captured: sql<boolean>`${capture.skuId} is not null`,
        })
        .from(wmsTables.skus)
        .leftJoin(shelf, eq(shelf.skuId, wmsTables.skus.id))
        .leftJoin(lp, eq(lp.skuId, wmsTables.skus.id))
        .leftJoin(stocked, eq(stocked.skuId, wmsTables.skus.id))
        .leftJoin(capture, liveCaptureOf(wmsTables.skus.id))
        .where(and(eq(wmsTables.skus.isDeleted, false), or(isNotNull(stocked.skuId), isNotNull(capture.skuId))));

      return { ...summarizeRemaining(sources), excludedRows: [...FIELD_CAPTURE_EXCLUDED_ROWS] };
    }, tx);
  }
}
