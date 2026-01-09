import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, sql } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import {
  aggJobRuns,
  aggProductOrderDaily,
  analyticsSchema,
  factOrderItems,
} from '../schema';
import { DbTx } from '../db.types';

@Injectable()
export class OrderAggregatesBatchService {
  private readonly logger = new Logger(OrderAggregatesBatchService.name);
  private isRunning = false;

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  @Cron('0 0 */12 * * *')
  async rebuildRecentWindow(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Aggregate rebuild already running, skipping.');
      return;
    }

    this.isRunning = true;

    const days = 14;
    const endDate = this.toDateOnly(new Date());
    const startDate = this.toDateOnly(this.addUtcDays(new Date(), -(days - 1)));

    const jobId = await this.createJobRun(
      'order_agg_rebuild_recent_14d',
      startDate,
      endDate,
    );

    try {
      await this.rebuildRange(startDate, endDate);
      await this.completeJobRun(jobId);
    } catch (error) {
      await this.failJobRun(jobId, error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async rebuildRange(
    startDate: string,
    endDate: string,
    tx?: DbTx,
  ): Promise<void> {
    await this.inTx(async (executor) => {
      await executor.execute(sql`
        DELETE FROM ${aggProductOrderDaily}
        WHERE ${aggProductOrderDaily.aggDate} >= ${startDate}::date
          AND ${aggProductOrderDaily.aggDate} <= ${endDate}::date
      `);

      await executor.execute(sql`
        INSERT INTO ${aggProductOrderDaily} (
          agg_date,
          master_id,
          sales_channel,
          orders_count,
          created_at,
          updated_at
        )
        SELECT
          DATE(${factOrderItems.occurredAt}) AS agg_date,
          ${factOrderItems.masterId} AS master_id,
          ${factOrderItems.salesChannel} AS sales_channel,
          COUNT(DISTINCT ${factOrderItems.orderKey}) AS orders_count,
          NOW(),
          NOW()
        FROM ${factOrderItems}
        WHERE ${factOrderItems.occurredAt} >= ${startDate}::date
          AND ${factOrderItems.occurredAt} < (${endDate}::date + INTERVAL '1 day')
        GROUP BY 1, 2, 3
        ON CONFLICT (agg_date, master_id, sales_channel)
        DO UPDATE SET
          orders_count = EXCLUDED.orders_count,
          updated_at = NOW()
      `);
    }, tx);

    this.logger.log(`Aggregates rebuilt: ${startDate} ~ ${endDate}`);
  }

  private async createJobRun(
    jobName: string,
    startDate: string,
    endDate: string,
  ): Promise<string> {
    const [job] = await this.db
      .insert(aggJobRuns)
      .values({
        jobName,
        status: 'running',
        rangeStart: startDate,
        rangeEnd: endDate,
      })
      .returning({ id: aggJobRuns.id });

    return job?.id ?? '';
  }

  private async completeJobRun(jobId: string): Promise<void> {
    if (!jobId) {
      return;
    }

    await this.db
      .update(aggJobRuns)
      .set({
        status: 'success',
        finishedAt: new Date(),
      })
      .where(eq(aggJobRuns.id, jobId));
  }

  private async failJobRun(jobId: string, error: unknown): Promise<void> {
    if (!jobId) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await this.db
      .update(aggJobRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: message.slice(0, 2000),
      })
      .where(eq(aggJobRuns.id, jobId));
  }

  private addUtcDays(date: Date, days: number): Date {
    const utc = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    ));
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc;
  }

  private toDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
