import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService, TypedDatabase } from '@app/db';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { MoveBatchDto } from '../dto/move-batch.dto';
import { StockEventStore } from '../../inventory/repositories/stock-event.store';
import { and, eq } from 'drizzle-orm';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class MovementService {
  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly stockEventStore: StockEventStore,
  ) {}

  private get db() { return this.dbService.db; }

  async moveImmediately(dto: MoveBatchDto) {
    const { warehouseId, actorId, memo } = dto;
    if (!dto.lines?.length) throw new BadRequestException('lines required');

    // 기본 유효성: 동일 창고, 동일 로케이션 금지, 수량>0
    const locations = await this.db.query.locations.findMany({
      where: (l, { inArray }) => inArray(l.id, [
        ...dto.lines.map(l => l.fromLocationId),
        ...dto.lines.map(l => l.toLocationId),
      ])
    });
    const locMap = new Map(locations.map(l => [l.id, l] as const));

    // SKU 존재 검증
    const skuIds = Array.from(new Set(dto.lines.map(l => l.skuId)));
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
    return this.db.transaction(async (tx) => {
      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const [journal] = await tx.insert(wmsTables.stockJournals).values({
        sourceType: 'MOVEMENT',
        actorId,
      }).returning();

      const [job] = await tx.insert(wmsTables.movementJobs).values({
        warehouseId,
        occurredAt,
        journalId: journal.id,
        actorId,
        memo,
        totalQuantity: dto.lines.reduce((s, l) => s + l.quantity, 0),
      }).returning();

      const lineOutputs: any[] = [];

      for (const line of dto.lines) {
        // 음수 방지: from 그레인 수량 확인(간단 체크)
        const fromQtyRow = await tx.query.stockLedgers.findFirst({
          where: and(
            eq(wmsTables.stockLedgers.skuId, line.skuId),
            eq(wmsTables.stockLedgers.warehouseId, warehouseId),
            eq(wmsTables.stockLedgers.locationId, line.fromLocationId),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          )
        });
        const fromQty = fromQtyRow?.qty ?? 0;
        if (fromQty < line.quantity) {
          throw new BadRequestException('insufficient quantity at from location');
        }

        const event = await this.stockEventStore.createEvent({
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
        }, tx as unknown as DbTx);

        const [jobLine] = await tx.insert(wmsTables.movementJobLines).values({
          jobId: job.id,
          skuId: line.skuId,
          quantity: line.quantity,
          fromLocationId: line.fromLocationId,
          toLocationId: line.toLocationId,
          eventId: event?.id,
          memo: line.memo,
        }).returning();

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

        lineOutputs.push({
          id: jobLine.id,
          skuId: line.skuId,
          quantity: line.quantity,
          fromLocationId: line.fromLocationId,
          toLocationId: line.toLocationId,
          eventId: event?.id ?? null,
        });
      }

      return {
        job: { id: job.id, warehouseId: job.warehouseId, occurredAt: job.occurredAt, totalQuantity: job.totalQuantity, journalId: job.journalId, actorId: job.actorId, memo: job.memo },
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
      where: (w, { and, eq, gte }) => and(
        eq(w.type, 'MOVE'),
        skuId ? eq(w.skuId, skuId) : undefined,
        warehouseId ? eq(w.warehouseId, warehouseId) : undefined,
        gte(w.timestamp, since),
      ),
      orderBy: (w, { desc }) => [desc(w.timestamp)],
    });
  }
}
