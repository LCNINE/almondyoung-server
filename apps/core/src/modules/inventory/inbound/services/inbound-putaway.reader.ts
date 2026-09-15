import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { receiptFactsCtes, ReceiptFactsRow, receiptStateFromFacts } from './inbound-receipt-state.reader';
import {
  inboundPendingQuantitySql,
  inboundReceiptInvalidSql,
} from '../../shared/availability/inbound-origin-availability';
import { PutawayPendingListDto } from '../dto/putaway-pending.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

// Each page remains bounded for handheld clients; LIMIT+1 detects another page.
const PENDING_LIMIT = 200;

interface PendingQuery {
  warehouseId: string;
  days?: number;
  skuIds?: string[];
  cursor?: string;
  originLocationId?: string;
}

interface PendingCursor {
  v: 1;
  scope: string;
  at: string;
  id: string;
  since: string | null;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/.test(value)) return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) && date.getUTCFullYear() > 0 && date.toISOString() === `${value.slice(0, 23)}Z`
  );
}

function decodeCursor(token: string, scope: string, days?: number): PendingCursor {
  try {
    if (typeof token !== 'string' || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const bytes = Buffer.from(token, 'base64url');
    if (bytes.toString('base64url') !== token) throw new Error();
    const value = JSON.parse(bytes.toString('utf8')) as PendingCursor;
    if (
      value?.v !== 1 ||
      value.scope !== scope ||
      !validTimestamp(value.at) ||
      typeof value.id !== 'string' ||
      !isUUID(value.id) ||
      (days === undefined ? value.since !== null : !validTimestamp(value.since))
    )
      throw new Error();
    return value;
  } catch {
    throw new BadRequestException('Invalid cursor for this putaway query');
  }
}

/**
 * 적치 대기 조회. inbound.service.ts 에 두지 않는 이유는 그 파일이 이미 1100줄이
 * 넘고 조회 규칙 위반이 남아 있어서다 — 신규 조회는 리더로 분리한다.
 */
@Injectable()
export class InboundPutawayReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async listPending(params: PendingQuery, tx?: DbTx): Promise<PutawayPendingListDto> {
    const { warehouseId, days, skuIds, originLocationId } = params;
    const scope = createHash('sha256')
      .update(
        JSON.stringify([
          warehouseId.toLowerCase(),
          days ?? null,
          originLocationId?.toLowerCase() ?? null,
          [...new Set(skuIds?.map((id) => id.toLowerCase()))].sort(),
        ]),
      )
      .digest('hex');
    const cursor = params.cursor === undefined ? undefined : decodeCursor(params.cursor, scope, days);
    // Keep the rolling lower bound fixed while paging through a query.
    const since = cursor
      ? cursor.since
      : days === undefined
        ? null
        : new Date(Date.now() - days * DAY_MS).toISOString();

    return this.dbService.run(async (trx) => {
      const filters = [
        sql`ir.status = 'posted'`,
        sql`ir.warehouse_id = ${warehouseId}::uuid`,
        // Include malformed legacy rows even when their pending counter is nonpositive.
        sql`(origin.is_system = true OR ${inboundReceiptInvalidSql})`,
        sql`(${inboundPendingQuantitySql} > 0 OR ${inboundReceiptInvalidSql})`,
        ...(originLocationId ? [sql`irl.origin_location_id = ${originLocationId}::uuid`] : []),
        ...(skuIds !== undefined
          ? [
              skuIds.length
                ? sql`irl.sku_id IN (${sql.join(
                    skuIds.map((id) => sql`${id}::uuid`),
                    sql`, `,
                  )})`
                : sql`false`,
            ]
          : []),
        ...(since ? [sql`ir.occurred_at >= ${since}::timestamptz`] : []),
        ...(cursor ? [sql`(ir.occurred_at, irl.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`] : []),
      ];
      const rows = (await trx.execute(sql`
        WITH ${receiptFactsCtes(sql.join(filters, sql` AND `), sql`ORDER BY ir.occurred_at, irl.id LIMIT ${PENDING_LIMIT + 1}`)}
        SELECT * FROM facts ORDER BY "receivedAt", "lineId"
      `)) as unknown as ReceiptFactsRow[];

      const truncated = rows.length > PENDING_LIMIT;
      const limited = truncated ? rows.slice(0, PENDING_LIMIT) : rows;

      const last = limited[limited.length - 1];
      return {
        nextCursor: truncated
          ? Buffer.from(
              JSON.stringify({ v: 1, scope, at: last.cursorAt, id: last.lineId, since } satisfies PendingCursor),
            ).toString('base64url')
          : null,
        total: limited.length,
        truncated,
        items: limited.map((row) => {
          const { canPutaway, putawayBlockReason } = receiptStateFromFacts(row);
          return {
            lineId: row.lineId,
            source: row.source,
            canPutaway,
            putawayBlockReason,
            skuId: row.skuId,
            skuName: row.skuName,
            skuCode: row.skuCode,
            pendingQty: Number(row.pendingQty),
            originLocationId: row.originLocationId,
            originLocationCode: row.originLocationCode,
            receivedAt: new Date(row.receivedAt).toISOString(),
          };
        }),
      };
    }, tx);
  }
}
