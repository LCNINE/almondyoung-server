import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';

export type FulfillmentCommandResult<T> = {
  response: T;
  resourceType: string;
  resourceId: string;
  operationId?: string;
  attemptId?: string;
};

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function canonicalFulfillmentRequestHash(request: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(request)))
    .digest('hex');
}

@Injectable()
export class FulfillmentCommandService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async execute<T>(
    input: {
      commandType: string;
      idempotencyKey: string;
      canonicalRequest: unknown;
    },
    handler: (tx: DbTx, commandRequestId: string, requestHash: string) => Promise<FulfillmentCommandResult<T>>,
    tx?: DbTx,
  ): Promise<T> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key is required',
      });
    }

    const requestHash = canonicalFulfillmentRequestHash(input.canonicalRequest);
    const table = wmsTables.fulfillmentCommandRequests;

    return this.dbService.run(async (trx) => {
      const inserted = await trx
        .insert(table)
        .values({
          commandType: input.commandType,
          idempotencyKey,
          requestHash,
          status: 'pending',
        })
        .onConflictDoNothing({ target: [table.commandType, table.idempotencyKey] })
        .returning({ id: table.id });

      if (inserted[0]) {
        const result = await handler(trx, inserted[0].id, requestHash);
        if (result.response == null) {
          throw new Error('Fulfillment command handler must return a response snapshot');
        }

        if (result.operationId) {
          const [operation] = await trx
            .select({ id: wmsTables.shipmentOperations.id })
            .from(wmsTables.shipmentOperations)
            .where(eq(wmsTables.shipmentOperations.id, result.operationId))
            .limit(1);
          if (!operation) throw new Error(`Shipment operation ${result.operationId} does not exist`);
        }

        await trx
          .update(table)
          .set({
            status: 'completed',
            resourceType: result.resourceType,
            resourceId: result.resourceId,
            operationId: result.operationId ?? null,
            attemptId: result.attemptId ?? null,
            responseSnapshot: result.response as Record<string, unknown>,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(table.id, inserted[0].id));
        return result.response;
      }

      const [existing] = await trx
        .select()
        .from(table)
        .where(and(eq(table.commandType, input.commandType), eq(table.idempotencyKey, idempotencyKey)))
        .limit(1);

      if (existing && existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH',
          commandType: input.commandType,
          idempotencyKey,
        });
      }
      if (!existing || existing.status !== 'completed' || existing.responseSnapshot == null) {
        throw new ConflictException({
          code: 'FULFILLMENT_COMMAND_IN_PROGRESS',
          commandType: input.commandType,
          idempotencyKey,
          operationId: existing?.operationId ?? null,
        });
      }

      return existing.responseSnapshot as T;
    }, tx);
  }
}
