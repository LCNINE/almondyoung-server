import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { count, desc, eq, and, gte, lte, sql } from 'drizzle-orm';
import { CreateStocktakingSessionDto } from '../dto/create-session.dto';
import { ListStocktakingSessionsQueryDto } from '../dto/list-sessions-query.dto';
import { ScanLocationDto } from '../dto/scan-location.dto';
import { ScanProductDto } from '../dto/scan-product.dto';
import { UpdateCountDto } from '../dto/update-count.dto';
import { GenerateAdjustmentsDto } from '../dto/generate-adjustments.dto';

@Injectable()
export class StocktakingService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
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

      // Find location by barcode/code
      const location = await tx.select().from(locations).where(eq(locations.code, dto.locationBarcode)).limit(1);

      if (!location[0]) {
        throw new NotFoundException(`Location ${dto.locationBarcode} not found`);
      }

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
        await tx.insert(stocktakingLines).values(linesToCreate);
      }

      return {
        locationId: location[0].id,
        locationCode: location[0].code,
        expectedItems: stockAtLocation.map((item) => ({
          skuId: item.skuId,
          skuName: item.skuName,
          skuCode: item.skuCode,
          barcode: item.primaryBarcode,
          expectedQuantity: item.expectedQty,
        })),
      };
    }, tx);
  }

  /**
   * Scan product barcode during counting
   */
  async scanProduct(dto: ScanProductDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { skus, skuBarcodes, stocktakingLines } = wmsTables;

      // Find SKU by barcode
      const barcodeResult = await tx
        .select({
          skuId: skuBarcodes.skuId,
        })
        .from(skuBarcodes)
        .where(eq(skuBarcodes.barcode, dto.productBarcode))
        .limit(1);

      if (!barcodeResult[0]) {
        throw new NotFoundException(`SKU with barcode ${dto.productBarcode} not found`);
      }

      const sku = await tx.select().from(skus).where(eq(skus.id, barcodeResult[0].skuId)).limit(1);

      if (!sku[0]) {
        throw new NotFoundException(`SKU not found`);
      }

      // Find or create stocktaking line
      const existingLine = await tx
        .select()
        .from(stocktakingLines)
        .where(
          and(
            eq(stocktakingLines.sessionId, dto.sessionId),
            eq(stocktakingLines.skuId, sku[0].id),
            eq(stocktakingLines.locationId, dto.locationId),
          ),
        )
        .limit(1);

      if (existingLine[0]) {
        // Update existing line
        const newCount = (existingLine[0].countedQuantity ?? 0) + (dto.quantity ?? 1);
        const variance = newCount - existingLine[0].expectedQuantity;

        await tx
          .update(stocktakingLines)
          .set({
            countedQuantity: newCount,
            variance,
            scannedBarcode: dto.productBarcode,
            countedAt: new Date(),
            status: 'counted',
            updatedAt: new Date(),
          })
          .where(eq(stocktakingLines.id, existingLine[0].id));

        return {
          lineId: existingLine[0].id,
          skuId: sku[0].id,
          countedQuantity: newCount,
          expectedQuantity: existingLine[0].expectedQuantity,
          variance,
        };
      } else {
        // Create new line (unexpected item)
        const result = await tx
          .insert(stocktakingLines)
          .values({
            sessionId: dto.sessionId,
            skuId: sku[0].id,
            locationId: dto.locationId,
            expectedQuantity: 0,
            countedQuantity: dto.quantity ?? 1,
            variance: dto.quantity ?? 1,
            scannedBarcode: dto.productBarcode,
            countedAt: new Date(),
            status: 'counted',
          })
          .returning();

        return {
          lineId: result[0].id,
          skuId: sku[0].id,
          countedQuantity: dto.quantity ?? 1,
          expectedQuantity: 0,
          variance: dto.quantity ?? 1,
        };
      }
    }, tx);
  }

  /**
   * Update count manually
   */
  async updateCount(lineId: string, dto: UpdateCountDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingLines } = wmsTables;

      const line = await tx.select().from(stocktakingLines).where(eq(stocktakingLines.id, lineId)).limit(1);

      if (!line[0]) {
        throw new NotFoundException(`Line ${lineId} not found`);
      }

      const variance = dto.countedQuantity - line[0].expectedQuantity;

      await tx
        .update(stocktakingLines)
        .set({
          countedQuantity: dto.countedQuantity,
          variance,
          notes: dto.notes,
          countedAt: new Date(),
          status: 'counted',
          updatedAt: new Date(),
        })
        .where(eq(stocktakingLines.id, lineId));

      return {
        lineId,
        countedQuantity: dto.countedQuantity,
        expectedQuantity: line[0].expectedQuantity,
        variance,
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
   * Generate stock adjustments for variances
   */
  async generateAdjustments(sessionId: string, dto: GenerateAdjustmentsDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingLines, stocktakingAdjustments, stockEvents, stocktakingSessions } = wmsTables;

      // Get session info first
      const session = await tx.select().from(stocktakingSessions).where(eq(stocktakingSessions.id, sessionId)).limit(1);

      if (!session[0]) {
        throw new NotFoundException(`Session ${sessionId} not found`);
      }

      // Build filter for lines
      const conditions = [
        eq(stocktakingLines.sessionId, sessionId),
        sql`${stocktakingLines.variance} IS NOT NULL AND ${stocktakingLines.variance} != 0`,
        sql`${stocktakingLines.countedQuantity} IS NOT NULL`,
      ];

      if (dto.lineIds && dto.lineIds.length > 0) {
        conditions.push(sql`${stocktakingLines.id} = ANY(${dto.lineIds}::uuid[])`);
      }

      const linesToAdjust = await tx
        .select()
        .from(stocktakingLines)
        .where(and(...conditions));

      let adjustmentsCreated = 0;
      let eventsPosted = 0;

      for (const line of linesToAdjust) {
        // Create stock event for adjustment
        const eventResult = await tx
          .insert(stockEvents)
          .values({
            skuId: line.skuId,
            toWarehouseId: session[0].warehouseId,
            toLocationId: line.locationId,
            transitionType: line.variance! > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN',
            quantity: Math.abs(line.variance!),
            fromState: line.variance! > 0 ? null : 'ON_HAND',
            toState: line.variance! > 0 ? 'ON_HAND' : null,
            occurredAt: new Date(),
            reason: `Stocktaking adjustment - Session ${sessionId}`,
          })
          .returning();

        // Create adjustment record
        await tx.insert(stocktakingAdjustments).values({
          sessionId,
          lineId: line.id,
          stockEventId: eventResult[0].id,
          adjustmentQuantity: Math.abs(line.variance!),
          adjustmentType: line.variance! > 0 ? 'INCREASE' : 'DECREASE',
          reason: `Variance detected: ${line.variance}`,
        });

        adjustmentsCreated++;
        eventsPosted++;
      }

      return {
        adjustmentsCreated,
        eventsPosted,
        message: `${adjustmentsCreated}개의 조정이 생성되었습니다.`,
      };
    }, tx);
  }

  /**
   * Complete stocktaking session
   */
  async completeSession(sessionId: string, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions, stocktakingLines, stocktakingAdjustments } = wmsTables;

      const session = await tx.select().from(stocktakingSessions).where(eq(stocktakingSessions.id, sessionId)).limit(1);

      if (!session[0]) {
        throw new NotFoundException(`Session ${sessionId} not found`);
      }

      if (session[0].status !== 'in_progress') {
        throw new BadRequestException(`Session is not in progress`);
      }

      // Get summary statistics
      const lineStats = await tx
        .select({
          total: sql<number>`count(*)`,
          withVariances: sql<number>`count(*) FILTER (WHERE ${stocktakingLines.variance} != 0)`,
        })
        .from(stocktakingLines)
        .where(eq(stocktakingLines.sessionId, sessionId));

      const adjustmentStats = await tx
        .select({
          count: sql<number>`count(*)`,
        })
        .from(stocktakingAdjustments)
        .where(eq(stocktakingAdjustments.sessionId, sessionId));

      // Update session status
      await tx
        .update(stocktakingSessions)
        .set({
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stocktakingSessions.id, sessionId));

      return {
        sessionId,
        status: 'completed',
        completedAt: new Date(),
        summary: {
          totalLines: Number(lineStats[0]?.total ?? 0),
          discrepanciesFound: Number(lineStats[0]?.withVariances ?? 0),
          adjustmentsApplied: Number(adjustmentStats[0]?.count ?? 0),
        },
      };
    }, tx);
  }

}
