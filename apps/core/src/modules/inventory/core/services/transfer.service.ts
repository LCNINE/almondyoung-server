import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx, MovementJob } from '../../schema/inventory.schema';
import { eq, and, desc, SQL, sql, getTableColumns } from 'drizzle-orm';
import { StockEventService } from './stock-event.service';
import { InventoryCommandService } from './inventory-command.service';

/**
 * 창고 간/창고 내 재고 이동 서비스
 *
 * movementJobs 및 movementJobLines 테이블을 활용하여
 * 계획된 이동 작업을 생성하고 실행합니다.
 */
@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly stockEventService: StockEventService,
    private readonly commandService: InventoryCommandService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 창고 간 이동 작업 생성
   */
  async createTransferJob(
    params: {
      fromWarehouseId: string;
      toWarehouseId: string;
      items: Array<{
        skuId: string;
        fromLocationId: string;
        toLocationId: string;
        quantity: number;
      }>;
      actorId?: string;
      memo?: string;
    },
    tx?: DbTx,
  ) {
    return this.dbService.run(async (trx) => {
      this.logger.log(`Creating transfer job from warehouse ${params.fromWarehouseId} to ${params.toWarehouseId}`);

      if (params.items.length === 0) {
        throw new BadRequestException('At least one item is required for transfer');
      }

      // Journal 생성
      const [journal] = await trx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'warehouse_transfer',
        })
        .returning();

      // 총 수량 계산
      const totalQuantity = params.items.reduce((sum, item) => sum + item.quantity, 0);

      // Movement Job 생성 (출발 창고 기준)
      const [movementJob] = await trx
        .insert(wmsTables.movementJobs)
        .values({
          warehouseId: params.fromWarehouseId,
          occurredAt: new Date(),
          totalQuantity,
          journalId: journal.id,
          actorId: params.actorId || null,
          memo: params.memo || null,
        })
        .returning();

      this.logger.log(`Movement job created: ${movementJob.id}`);

      // 각 아이템에 대한 라인 생성 (아직 실행 안함)
      const lines: (typeof wmsTables.movementJobLines.$inferSelect)[] = [];
      for (const item of params.items) {
        const [line] = await trx
          .insert(wmsTables.movementJobLines)
          .values({
            jobId: movementJob.id,
            skuId: item.skuId,
            quantity: item.quantity,
            fromLocationId: item.fromLocationId,
            toLocationId: item.toLocationId,
            memo: `Transfer from ${params.fromWarehouseId} to ${params.toWarehouseId}`,
          })
          .returning();

        lines.push(line);

        this.logger.log(
          `Created transfer line: SKU ${item.skuId}, Qty ${item.quantity}, ${item.fromLocationId} → ${item.toLocationId}`,
        );
      }

      return {
        jobId: movementJob.id,
        journalId: journal.id,
        lines,
      };
    }, tx);
  }

  /**
   * 창고 간 이동 작업 실행
   */
  async executeTransferJob(
    params: {
      jobId: string;
    },
    tx?: DbTx,
  ) {
    return this.dbService.run(async (trx) => {
      this.logger.log(`Executing transfer job ${params.jobId}`);

      // Job 조회
      const movementJob = await trx.query.movementJobs.findFirst({
        where: eq(wmsTables.movementJobs.id, params.jobId),
      });

      if (!movementJob) {
        throw new NotFoundException(`Movement job ${params.jobId} not found`);
      }

      // Job Lines 조회
      const lines = await trx.query.movementJobLines.findMany({
        where: eq(wmsTables.movementJobLines.jobId, params.jobId),
      });

      if (lines.length === 0) {
        throw new BadRequestException(`No items found in movement job ${params.jobId}`);
      }

      // 창고 정보 조회 (출발/도착 창고 결정)
      const firstLine = lines[0];
      const fromLocation = await trx.query.locations.findFirst({
        where: eq(wmsTables.locations.id, firstLine.fromLocationId!),
      });

      const toLocation = await trx.query.locations.findFirst({
        where: eq(wmsTables.locations.id, firstLine.toLocationId!),
      });

      if (!fromLocation || !toLocation) {
        throw new BadRequestException('Invalid from/to locations');
      }

      const isInterWarehouse = fromLocation.warehouseId !== toLocation.warehouseId;

      this.logger.log(`Transfer type: ${isInterWarehouse ? 'Inter-warehouse' : 'Intra-warehouse'}`);

      // 각 라인 실행
      for (const line of lines) {
        if (!line.fromLocationId || !line.toLocationId) {
          throw new BadRequestException(`Line ${line.id} has invalid location IDs`);
        }

        if (isInterWarehouse) {
          // 창고 간 이동: transferBetweenWarehouses 사용
          const result = await this.stockEventService.transferBetweenWarehouses(
            line.skuId,
            fromLocation.warehouseId,
            line.fromLocationId,
            toLocation.warehouseId,
            line.toLocationId,
            line.quantity,
            line.memo || undefined,
            trx,
          );

          // Line 업데이트: 첫 번째 이벤트 ID 기록
          await trx
            .update(wmsTables.movementJobLines)
            .set({
              eventId: result.shipEventId,
            })
            .where(eq(wmsTables.movementJobLines.id, line.id));

          // Work Log 생성
          await trx.insert(wmsTables.movementWorkLogs).values({
            type: 'TRANSFER',
            jobId: movementJob.id,
            lineId: line.id,
            skuId: line.skuId,
            warehouseId: fromLocation.warehouseId,
            fromLocationId: line.fromLocationId,
            toLocationId: line.toLocationId,
            quantity: line.quantity,
            eventId: result.shipEventId,
          });

          this.logger.log(
            `Executed inter-warehouse transfer for line ${line.id}: ${result.shipEventId} / ${result.receiveEventId}`,
          );
        } else {
          // 창고 내 이동: moveInternal 사용
          const result = await this.commandService.moveInternal(
            {
              skuId: line.skuId,
              warehouseId: fromLocation.warehouseId,
              fromLocationId: line.fromLocationId,
              toLocationId: line.toLocationId,
              quantity: line.quantity,
              reason: line.memo || 'Internal movement',
              journalId: movementJob.journalId ?? undefined,
            },
            trx,
          );

          // Line 업데이트
          await trx
            .update(wmsTables.movementJobLines)
            .set({
              eventId: result.eventId,
            })
            .where(eq(wmsTables.movementJobLines.id, line.id));

          // Work Log 생성
          await trx.insert(wmsTables.movementWorkLogs).values({
            type: 'MOVE',
            jobId: movementJob.id,
            lineId: line.id,
            skuId: line.skuId,
            warehouseId: fromLocation.warehouseId,
            fromLocationId: line.fromLocationId,
            toLocationId: line.toLocationId,
            quantity: line.quantity,
            eventId: result.eventId,
          });

          this.logger.log(`Executed intra-warehouse move for line ${line.id}: ${result.eventId}`);
        }
      }

      this.logger.log(`Transfer job ${params.jobId} execution completed`);

      return {
        jobId: params.jobId,
        linesExecuted: lines.length,
      };
    }, tx);
  }

  /**
   * 창고 내 간편 이동 (단일 아이템)
   */
  async moveWithinWarehouse(
    params: {
      skuId: string;
      warehouseId: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      actorId?: string;
      memo?: string;
    },
    tx?: DbTx,
  ) {
    return this.dbService.run(async (trx) => {
      this.logger.log(
        `Moving SKU ${params.skuId} within warehouse ${params.warehouseId}: ${params.fromLocationId} → ${params.toLocationId}`,
      );

      // Job 생성
      const { jobId, journalId } = await this.createTransferJob(
        {
          fromWarehouseId: params.warehouseId,
          toWarehouseId: params.warehouseId,
          items: [
            {
              skuId: params.skuId,
              fromLocationId: params.fromLocationId,
              toLocationId: params.toLocationId,
              quantity: params.quantity,
            },
          ],
          actorId: params.actorId,
          memo: params.memo,
        },
        trx,
      );

      // 즉시 실행
      await this.executeTransferJob({ jobId }, trx);

      return {
        jobId,
        journalId,
      };
    }, tx);
  }

  /**
   * 이동 작업 조회
   */
  async getTransferJob(jobId: string, tx?: DbTx) {
    const db = tx ?? this.db;

    const job = await db.query.movementJobs.findFirst({
      where: eq(wmsTables.movementJobs.id, jobId),
    });

    if (!job) {
      throw new NotFoundException(`Movement job ${jobId} not found`);
    }

    const lines = await db.query.movementJobLines.findMany({
      where: eq(wmsTables.movementJobLines.jobId, jobId),
    });

    return {
      ...job,
      lines,
    };
  }

  /**
   * 이동 작업 목록 조회
   */
  async listTransferJobs(
    filters: {
      warehouseId?: string;
      limit?: number;
      offset?: number;
    },
    tx?: DbTx,
  ): Promise<(MovementJob & { lineCount: number })[]> {
    const db = tx ?? this.db;

    const conditions: SQL[] = [];

    if (filters.warehouseId) {
      conditions.push(eq(wmsTables.movementJobs.warehouseId, filters.warehouseId));
    }

    const { movementJobs, movementJobLines } = wmsTables;

    const jobs = await db
      .select({
        ...getTableColumns(movementJobs),
        lineCount: sql<number>`(
          SELECT COUNT(*)::int 
          FROM ${movementJobLines} 
          WHERE ${movementJobLines.jobId} = ${movementJobs.id}
        )`.as('line_count'),
      })
      .from(movementJobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(filters.limit || 50)
      .offset(filters.offset || 0)
      .orderBy(desc(movementJobs.occurredAt));

    return jobs;
  }

  /**
   * 이동 작업 상태 조회
   */
  async getTransferJobStatus(jobId: string, tx?: DbTx) {
    const db = tx ?? this.db;

    const job = await db.query.movementJobs.findFirst({
      where: eq(wmsTables.movementJobs.id, jobId),
    });

    if (!job) {
      throw new NotFoundException(`Movement job ${jobId} not found`);
    }

    const lines = await db.query.movementJobLines.findMany({
      where: eq(wmsTables.movementJobLines.jobId, jobId),
    });

    const executedLines = lines.filter((line) => line.eventId !== null);
    const pendingLines = lines.filter((line) => line.eventId === null);

    return {
      jobId,
      total: lines.length,
      executed: executedLines.length,
      pending: pendingLines.length,
      status: pendingLines.length === 0 ? 'completed' : executedLines.length === 0 ? 'pending' : 'in_progress',
    };
  }
}
