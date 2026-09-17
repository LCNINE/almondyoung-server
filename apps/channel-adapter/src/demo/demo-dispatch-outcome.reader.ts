import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { count, desc } from 'drizzle-orm';
import { channelAdapterSchema, channelDispatchOperations } from '../schema';

@Injectable()
export class DemoDispatchOutcomeReader {
  constructor(private readonly dbService: DbService<typeof channelAdapterSchema>) {}

  async list(limit: number) {
    const [rows, totalRows] = await Promise.all([
      this.dbService.db
        .select()
        .from(channelDispatchOperations)
        .orderBy(desc(channelDispatchOperations.createdAt), desc(channelDispatchOperations.id))
        .limit(limit),
      this.dbService.db.select({ value: count() }).from(channelDispatchOperations),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        attemptId: row.dispatchAttemptId,
        shipmentId: row.shipmentId,
        orderId: row.salesOrderId,
        externalOrderId: row.externalOrderId,
        operation: row.operation,
        channel: row.channel,
        status: row.status,
        attempts: row.attempts,
        error: row.errorMessage,
        result: row.resultSnapshot,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total: Number(totalRows[0]?.value ?? 0),
    };
  }
}
