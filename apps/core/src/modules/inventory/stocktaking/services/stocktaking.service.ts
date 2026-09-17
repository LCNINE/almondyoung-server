import { CompleteSessionDto } from '../dto/complete-session.dto';
import { stocktakingPreviewToken, ReviewedCount } from './stocktaking-preview-token';
import { ResetCountDto } from '../dto/reset-count.dto';
import { StocktakingConflict } from './stocktaking-conflict';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { acquireStockAvailabilityLocks } from '../../shared/locks/stock-availability-lock';
import { readWarehouseReservationBalance } from '../../shared/locks/reservation-invariant';
import { count, desc, eq, and, gte, lte, sql } from 'drizzle-orm';
import { CreateStocktakingSessionDto } from '../dto/create-session.dto';
import { ListStocktakingSessionsQueryDto } from '../dto/list-sessions-query.dto';
import { ScanLocationDto } from '../dto/scan-location.dto';
import { ScanProductDto } from '../dto/scan-product.dto';
import { UpdateCountDto } from '../dto/update-count.dto';
import { GenerateAdjustmentsDto } from '../dto/generate-adjustments.dto';
import { StocktakingSessionDetailDto } from '../dto/session-detail.dto';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { AdjustmentPreviewItem } from '../dto/adjustment-preview.dto';
import { AddCountItemDto } from '../dto/add-count-item.dto';

@Injectable()
export class StocktakingService {
  private readonly logger = new Logger(StocktakingService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commandService: InventoryCommandService,
  ) {}

  async listSessions(query: ListStocktakingSessionsQueryDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions } = wmsTables;
      const { warehouseId, status, startDate, endDate, page = 1, limit = 20 } = query;
      const offset = (page - 1) * limit;

      const conditions = [
        warehouseId ? eq(stocktakingSessions.warehouseId, warehouseId) : undefined,
        status ? eq(stocktakingSessions.status, status) : undefined,
        startDate ? gte(stocktakingSessions.createdAt, new Date(startDate)) : undefined,
        endDate ? lte(stocktakingSessions.createdAt, new Date(new Date(endDate).setHours(23, 59, 59, 999))) : undefined,
      ].filter(Boolean);

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalResult, items] = await Promise.all([
        tx.select({ count: count() }).from(stocktakingSessions).where(where),
        tx
          .select()
          .from(stocktakingSessions)
          .where(where)
          .orderBy(desc(stocktakingSessions.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { total: Number(totalResult[0]?.count ?? 0), page, limit, data: items };
    }, tx);
  }

  /**
   * Create new stocktaking session
   */
  async createSession(dto: CreateStocktakingSessionDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions } = wmsTables;

      const result = await tx
        .insert(stocktakingSessions)
        .values({
          warehouseId: dto.warehouseId,
          sessionName: dto.sessionName,
          notes: dto.notes,
          status: 'draft',
        })
        .returning();

      return result[0];
    }, tx);
  }

  /**
   * Start stocktaking session
   */
  async startSession(sessionId: string, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions } = wmsTables;

      const session = await tx.select().from(stocktakingSessions).where(eq(stocktakingSessions.id, sessionId)).limit(1);

      if (!session[0]) {
        throw new NotFoundException(`Session ${sessionId} not found`);
      }

      if (session[0].status !== 'draft') {
        throw new BadRequestException(`Session already started`);
      }

      await tx
        .update(stocktakingSessions)
        .set({
          status: 'in_progress',
          revision: sql`${stocktakingSessions.revision} + 1`,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stocktakingSessions.id, sessionId));

      return { sessionId, status: 'in_progress', message: '재고 실사를 시작했습니다.' };
    }, tx);
  }

  /**
   * Scan location barcode and load expected inventory
   */
  async scanLocation(dto: ScanLocationDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { locations, stockLedgers, skus, stocktakingLines } = wmsTables;

      const session = await this.assertInProgress(tx, dto.sessionId);

      // Find location by barcode/code
      const location = await tx.select().from(locations).where(eq(locations.code, dto.locationBarcode)).limit(1);

      if (!location[0]) {
        throw new NotFoundException(`Location ${dto.locationBarcode} not found`);
      }

      await this.assertLocation(tx, location[0].id, session.warehouseId);

      // Get current stock at this location (ON_HAND only)
      const stockAtLocation = await tx
        .select({
          skuId: stockLedgers.skuId,
          expectedQty: stockLedgers.qty,
          skuName: skus.name,
          skuCode: skus.code,
          primaryBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes 
                      WHERE sku_id = ${skus.id} AND is_primary = true 
                      LIMIT 1
                    )`,
        })
        .from(stockLedgers)
        .innerJoin(skus, eq(stockLedgers.skuId, skus.id))
        .where(
          and(
            eq(stockLedgers.locationId, location[0].id),
            eq(stockLedgers.stockState, 'ON_HAND'),
            sql`${stockLedgers.qty} > 0`,
          ),
        );

      // Create stocktaking lines for each SKU at location
      const linesToCreate = stockAtLocation.map((item) => ({
        sessionId: dto.sessionId,
        skuId: item.skuId,
        locationId: location[0].id,
        expectedQuantity: item.expectedQty,
        status: 'pending',
      }));

      if (linesToCreate.length > 0) {
        const added = await tx
          .insert(stocktakingLines)
          .values(linesToCreate)
          .onConflictDoNothing()
          .returning({ id: stocktakingLines.id });
        if (added.length) session.revision = await this.bumpSession(tx, session.id);
      }

      // insert 결과가 아니라 재조회로 응답을 만든다 — onConflictDoNothing 은 기존 라인을
      // 돌려주지 않고, scanProduct 로 만들어진 미기대 라인도 화면에 보여야 하기 때문이다.
      const lines = await tx
        .select({
          lineId: stocktakingLines.id,
          lineRevision: stocktakingLines.revision,
          countBaselineVersion: stocktakingLines.countBaselineVersion,
          skuId: stocktakingLines.skuId,
          skuName: skus.name,
          skuCode: skus.code,
          barcode: sql<string | null>`(
            SELECT barcode FROM sku_barcodes
            WHERE sku_id = ${skus.id} AND is_primary = true
            LIMIT 1
          )`,
          expectedQuantity: stocktakingLines.expectedQuantity,
          countedQuantity: stocktakingLines.countedQuantity,
          status: stocktakingLines.status,
        })
        .from(stocktakingLines)
        .innerJoin(skus, eq(stocktakingLines.skuId, skus.id))
        .where(and(eq(stocktakingLines.sessionId, dto.sessionId), eq(stocktakingLines.locationId, location[0].id)))
        .orderBy(skus.code);

      return {
        locationId: location[0].id,
        locationCode: location[0].code,
        sessionRevision: session.revision,
        expectedItems: lines,
      };
    }, tx);
  }

  /**
   * Scan product barcode during counting
   */
  async scanProduct(dto: ScanProductDto, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const session = await this.assertInProgress(trx, dto.sessionId);
      await this.assertLocation(trx, dto.locationId, session.warehouseId);
      const [barcode] = await trx
        .select({ skuId: wmsTables.skuBarcodes.skuId })
        .from(wmsTables.skuBarcodes)
        .where(eq(wmsTables.skuBarcodes.barcode, dto.productBarcode))
        .limit(1);
      if (!barcode) throw new NotFoundException('등록되지 않은 바코드예요.');
      await acquireStockAvailabilityLocks(trx, [{ skuId: barcode.skuId, warehouseId: session.warehouseId }]);
      const ledger = await this.readLedger(trx, barcode.skuId, session.warehouseId, dto.locationId);
      const [existing] = await trx
        .select()
        .from(wmsTables.stocktakingLines)
        .where(
          and(
            eq(wmsTables.stocktakingLines.sessionId, dto.sessionId),
            eq(wmsTables.stocktakingLines.skuId, barcode.skuId),
            eq(wmsTables.stocktakingLines.locationId, dto.locationId),
          ),
        )
        .for('update');
      const baseline = existing ? this.countBaseline(existing, ledger.version) : ledger.version;
      const quantity = (existing?.countedQuantity ?? 0) + (dto.quantity ?? 1);
      if (!Number.isSafeInteger(quantity) || (dto.quantity ?? 1) < 1)
        throw new BadRequestException('수량이 올바르지 않아요.');
      const expectedQuantity = existing?.expectedQuantity ?? ledger.qty;
      const values = {
        countedQuantity: quantity,
        variance: quantity - expectedQuantity,
        countBaselineVersion: baseline,
        scannedBarcode: dto.productBarcode,
        countedAt: new Date(),
        updatedAt: new Date(),
        status: 'counted',
      };
      const [line] = existing
        ? await trx
            .update(wmsTables.stocktakingLines)
            .set({ ...values, revision: existing.revision + 1 })
            .where(eq(wmsTables.stocktakingLines.id, existing.id))
            .returning()
        : await trx
            .insert(wmsTables.stocktakingLines)
            .values({
              ...values,
              expectedQuantity,
              sessionId: dto.sessionId,
              skuId: barcode.skuId,
              locationId: dto.locationId,
            })
            .returning();
      const sessionRevision = await this.bumpSession(trx, session.id);
      return this.countResponse(line, sessionRevision);
    }, tx);
  }

  async addCountItem(dto: AddCountItemDto, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const session = await this.assertInProgress(trx, dto.sessionId);
      await this.assertLocation(trx, dto.locationId, session.warehouseId);
      await acquireStockAvailabilityLocks(trx, [{ skuId: dto.skuId, warehouseId: session.warehouseId }]);

      const [sku] = await trx
        .select({ id: wmsTables.skus.id })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, dto.skuId))
        .limit(1);
      if (!sku) throw new NotFoundException('상품을 찾을 수 없어요.');

      const [existing] = await trx
        .select({ id: wmsTables.stocktakingLines.id })
        .from(wmsTables.stocktakingLines)
        .where(
          and(
            eq(wmsTables.stocktakingLines.sessionId, dto.sessionId),
            eq(wmsTables.stocktakingLines.skuId, dto.skuId),
            eq(wmsTables.stocktakingLines.locationId, dto.locationId),
          ),
        )
        .for('update');
      if (existing) throw new StocktakingConflict('STOCKTAKING_REVISION_CONFLICT');

      const ledger = await this.readLedger(trx, dto.skuId, session.warehouseId, dto.locationId);
      const now = new Date();
      const [line] = await trx
        .insert(wmsTables.stocktakingLines)
        .values({
          sessionId: dto.sessionId,
          locationId: dto.locationId,
          skuId: dto.skuId,
          countedQuantity: dto.countedQuantity,
          expectedQuantity: ledger.qty,
          variance: dto.countedQuantity - ledger.qty,
          countBaselineVersion: ledger.version,
          status: 'counted',
          countedAt: now,
          updatedAt: now,
        })
        .returning();
      return this.countResponse(line, await this.bumpSession(trx, session.id));
    }, tx);
  }

  async updateCount(lineId: string, dto: UpdateCountDto, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const { session, line, ledger } = await this.lockCountLine(trx, lineId);
      if (dto.contractVersion === 2 && dto.expectedRevision !== line.revision)
        throw new StocktakingConflict('STOCKTAKING_REVISION_CONFLICT');
      const baseline = this.countBaseline(line, ledger.version);
      if (!Number.isSafeInteger(dto.countedQuantity) || dto.countedQuantity < 0)
        throw new BadRequestException('수량이 올바르지 않아요.');
      const [updated] = await trx
        .update(wmsTables.stocktakingLines)
        .set({
          countedQuantity: dto.countedQuantity,
          variance: dto.countedQuantity - line.expectedQuantity,
          notes: dto.notes,
          countBaselineVersion: baseline,
          revision: line.revision + 1,
          countedAt: new Date(),
          updatedAt: new Date(),
          status: 'counted',
        })
        .where(eq(wmsTables.stocktakingLines.id, line.id))
        .returning();
      return this.countResponse(updated, await this.bumpSession(trx, session.id));
    }, tx);
  }

  async resetCount(lineId: string, dto: ResetCountDto, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const { session, line, ledger } = await this.lockCountLine(trx, lineId);
      if (dto.expectedRevision !== line.revision) throw new StocktakingConflict('STOCKTAKING_REVISION_CONFLICT');
      const [updated] = await trx
        .update(wmsTables.stocktakingLines)
        .set({
          countedQuantity: null,
          variance: null,
          countedAt: null,
          scannedBarcode: null,
          status: 'pending',
          expectedQuantity: ledger.qty,
          countBaselineVersion: ledger.version,
          revision: line.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.stocktakingLines.id, line.id))
        .returning();
      return this.countResponse(updated, await this.bumpSession(trx, session.id));
    }, tx);
  }

  private countBaseline(line: typeof wmsTables.stocktakingLines.$inferSelect, currentVersion: number): number {
    if (line.countBaselineVersion === null) {
      if (line.countedQuantity !== null) throw new StocktakingConflict('STOCKTAKING_RECOUNT_REQUIRED');
      return currentVersion;
    }
    if (line.countBaselineVersion !== currentVersion) throw new StocktakingConflict('STOCKTAKING_RECOUNT_REQUIRED');
    return line.countBaselineVersion;
  }

  private countResponse(line: typeof wmsTables.stocktakingLines.$inferSelect, sessionRevision: number) {
    return {
      lineId: line.id,
      skuId: line.skuId,
      countedQuantity: line.countedQuantity,
      expectedQuantity: line.expectedQuantity,
      variance: line.variance,
      lineRevision: line.revision,
      sessionRevision,
      countBaselineVersion: line.countBaselineVersion,
    };
  }

  private async bumpSession(tx: DbTx, sessionId: string): Promise<number> {
    const [session] = await tx
      .update(wmsTables.stocktakingSessions)
      .set({
        revision: sql`${wmsTables.stocktakingSessions.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.stocktakingSessions.id, sessionId))
      .returning({ revision: wmsTables.stocktakingSessions.revision });
    return session.revision;
  }

  private async assertLocation(tx: DbTx, locationId: string | null, warehouseId: string): Promise<void> {
    if (locationId === null) return;
    const [location] = await tx
      .select()
      .from(wmsTables.locations)
      .where(eq(wmsTables.locations.id, locationId))
      .limit(1);
    if (!location || location.warehouseId !== warehouseId || !location.isActive)
      throw new BadRequestException('이 창고에서 사용할 수 없는 위치예요.');
  }

  /** Read identity without a row lock, then acquire session -> stock availability -> line locks. */
  private async lockCountLine(tx: DbTx, lineId: string) {
    const [identity] = await tx
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.id, lineId))
      .limit(1);
    if (!identity) throw new NotFoundException('실사 상품을 찾을 수 없어요.');
    const session = await this.assertInProgress(tx, identity.sessionId);
    await this.assertLocation(tx, identity.locationId, session.warehouseId);
    await acquireStockAvailabilityLocks(tx, [{ skuId: identity.skuId, warehouseId: session.warehouseId }]);
    const [line] = await tx
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.id, lineId))
      .for('update');
    if (!line) throw new NotFoundException('실사 상품을 찾을 수 없어요.');
    const ledger = await this.readLedger(tx, line.skuId, session.warehouseId, line.locationId);
    return { session, line, ledger };
  }

  private async readLedger(tx: DbTx, skuId: string, warehouseId: string, locationId: string | null) {
    const [ledger] = await tx
      .select({ qty: wmsTables.stockLedgers.qty, version: wmsTables.stockLedgers.version })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          locationId
            ? eq(wmsTables.stockLedgers.locationId, locationId)
            : sql`${wmsTables.stockLedgers.locationId} IS NULL`,
        ),
      )
      .limit(1);
    return ledger ?? { qty: 0, version: 0 };
  }

  /**
   * 세션 상세 — 메타 + 전체 라인 + 진행률.
   * getVariances 는 variance != 0 만 주므로 "실사 이어하기"에는 쓸 수 없다.
   */
  async getSession(sessionId: string, tx?: DbTx): Promise<StocktakingSessionDetailDto> {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions, stocktakingLines, skus, locations } = wmsTables;

      const [session] = await tx
        .select()
        .from(stocktakingSessions)
        .where(eq(stocktakingSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundError(`Stocktaking session not found: ${sessionId}`);

      const rows = await tx
        .select({
          lineId: stocktakingLines.id,
          lineRevision: stocktakingLines.revision,
          countBaselineVersion: stocktakingLines.countBaselineVersion,
          skuId: stocktakingLines.skuId,
          skuCode: skus.code,
          skuName: skus.name,
          locationId: stocktakingLines.locationId,
          locationCode: locations.code,
          expectedQuantity: stocktakingLines.expectedQuantity,
          countedQuantity: stocktakingLines.countedQuantity,
          variance: stocktakingLines.variance,
          scannedBarcode: stocktakingLines.scannedBarcode,
          status: stocktakingLines.status,
          notes: stocktakingLines.notes,
        })
        .from(stocktakingLines)
        .innerJoin(skus, eq(stocktakingLines.skuId, skus.id))
        .leftJoin(locations, eq(stocktakingLines.locationId, locations.id))
        .where(eq(stocktakingLines.sessionId, sessionId))
        .orderBy(sql`${locations.code} ASC NULLS LAST`, skus.code);

      return {
        id: session.id,
        sessionRevision: session.revision,
        warehouseId: session.warehouseId,
        sessionName: session.sessionName,
        status: session.status,
        notes: session.notes,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        progress: {
          total: rows.length,
          counted: rows.filter((r) => r.countedQuantity !== null).length,
        },
        lines: rows,
      };
    }, tx);
  }

  /**
   * Get variances (discrepancies)
   */
  async getVariances(sessionId: string, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingLines, skus, locations } = wmsTables;

      const lines = await tx
        .select({
          lineId: stocktakingLines.id,
          lineRevision: stocktakingLines.revision,
          countBaselineVersion: stocktakingLines.countBaselineVersion,
          locationCode: locations.code,
          skuName: skus.name,
          skuCode: skus.code,
          expectedQuantity: stocktakingLines.expectedQuantity,
          countedQuantity: stocktakingLines.countedQuantity,
          variance: stocktakingLines.variance,
        })
        .from(stocktakingLines)
        .innerJoin(skus, eq(stocktakingLines.skuId, skus.id))
        .leftJoin(locations, eq(stocktakingLines.locationId, locations.id))
        .where(
          and(
            eq(stocktakingLines.sessionId, sessionId),
            sql`${stocktakingLines.variance} IS NOT NULL AND ${stocktakingLines.variance} != 0`,
          ),
        );

      return lines.map((line) => ({
        ...line,
        discrepancyPercent: line.expectedQuantity > 0 ? ((line.variance ?? 0) / line.expectedQuantity) * 100 : 0,
      }));
    }, tx);
  }

  /**
   * 미리보기(dry-run): variance 라인의 라이브 delta 를 계산만 한다. 영속 없음.
   * 실제 적용은 completeSession(§5) 에서 원자적으로 수행한다.
   */
  async generateAdjustments(sessionId: string, dto: GenerateAdjustmentsDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      if (dto.contractVersion === 2) {
        // V2 always reviews every registered line; a caller's variance filter is not completion scope.
        const review = await this.reviewCounts(tx, sessionId);
        return {
          adjustmentsCreated: review.preview.length,
          eventsPosted: 0,
          message: '수량을 확인했어요.',
          preview: review.preview,
          previewToken: review.previewToken,
          sessionRevision: review.session.revision,
        };
      }
      const { stocktakingLines, stocktakingSessions } = wmsTables;

      const [session] = await tx
        .select()
        .from(stocktakingSessions)
        .where(eq(stocktakingSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

      const conditions = [
        eq(stocktakingLines.sessionId, sessionId),
        sql`${stocktakingLines.variance} IS NOT NULL AND ${stocktakingLines.variance} != 0`,
        sql`${stocktakingLines.countedQuantity} IS NOT NULL`,
      ];
      if (dto.lineIds && dto.lineIds.length > 0) {
        conditions.push(sql`${stocktakingLines.id} = ANY(${dto.lineIds}::uuid[])`);
      }
      const lines = await tx
        .select()
        .from(stocktakingLines)
        .where(and(...conditions));

      const preview: AdjustmentPreviewItem[] = [];
      for (const line of lines) {
        const counted = line.countedQuantity ?? 0;
        const currentOnHand = await this.computeOnHand(tx, line.skuId, session.warehouseId, line.locationId);
        const delta = counted - currentOnHand;
        if (delta === 0) continue;
        preview.push({
          lineId: line.id,
          skuId: line.skuId,
          locationId: line.locationId,
          countedQuantity: counted,
          currentOnHand,
          delta,
          adjustmentType: delta > 0 ? 'INCREASE' : 'DECREASE',
        });
      }

      return {
        adjustmentsCreated: preview.length, // 하위호환: 적용 예정 수
        eventsPosted: 0, // 미리보기 — 아직 적용 안 됨
        message: `${preview.length}개 조정이 미리보기로 계산되었습니다 (완료 시 적용).`,
        preview,
      };
    }, tx);
  }

  /**
   * 실사 완료 — variance 라인을 원장에 원자 적용(adjustUp/adjustDown, 라이브 delta)하고 세션 종결.
   */
  async completeSession(sessionId: string, tx?: DbTx, dto?: CompleteSessionDto) {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions, stocktakingLines, stocktakingAdjustments } = wmsTables;

      const [session] = await tx
        .select()
        .from(stocktakingSessions)
        .where(eq(stocktakingSessions.id, sessionId))
        .for('update');
      if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
      if (session.status !== 'in_progress') throw new BadRequestException(`Session is not in progress`);

      const review = dto?.contractVersion === 2 ? await this.reviewCounts(tx, sessionId) : undefined;
      if (review && (!dto?.previewToken || dto.previewToken !== review.previewToken))
        throw new StocktakingConflict('STOCKTAKING_PREVIEW_STALE');
      let lines = review?.lines;
      if (!lines) {
        lines = await tx
          .select()
          .from(stocktakingLines)
          .where(
            and(
              eq(stocktakingLines.sessionId, sessionId),
              sql`${stocktakingLines.variance} IS NOT NULL AND ${stocktakingLines.variance} != 0`,
              sql`${stocktakingLines.countedQuantity} IS NOT NULL`,
            ),
          );
        await acquireStockAvailabilityLocks(
          tx,
          lines.map((line) => ({ skuId: line.skuId, warehouseId: session.warehouseId })),
        );
        // Session lock serializes every count mutation; stock locks precede line locks on all paths.
        if (lines.length)
          await tx
            .select({ id: stocktakingLines.id })
            .from(stocktakingLines)
            .where(eq(stocktakingLines.sessionId, sessionId))
            .for('update');
      }

      const reviewedCounts = new Map(review?.reviewed.map((count) => [count.lineId, count]));
      let adjustmentsApplied = 0;
      for (const line of lines) {
        const counted = line.countedQuantity ?? 0;
        const currentOnHand = review
          ? reviewedCounts.get(line.id)!.currentOnHand
          : await this.computeOnHand(tx, line.skuId, session.warehouseId, line.locationId);
        const delta = counted - currentOnHand;

        if (delta !== 0) {
          const idempotencyKey = `stocktaking:${sessionId}:${line.id}`;
          const reason = `stocktaking:${sessionId}`;
          const { eventId } =
            delta > 0
              ? await this.commandService.adjustUp(
                  {
                    skuId: line.skuId,
                    warehouseId: session.warehouseId,
                    locationId: line.locationId,
                    quantity: delta,
                    idempotencyKey,
                    reason,
                  },
                  tx,
                )
              : await this.commandService.adjustDown(
                  {
                    skuId: line.skuId,
                    warehouseId: session.warehouseId,
                    locationId: line.locationId,
                    quantity: -delta,
                    idempotencyKey,
                    reason,
                    bypassReservationGuard: true, // 실사 = 물리적 사실, 실물 우선
                  },
                  tx,
                );

          await tx
            .insert(stocktakingAdjustments)
            .values({
              sessionId,
              lineId: line.id,
              stockEventId: eventId,
              adjustmentQuantity: Math.abs(delta),
              adjustmentType: delta > 0 ? 'INCREASE' : 'DECREASE',
              reason: `Stocktaking adjustment ${delta > 0 ? '+' : ''}${delta} (session ${sessionId})`,
            })
            .onConflictDoNothing({ target: stocktakingAdjustments.lineId });

          if (delta < 0) {
            const bal = await readWarehouseReservationBalance(tx, line.skuId, session.warehouseId);
            if (bal.onHand < bal.reserved) {
              this.logger.warn(
                `실사 하향으로 on_hand<reserved: sku=${line.skuId} wh=${session.warehouseId} on_hand=${bal.onHand} reserved=${bal.reserved} — 대사잡·후속 예약 정리 필요`,
              );
            }
          }

          adjustmentsApplied++;
        }

        await tx
          .update(stocktakingLines)
          .set({ status: 'adjusted', updatedAt: new Date() })
          .where(eq(stocktakingLines.id, line.id));
      }

      const [lineStats] = await tx
        .select({
          total: sql<number>`count(*)`,
          withVariances: sql<number>`count(*) FILTER (WHERE ${stocktakingLines.variance} != 0)`,
        })
        .from(stocktakingLines)
        .where(eq(stocktakingLines.sessionId, sessionId));

      const completedAt = new Date();
      await tx
        .update(stocktakingSessions)
        .set({
          status: 'completed',
          completedAt,
          updatedAt: completedAt,
          revision: sql`${stocktakingSessions.revision} + 1`,
        })
        .where(eq(stocktakingSessions.id, sessionId));

      return {
        sessionId,
        status: 'completed' as const,
        completedAt,
        summary: {
          totalLines: Number(lineStats?.total ?? 0),
          discrepanciesFound: Number(lineStats?.withVariances ?? 0),
          adjustmentsApplied,
        },
      };
    }, tx);
  }

  /** Completion and preview use the same session -> stock -> line lock order and state. */
  private async reviewCounts(tx: DbTx, sessionId: string) {
    const session = await this.assertInProgress(tx, sessionId);
    const identities = await tx
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.sessionId, sessionId));
    await acquireStockAvailabilityLocks(
      tx,
      identities.map((line) => ({ skuId: line.skuId, warehouseId: session.warehouseId })),
    );
    const lines = await tx
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.sessionId, sessionId))
      .orderBy(wmsTables.stocktakingLines.id)
      .for('update');
    const reviewed: ReviewedCount[] = [];
    const preview: AdjustmentPreviewItem[] = [];
    for (const line of lines) {
      if (line.countedQuantity === null) throw new StocktakingConflict('STOCKTAKING_COUNT_REQUIRED');
      await this.assertLocation(tx, line.locationId, session.warehouseId);
      const ledger = await this.readLedger(tx, line.skuId, session.warehouseId, line.locationId);
      const baselineVersion = this.countBaseline(line, ledger.version);
      reviewed.push({
        lineId: line.id,
        lineRevision: line.revision,
        baselineVersion,
        currentLedgerVersion: ledger.version,
        countedQuantity: line.countedQuantity,
        currentOnHand: ledger.qty,
      });
      const delta = line.countedQuantity - ledger.qty;
      if (delta) {
        const sku = await tx.query.skus.findFirst({ where: eq(wmsTables.skus.id, line.skuId) });
        const location = await tx.query.locations.findFirst({ where: eq(wmsTables.locations.id, line.locationId!) });
        preview.push({
          lineId: line.id,
          skuId: line.skuId,
          skuName: sku?.name,
          skuCode: sku?.code,
          locationCode: location?.code,
          locationId: line.locationId,
          countedQuantity: line.countedQuantity,
          currentOnHand: ledger.qty,
          delta,
          adjustmentType: delta > 0 ? 'INCREASE' : 'DECREASE',
        });
      }
    }
    return {
      session,
      lines,
      reviewed,
      preview,
      previewToken: stocktakingPreviewToken(session.id, session.revision, reviewed),
    };
  }

  private async computeOnHand(
    tx: DbTx,
    skuId: string,
    warehouseId: string,
    locationId: string | null,
  ): Promise<number> {
    const { stockLedgers } = wmsTables;
    const [row] = await tx
      .select({ qty: stockLedgers.qty })
      .from(stockLedgers)
      .where(
        and(
          eq(stockLedgers.skuId, skuId),
          eq(stockLedgers.warehouseId, warehouseId),
          locationId ? eq(stockLedgers.locationId, locationId) : sql`${stockLedgers.locationId} IS NULL`,
          eq(stockLedgers.stockState, 'ON_HAND'),
        ),
      )
      .limit(1);
    return row?.qty ?? 0;
  }

  private async assertInProgress(tx: DbTx, sessionId: string) {
    const { stocktakingSessions } = wmsTables;
    const [session] = await tx
      .select()
      .from(stocktakingSessions)
      .where(eq(stocktakingSessions.id, sessionId))
      .limit(1)
      .for('update');
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.status !== 'in_progress') throw new BadRequestException(`Session is not in progress`);
    return session;
  }

  async cancelSession(sessionId: string, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions } = wmsTables;
      const [session] = await tx
        .select()
        .from(stocktakingSessions)
        .where(eq(stocktakingSessions.id, sessionId))
        .for('update');
      if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
      if (session.status === 'completed' || session.status === 'cancelled') {
        throw new BadRequestException(`Session is already ${session.status}`);
      }
      await tx
        .update(stocktakingSessions)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(stocktakingSessions.id, sessionId));
      return { sessionId, status: 'cancelled' as const, message: '재고 실사를 취소했습니다.' };
    }, tx);
  }
}
