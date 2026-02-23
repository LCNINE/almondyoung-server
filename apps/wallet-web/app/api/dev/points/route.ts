import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import type {
  DevPointActionType,
  DevPointEventDetailRow,
  DevPointEventRow,
  DevPointSummary,
  WalletDevPointActionRequest,
  WalletDevPointActionResponse,
  WalletDevPointsResponse,
} from "@/lib/dev-points-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface HttpErrorOptions {
  status: number;
  message: string;
}

class HttpError extends Error {
  readonly status: number;

  constructor(options: HttpErrorOptions) {
    super(options.message);
    this.name = "HttpError";
    this.status = options.status;
  }
}

interface PointSummaryRow {
  confirmedAmount: number;
  reservedAmount: number;
  eventCount: number;
  holdCount: number;
}

interface PointEventRowRaw {
  id: string;
  userId: string;
  eventType: "EARN" | "REDEEM" | "EARN_CANCEL" | "REDEEM_CANCEL";
  amount: number;
  originalEventId: string | null;
  intentId: string | null;
  legId: string | null;
  attemptId: string | null;
  providerIdempotencyKey: string;
  providerTransactionId: string | null;
  reasonCode: string | null;
  reasonMessage: string | null;
  metadata: unknown;
  createdAt: string | Date;
  details: unknown;
}

interface PointHoldRowRaw {
  id: string;
  userId: string;
  intentId: string;
  legId: string;
  authorizeAttemptId: string;
  amount: number;
  status: "AUTHORIZED" | "CAPTURED" | "CANCELLED";
  capturedEventId: string | null;
  captureAttemptId: string | null;
  cancelAttemptId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface LotAvailabilityRow {
  earnedEventDetailId: string;
  confirmedAmount: number;
  reservedAmount: number;
}

interface ParsedActionBody extends WalletDevPointActionRequest {
  reasonCode: string;
  reasonMessage: string | null;
  metadata: Record<string, unknown>;
}

function parseLimit(raw: string | null): number {
  if (!raw) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asIsoString(value: string | Date | null | undefined): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return value.toISOString();
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

function parseActionBody(raw: unknown): ParsedActionBody {
  if (!isRecord(raw)) {
    throw new HttpError({
      status: 400,
      message: "Request body must be a JSON object",
    });
  }

  const userId = String(raw.userId ?? "").trim();
  if (!userId) {
    throw new HttpError({ status: 400, message: "userId is required" });
  }
  if (userId.length > 128) {
    throw new HttpError({
      status: 400,
      message: "userId length must be <= 128",
    });
  }

  const action = String(raw.action ?? "")
    .trim()
    .toUpperCase() as DevPointActionType;
  if (action !== "EARN" && action !== "REDEEM") {
    throw new HttpError({
      status: 400,
      message: "action must be EARN or REDEEM",
    });
  }

  const amount = Number(raw.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpError({
      status: 400,
      message: "amount must be a positive integer",
    });
  }

  const reasonCodeDefault =
    action === "EARN" ? "DEV_MANUAL_EARN" : "DEV_MANUAL_REDEEM";
  const reasonCodeRaw = String(raw.reasonCode ?? reasonCodeDefault).trim();
  if (!reasonCodeRaw) {
    throw new HttpError({
      status: 400,
      message: "reasonCode must not be empty",
    });
  }
  if (reasonCodeRaw.length > 128) {
    throw new HttpError({
      status: 400,
      message: "reasonCode length must be <= 128",
    });
  }

  const reasonMessageRaw = String(raw.reasonMessage ?? "").trim();
  const reasonMessage = reasonMessageRaw.length > 0 ? reasonMessageRaw : null;

  const metadataRaw = raw.metadata;
  let metadata: Record<string, unknown> = {};
  if (metadataRaw !== undefined) {
    if (!isRecord(metadataRaw)) {
      throw new HttpError({
        status: 400,
        message: "metadata must be a JSON object",
      });
    }
    metadata = metadataRaw;
  }

  return {
    userId,
    action,
    amount,
    reasonCode: reasonCodeRaw,
    reasonMessage,
    metadata,
  };
}

async function readPointSummary(userId: string): Promise<DevPointSummary> {
  const rows = (await db.execute(sql<PointSummaryRow>`
    select
      coalesce((select sum(amount) from point_events where user_id = ${userId}), 0)::int as "confirmedAmount",
      coalesce((select sum(amount) from point_holds where user_id = ${userId} and status = 'AUTHORIZED'), 0)::int as "reservedAmount",
      coalesce((select count(*) from point_events where user_id = ${userId}), 0)::int as "eventCount",
      coalesce((select count(*) from point_holds where user_id = ${userId}), 0)::int as "holdCount"
  `)) as unknown as PointSummaryRow[];

  const summary = rows[0] ?? {
    confirmedAmount: 0,
    reservedAmount: 0,
    eventCount: 0,
    holdCount: 0,
  };

  const confirmedAmount = Number(summary.confirmedAmount ?? 0);
  const reservedAmount = Number(summary.reservedAmount ?? 0);

  return {
    confirmedAmount,
    reservedAmount,
    availableAmount: confirmedAmount - reservedAmount,
    eventCount: Number(summary.eventCount ?? 0),
    holdCount: Number(summary.holdCount ?? 0),
  };
}

async function readPointOverview(
  userId: string,
  limit: number
): Promise<WalletDevPointsResponse> {
  const [summary, rawEvents, rawHolds] = await Promise.all([
    readPointSummary(userId),
    db.execute(sql<PointEventRowRaw>`
      select
        e.id,
        e.user_id as "userId",
        e.event_type as "eventType",
        e.amount,
        e.original_event_id as "originalEventId",
        e.intent_id as "intentId",
        e.leg_id as "legId",
        e.attempt_id as "attemptId",
        e.provider_idempotency_key as "providerIdempotencyKey",
        e.provider_transaction_id as "providerTransactionId",
        e.reason_code as "reasonCode",
        e.reason_message as "reasonMessage",
        e.metadata,
        e.created_at as "createdAt",
        coalesce((
          select json_agg(
            json_build_object(
              'id', d.id,
              'pointEventId', d.point_event_id,
              'userId', d.user_id,
              'eventType', d.event_type,
              'amount', d.amount,
              'earnedEventDetailId', d.earned_event_detail_id,
              'originalEventDetailId', d.original_event_detail_id,
              'createdAt', d.created_at
            )
            order by d.created_at asc, d.id asc
          )
          from point_event_details d
          where d.point_event_id = e.id
        ), '[]'::json) as "details"
      from point_events e
      where e.user_id = ${userId}
      order by e.created_at desc, e.id desc
      limit ${limit}
    `),
    db.execute(sql<PointHoldRowRaw>`
      select
        h.id,
        h.user_id as "userId",
        h.intent_id as "intentId",
        h.leg_id as "legId",
        h.authorize_attempt_id as "authorizeAttemptId",
        h.amount,
        h.status,
        h.captured_event_id as "capturedEventId",
        h.capture_attempt_id as "captureAttemptId",
        h.cancel_attempt_id as "cancelAttemptId",
        h.created_at as "createdAt",
        h.updated_at as "updatedAt"
      from point_holds h
      where h.user_id = ${userId}
      order by h.created_at desc, h.id desc
      limit ${limit}
    `),
  ]);

  const events = (rawEvents as unknown as PointEventRowRaw[]).map(
    (row): DevPointEventRow => ({
      id: row.id,
      userId: row.userId,
      eventType: row.eventType,
      amount: Number(row.amount ?? 0),
      originalEventId: row.originalEventId,
      intentId: row.intentId,
      legId: row.legId,
      attemptId: row.attemptId,
      providerIdempotencyKey: row.providerIdempotencyKey,
      providerTransactionId: row.providerTransactionId,
      reasonCode: row.reasonCode,
      reasonMessage: row.reasonMessage,
      metadata: parseMetadata(row.metadata),
      createdAt: asIsoString(row.createdAt),
      details: parseJsonArray<DevPointEventDetailRow>(row.details).map((detail) => ({
        ...detail,
        amount: Number(detail.amount ?? 0),
        createdAt: asIsoString(detail.createdAt as string | Date),
      })),
    })
  );

  const holds = (rawHolds as unknown as PointHoldRowRaw[]).map((row) => ({
    id: row.id,
    userId: row.userId,
    intentId: row.intentId,
    legId: row.legId,
    authorizeAttemptId: row.authorizeAttemptId,
    amount: Number(row.amount ?? 0),
    status: row.status,
    capturedEventId: row.capturedEventId,
    captureAttemptId: row.captureAttemptId,
    cancelAttemptId: row.cancelAttemptId,
    createdAt: asIsoString(row.createdAt),
    updatedAt: asIsoString(row.updatedAt),
  }));

  return {
    fetchedAt: new Date().toISOString(),
    userId,
    limit,
    summary,
    events,
    holds,
  };
}

async function acquireUserLedgerLock(
  tx: DbTransaction,
  userId: string
): Promise<void> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(
      hashtext('POINTS_LEDGER'),
      hashtext(${userId})
    )
  `);
}

async function readBalanceSnapshot(
  tx: DbTransaction,
  userId: string
): Promise<{
  confirmedAmount: number;
  reservedAmount: number;
  availableAmount: number;
}> {
  const rows = (await tx.execute(sql<{
    confirmedAmount: number;
    reservedAmount: number;
  }>`
    select
      coalesce((select sum(amount) from point_events where user_id = ${userId}), 0)::int as "confirmedAmount",
      coalesce((select sum(amount) from point_holds where user_id = ${userId} and status = 'AUTHORIZED'), 0)::int as "reservedAmount"
  `)) as unknown as Array<{
    confirmedAmount: number;
    reservedAmount: number;
  }>;

  const confirmedAmount = Number(rows[0]?.confirmedAmount ?? 0);
  const reservedAmount = Number(rows[0]?.reservedAmount ?? 0);

  return {
    confirmedAmount,
    reservedAmount,
    availableAmount: confirmedAmount - reservedAmount,
  };
}

async function readLotAvailability(
  tx: DbTransaction,
  userId: string
): Promise<LotAvailabilityRow[]> {
  const rows = (await tx.execute(sql<LotAvailabilityRow>`
    select
      d.earned_event_detail_id as "earnedEventDetailId",
      sum(d.amount)::int as "confirmedAmount",
      coalesce(r.reserved_amount, 0)::int as "reservedAmount"
    from point_event_details d
    left join (
      select
        hd.earned_event_detail_id,
        sum(hd.amount)::int as reserved_amount
      from point_hold_details hd
      join point_holds h on h.id = hd.hold_id
      where h.user_id = ${userId}
        and h.status = 'AUTHORIZED'
      group by hd.earned_event_detail_id
    ) r on r.earned_event_detail_id = d.earned_event_detail_id
    join point_event_details seed_detail on seed_detail.id = d.earned_event_detail_id
    join point_events seed_event on seed_event.id = seed_detail.point_event_id
    where d.user_id = ${userId}
    group by d.earned_event_detail_id, r.reserved_amount
    having sum(d.amount) > 0
    order by min(seed_event.created_at), d.earned_event_detail_id
  `)) as unknown as LotAvailabilityRow[];

  return rows.map((row) => ({
    earnedEventDetailId: row.earnedEventDetailId,
    confirmedAmount: Number(row.confirmedAmount ?? 0),
    reservedAmount: Number(row.reservedAmount ?? 0),
  }));
}

function allocateAcrossLots(
  amount: number,
  lotRows: LotAvailabilityRow[]
): Array<{ earnedEventDetailId: string; amount: number }> | null {
  let remainingAmount = amount;
  const allocations: Array<{ earnedEventDetailId: string; amount: number }> = [];

  for (const lot of lotRows) {
    if (remainingAmount <= 0) {
      break;
    }

    const availableOnLot = lot.confirmedAmount - lot.reservedAmount;
    if (availableOnLot <= 0) {
      continue;
    }

    const allocated = Math.min(availableOnLot, remainingAmount);
    allocations.push({
      earnedEventDetailId: lot.earnedEventDetailId,
      amount: allocated,
    });
    remainingAmount -= allocated;
  }

  return remainingAmount === 0 ? allocations : null;
}

function buildProviderKey(action: DevPointActionType, eventId: string): string {
  const lower = action.toLowerCase();
  return `wallet-web:dev:points:${lower}:${eventId}`;
}

async function createEarnEvent(tx: DbTransaction, input: ParsedActionBody): Promise<{
  eventId: string;
  providerIdempotencyKey: string;
}> {
  const eventId = randomUUID();
  const detailId = randomUUID();
  const providerIdempotencyKey = buildProviderKey("EARN", eventId);

  const metadata = {
    source: "wallet-web-dev-points",
    devAction: "EARN",
    ...input.metadata,
  };

  await tx.execute(sql`
    insert into point_events (
      id,
      user_id,
      event_type,
      amount,
      original_event_id,
      intent_id,
      leg_id,
      attempt_id,
      provider_idempotency_key,
      provider_transaction_id,
      reason_code,
      reason_message,
      metadata,
      created_at
    ) values (
      ${eventId},
      ${input.userId},
      'EARN',
      ${input.amount},
      ${eventId},
      null,
      null,
      null,
      ${providerIdempotencyKey},
      ${eventId},
      ${input.reasonCode},
      ${input.reasonMessage},
      ${JSON.stringify(metadata)}::jsonb,
      now()
    )
  `);

  await tx.execute(sql`
    insert into point_event_details (
      id,
      point_event_id,
      user_id,
      event_type,
      amount,
      earned_event_detail_id,
      original_event_detail_id,
      created_at
    ) values (
      ${detailId},
      ${eventId},
      ${input.userId},
      'EARN',
      ${input.amount},
      ${detailId},
      null,
      now()
    )
  `);

  return { eventId, providerIdempotencyKey };
}

async function createRedeemEvent(
  tx: DbTransaction,
  input: ParsedActionBody
): Promise<{
  eventId: string;
  providerIdempotencyKey: string;
}> {
  const balance = await readBalanceSnapshot(tx, input.userId);
  if (balance.availableAmount < input.amount) {
    throw new HttpError({
      status: 400,
      message: `Insufficient points: requested=${input.amount}, available=${balance.availableAmount}`,
    });
  }

  const lotRows = await readLotAvailability(tx, input.userId);
  const allocations = allocateAcrossLots(input.amount, lotRows);

  if (!allocations) {
    throw new HttpError({
      status: 409,
      message: "Redeem allocation failed. Please refresh and retry.",
    });
  }

  const eventId = randomUUID();
  const providerIdempotencyKey = buildProviderKey("REDEEM", eventId);
  const metadata = {
    source: "wallet-web-dev-points",
    devAction: "REDEEM",
    allocationCount: allocations.length,
    ...input.metadata,
  };

  await tx.execute(sql`
    insert into point_events (
      id,
      user_id,
      event_type,
      amount,
      original_event_id,
      intent_id,
      leg_id,
      attempt_id,
      provider_idempotency_key,
      provider_transaction_id,
      reason_code,
      reason_message,
      metadata,
      created_at
    ) values (
      ${eventId},
      ${input.userId},
      'REDEEM',
      ${-input.amount},
      ${eventId},
      null,
      null,
      null,
      ${providerIdempotencyKey},
      ${eventId},
      ${input.reasonCode},
      ${input.reasonMessage},
      ${JSON.stringify(metadata)}::jsonb,
      now()
    )
  `);

  for (const allocation of allocations) {
    const detailId = randomUUID();
    await tx.execute(sql`
      insert into point_event_details (
        id,
        point_event_id,
        user_id,
        event_type,
        amount,
        earned_event_detail_id,
        original_event_detail_id,
        created_at
      ) values (
        ${detailId},
        ${eventId},
        ${input.userId},
        'REDEEM',
        ${-allocation.amount},
        ${allocation.earnedEventDetailId},
        null,
        now()
      )
    `);
  }

  return { eventId, providerIdempotencyKey };
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const userId = req.nextUrl.searchParams.get("userId")?.trim() ?? "";
    if (!userId) {
      return NextResponse.json(
        { message: "userId query parameter is required" },
        { status: 400 }
      );
    }

    const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
    const payload = await readPointOverview(userId, limit);

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load point overview";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = parseActionBody(await req.json());

    const mutation = await db.transaction(async (tx) => {
      await acquireUserLedgerLock(tx, body.userId);

      if (body.action === "EARN") {
        return createEarnEvent(tx, body);
      }

      return createRedeemEvent(tx, body);
    });

    const summary = await readPointSummary(body.userId);

    const response: WalletDevPointActionResponse = {
      performedAt: new Date().toISOString(),
      userId: body.userId,
      action: body.action,
      amount: body.amount,
      eventId: mutation.eventId,
      providerIdempotencyKey: mutation.providerIdempotencyKey,
      summary,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error ? error.message : "Failed to mutate points";
    return NextResponse.json({ message }, { status: 500 });
  }
}
