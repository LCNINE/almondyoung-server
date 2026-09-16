import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { channelAdapterSchema, demoRunItems, demoRuns } from '../schema';
import { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';
import { DemoOrderProvider } from './demo-order.provider';
import type {
  DemoRunItemStatus,
  DemoRunRepositoryPort,
  DemoRunStatus,
  PersistedDemoRun,
  PersistedDemoRunItem,
} from './demo-run.service';

type DemoRunRow = typeof demoRuns.$inferSelect;
type DemoRunItemRow = typeof demoRunItems.$inferSelect;

@Injectable()
export class DemoRunRepository implements DemoRunRepositoryPort {
  private readonly leaseMs = 30_000;

  constructor(
    private readonly dbService: DbService<typeof channelAdapterSchema>,
    private readonly orderPoller: OrderPollerOrchestrator,
  ) {}

  async createOrGet(run: PersistedDemoRun): Promise<PersistedDemoRun> {
    await this.dbService.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(demoRuns)
        .values({
          id: run.id,
          requestId: run.requestId,
          inputHash: run.inputHash,
          fixtureVersion: run.fixtureVersion,
          scenario: run.scenario,
          status: run.status,
          requestedCount: run.count,
          variantId: run.variantId,
          quantity: run.quantity,
          requestedBy: run.requestedBy,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        })
        .onConflictDoNothing({ target: demoRuns.requestId })
        .returning({ id: demoRuns.id });

      if (inserted.length > 0) {
        await tx.insert(demoRunItems).values(
          run.items.map((item) => ({
            id: item.id,
            runId: item.runId,
            sequence: item.sequence,
            externalOrderId: item.externalOrderId,
            orderId: item.orderId,
            status: item.status,
            attempts: item.attempts,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          })),
        );
      }
    });

    const persisted = await this.getByRequestId(run.requestId);
    if (!persisted) throw new Error(`Demo run ${run.requestId} disappeared after insert`);
    return persisted;
  }

  async process(runId: string): Promise<void> {
    const run = await this.getById(runId);
    if (!run || run.status === 'completed') return;
    const retryCutoff = new Date();

    while (true) {
      const item = await this.claimNext(runId, retryCutoff);
      if (!item) break;

      try {
        const provider = DemoOrderProvider.forItem(
          {
            requestId: run.requestId,
            scenario: run.scenario,
            count: run.count,
            variantId: run.variantId,
            quantity: run.quantity,
            createdAt: run.createdAt,
          },
          item.sequence,
        );
        const [result] = await this.orderPoller.ingestProvider(provider);
        if (!result?.enqueued || result.orderId !== item.orderId) {
          throw new Error(`Order ingestion did not acknowledge deterministic order ${item.orderId}`);
        }
        const now = new Date();
        await this.dbService.db
          .update(demoRunItems)
          .set({
            status: 'enqueued',
            errorMessage: null,
            enqueuedAt: now,
            processingStartedAt: null,
            leaseExpiresAt: null,
            updatedAt: now,
          })
          .where(and(eq(demoRunItems.id, item.id), eq(demoRunItems.status, 'processing')));
      } catch (error) {
        const now = new Date();
        await this.dbService.db
          .update(demoRunItems)
          .set({
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
            processingStartedAt: null,
            leaseExpiresAt: null,
            updatedAt: now,
          })
          .where(and(eq(demoRunItems.id, item.id), eq(demoRunItems.status, 'processing')));
      }
    }

    await this.refreshRunStatus(runId);
  }

  async getById(id: string): Promise<PersistedDemoRun | null> {
    const [row] = await this.dbService.db.select().from(demoRuns).where(eq(demoRuns.id, id)).limit(1);
    return row ? this.hydrate(row) : null;
  }

  async list(limit = 20): Promise<PersistedDemoRun[]> {
    const rows = await this.dbService.db
      .select()
      .from(demoRuns)
      .orderBy(desc(demoRuns.createdAt), desc(demoRuns.id))
      .limit(limit);
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async count(): Promise<number> {
    const [row] = await this.dbService.db.select({ value: count() }).from(demoRuns);
    return Number(row?.value ?? 0);
  }

  private async getByRequestId(requestId: string): Promise<PersistedDemoRun | null> {
    const [row] = await this.dbService.db.select().from(demoRuns).where(eq(demoRuns.requestId, requestId)).limit(1);
    return row ? this.hydrate(row) : null;
  }

  private async hydrate(row: DemoRunRow): Promise<PersistedDemoRun> {
    const items = await this.dbService.db
      .select()
      .from(demoRunItems)
      .where(eq(demoRunItems.runId, row.id))
      .orderBy(asc(demoRunItems.sequence));
    return this.toRun(row, items);
  }

  private async claimNext(runId: string, retryCutoff: Date): Promise<DemoRunItemRow | null> {
    const rows = await this.dbService.db.execute<DemoRunItemRow>(sql`
      UPDATE ${demoRunItems}
      SET
        status = 'processing',
        attempts = attempts + 1,
        error_message = NULL,
        processing_started_at = NOW(),
        lease_expires_at = NOW() + (${this.leaseMs}::integer * interval '1 millisecond'),
        updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM ${demoRunItems}
        WHERE run_id = ${runId}
          AND (
            status = 'pending'
            OR (status = 'failed' AND updated_at < ${retryCutoff.toISOString()}::timestamptz)
            OR (status = 'processing' AND lease_expires_at <= NOW())
          )
        ORDER BY sequence ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING
        id,
        run_id AS "runId",
        sequence,
        external_order_id AS "externalOrderId",
        order_id AS "orderId",
        status,
        attempts,
        error_message AS "errorMessage",
        processing_started_at AS "processingStartedAt",
        lease_expires_at AS "leaseExpiresAt",
        enqueued_at AS "enqueuedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);
    return rows[0] ?? null;
  }

  private async refreshRunStatus(runId: string): Promise<void> {
    const grouped = await this.dbService.db
      .select({ status: demoRunItems.status, value: count() })
      .from(demoRunItems)
      .where(eq(demoRunItems.runId, runId))
      .groupBy(demoRunItems.status);
    const counts = new Map(grouped.map((row) => [row.status, Number(row.value)]));
    const enqueued = counts.get('enqueued') ?? 0;
    const failed = counts.get('failed') ?? 0;
    const inFlight = (counts.get('pending') ?? 0) + (counts.get('processing') ?? 0);
    const status: DemoRunStatus =
      inFlight > 0 ? 'processing' : failed === 0 ? 'completed' : enqueued === 0 ? 'failed' : 'partial_failure';
    const now = new Date();
    await this.dbService.db
      .update(demoRuns)
      .set({ status, updatedAt: now, completedAt: status === 'processing' ? null : now })
      .where(eq(demoRuns.id, runId));
  }

  private toRun(row: DemoRunRow, items: DemoRunItemRow[]): PersistedDemoRun {
    return {
      id: row.id,
      requestId: row.requestId,
      inputHash: row.inputHash,
      fixtureVersion: row.fixtureVersion,
      scenario: row.scenario as PersistedDemoRun['scenario'],
      status: row.status as DemoRunStatus,
      count: row.requestedCount,
      variantId: row.variantId,
      quantity: row.quantity,
      requestedBy: row.requestedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      items: items.map(
        (item): PersistedDemoRunItem => ({
          id: item.id,
          runId: item.runId,
          sequence: item.sequence,
          externalOrderId: item.externalOrderId,
          orderId: item.orderId,
          status: item.status as DemoRunItemStatus,
          attempts: item.attempts,
          error: item.errorMessage,
          enqueuedAt: item.enqueuedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }),
      ),
    };
  }
}
