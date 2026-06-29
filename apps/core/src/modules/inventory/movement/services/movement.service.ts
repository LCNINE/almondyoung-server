import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, MovementJobLine, MovementJob } from '../../schema/inventory.schema';
import { MoveBatchDto } from '../dto/move-batch.dto';
import { InterWarehouseTransferDto } from '../dto/inter-warehouse-transfer.dto';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { and, eq, inArray } from 'drizzle-orm';

@Injectable()
export class MovementService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly stockEventStore: StockEventStore,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async moveImmediately(dto: MoveBatchDto): Promise<{ job: MovementJob; lines: MovementJobLine[] }> {
    const { warehouseId, actorId, memo } = dto;
    if (!dto.lines?.length) throw new BadRequestException('lines required');

    // 기본 유효성: 동일 창고, 동일 로케이션 금지, 수량>0
    const locations = await this.db.query.locations.findMany({
      where: (l, { inArray }) =>
        inArray(l.id, [...dto.lines.map((l) => l.fromLocationId), ...dto.lines.map((l) => l.toLocationId)]),
    });
    const locMap = new Map(locations.map((l) => [l.id, l] as const));

    // SKU 존재 검증
    const skuIds = Array.from(new Set(dto.lines.map((l) => l.skuId)));
    const skus = await this.db.query.skus.findMany({ where: (s, { inArray }) => inArray(s.id, skuIds) });
    if (skus.length !== skuIds.length) {
      throw new BadRequestException('one or more skuId not found');
    }

    for (const line of dto.lines) {
      if (line.fromLocationId === line.toLocationId) {
        throw new BadRequestException('from/to locations must be different');
      }
      const from = locMap.get(line.fromLocationId);
      const to = locMap.get(line.toLocationId);
      if (!from || !to) throw new BadRequestException('invalid location id in lines');
      if (from.warehouseId !== warehouseId || to.warehouseId !== warehouseId) {
        throw new BadRequestException('all locations must belong to provided warehouseId');
      }
      if (line.quantity <= 0) throw new BadRequestException('quantity must be positive');
    }

    // 트랜잭션: 저널→이벤트/원장→작업헤더/라인/로그
    return this.dbService.run(async (tx) => {
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'MOVEMENT',
          actorId,
        })
        .returning();

      const [job] = await tx
        .insert(wmsTables.movementJobs)
        .values({
          warehouseId,
          occurredAt,
          journalId: journal.id,
          actorId,
          memo,
          totalQuantity: dto.lines.reduce((s, l) => s + l.quantity, 0),
        })
        .returning();

      const lineOutputs: MovementJobLine[] = [];

      for (const line of dto.lines) {
        // 음수 방지: from 그레인 수량 확인(간단 체크)
        const fromQtyRow = await tx.query.stockLedgers.findFirst({
          where: and(
            eq(wmsTables.stockLedgers.skuId, line.skuId),
            eq(wmsTables.stockLedgers.warehouseId, warehouseId),
            eq(wmsTables.stockLedgers.locationId, line.fromLocationId),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        });
        const fromQty = fromQtyRow?.qty ?? 0;
        if (fromQty < line.quantity) {
          throw new BadRequestException('insufficient quantity at from location');
        }

        const event = await this.stockEventStore.createEvent(
          {
            journalId: journal.id,
            skuId: line.skuId,
            fromWarehouseId: warehouseId,
            fromLocationId: line.fromLocationId,
            toWarehouseId: warehouseId,
            toLocationId: line.toLocationId,
            fromState: 'ON_HAND',
            toState: 'ON_HAND',
            transitionType: 'MOVE',
            quantity: line.quantity,
            occurredAt,
            reason: line.memo ?? memo ?? undefined,
          },
          tx,
        );

        const [jobLine] = await tx
          .insert(wmsTables.movementJobLines)
          .values({
            jobId: job.id,
            skuId: line.skuId,
            quantity: line.quantity,
            fromLocationId: line.fromLocationId,
            toLocationId: line.toLocationId,
            eventId: event?.id,
            memo: line.memo,
          })
          .returning();

        await tx.insert(wmsTables.movementWorkLogs).values({
          type: 'MOVE',
          jobId: job.id,
          lineId: jobLine.id,
          skuId: line.skuId,
          warehouseId,
          fromLocationId: line.fromLocationId,
          toLocationId: line.toLocationId,
          quantity: line.quantity,
          eventId: event?.id,
          reason: line.memo ?? memo,
        });

        lineOutputs.push(jobLine);
      }

      return {
        job,
        lines: lineOutputs,
      };
    });
  }

  async getJobById(jobId: string) {
    const job = await this.db.query.movementJobs.findFirst({ where: (j, { eq }) => eq(j.id, jobId) });
    if (!job) throw new BadRequestException('movement job not found');
    const lines = await this.db.query.movementJobLines.findMany({ where: (l, { eq }) => eq(l.jobId, jobId) });
    return { job, lines };
  }

  async getMovementHistory(params: { skuId?: string; warehouseId?: string; days?: number } = {}) {
    const { skuId, warehouseId, days = 7 } = params;
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.db.query.movementWorkLogs.findMany({
      where: (w, { and, eq, gte }) =>
        and(
          eq(w.type, 'MOVE'),
          skuId ? eq(w.skuId, skuId) : undefined,
          warehouseId ? eq(w.warehouseId, warehouseId) : undefined,
          gte(w.timestamp, since),
        ),
      orderBy: (w, { desc }) => [desc(w.timestamp)],
    });
  }

  async createInterWarehouseTransfer(dto: InterWarehouseTransferDto): Promise<{ jobId: string }> {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must be different');
    }

    const warehouses = await this.db
      .select({ id: wmsTables.warehouses.id })
      .from(wmsTables.warehouses)
      .where(inArray(wmsTables.warehouses.id, [dto.fromWarehouseId, dto.toWarehouseId]));
    if (warehouses.length !== 2) {
      throw new BadRequestException('One or both warehouse IDs are invalid');
    }

    const skuRows = await this.db
      .select({ id: wmsTables.skus.id })
      .from(wmsTables.skus)
      .where(eq(wmsTables.skus.id, dto.skuId))
      .limit(1);
    if (!skuRows[0]) {
      throw new BadRequestException(`SKU ${dto.skuId} not found`);
    }

    const stockRow = await this.db.query.stockLedgers.findFirst({
      where: and(
        eq(wmsTables.stockLedgers.skuId, dto.skuId),
        eq(wmsTables.stockLedgers.warehouseId, dto.fromWarehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    });
    if (!stockRow || stockRow.qty < dto.quantity) {
      throw new BadRequestException('Insufficient ON_HAND stock in source warehouse');
    }

    return this.dbService.run(async (tx) => {
      const occurredAt = new Date();
      const [journal] = await tx.insert(wmsTables.stockJournals).values({ sourceType: 'MOVEMENT' }).returning();

      // warehouseId = toWarehouseId: completeInterWarehouseMovement에서 destination plan 조회 기준
      const [job] = await tx
        .insert(wmsTables.movementJobs)
        .values({
          warehouseId: dto.toWarehouseId,
          occurredAt,
          journalId: journal.id,
          totalQuantity: dto.quantity,
          memo: dto.reason,
        })
        .returning();

      // toLocationId 미확정이므로 fromState 차감만 기록 (toState는 completeInterWarehouseMovement에서 처리)
      const event = await this.stockEventStore.createEvent(
        {
          journalId: journal.id,
          skuId: dto.skuId,
          fromWarehouseId: dto.fromWarehouseId,
          fromLocationId: stockRow.locationId,
          toWarehouseId: dto.toWarehouseId,
          fromState: 'ON_HAND',
          toState: null,
          transitionType: 'MOVE',
          quantity: dto.quantity,
          occurredAt,
          reason: dto.reason,
        },
        tx,
      );

      await tx.insert(wmsTables.movementJobLines).values({
        jobId: job.id,
        skuId: dto.skuId,
        quantity: dto.quantity,
        fromLocationId: stockRow.locationId,
        eventId: event?.id,
        memo: dto.reason,
      });

      return { jobId: job.id };
    });
  }

  /**
   * 창고간 이동 완료 시 destination plan 활성화
   * 중국 창고에서 부천 창고로 이동 완료되면 부천 입고예정 활성화
   */
  async completeInterWarehouseMovement(movementJobId: string): Promise<void> {
    return this.dbService.run(async (tx) => {
      const job = await tx.query.movementJobs.findFirst({
        where: eq(wmsTables.movementJobs.id, movementJobId),
        with: { lines: true },
      });

      if (!job) {
        throw new BadRequestException(`Movement job ${movementJobId} not found`);
      }

      // 기존 이동 완료 로직은 이미 moveImmediately에서 처리됨

      // 🔥 추가: destination plan 활성화
      const affectedSkus = job.lines.map((line) => line.skuId);

      if (affectedSkus.length === 0) return;

      // 해당 SKU의 destination plan들 찾기
      const destinationPlans = await tx.query.inboundPlans.findMany({
        where: and(
          eq(wmsTables.inboundPlans.planType, 'destination'),
          eq(wmsTables.inboundPlans.warehouseId, job.warehouseId), // 목적지 창고
          eq(wmsTables.inboundPlans.status, 'pending'),
        ),
        with: {
          items: {
            where: (item, { inArray }) => inArray(item.skuId, affectedSkus),
          },
        },
      });

      // destination plan의 예상 입고일 설정
      for (const plan of destinationPlans) {
        if (plan.items.length > 0) {
          // 해당 SKU가 포함된 plan만
          await tx
            .update(wmsTables.inboundPlans)
            .set({
              expectedDate: new Date(), // 즉시 입고 가능
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.inboundPlans.id, plan.id));
        }
      }
    });
  }
}
