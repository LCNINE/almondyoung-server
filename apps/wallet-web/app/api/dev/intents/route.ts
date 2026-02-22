import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import {
  manualCancelQueueItems,
  paymentAttempts,
  paymentIntentItemDiscounts,
  paymentIntentItems,
  paymentIntentOrderDiscounts,
  paymentIntents,
  paymentLegs,
  paymentIntentStatus,
  paymentStateTransitions,
  refundAllocations,
  refundRequests,
} from "@/db/drizzle/schema";
import type {
  IntentBundle,
  IntentTransitionBundle,
  ManualQueueItemRow,
  PaymentAttemptRow,
  PaymentIntentItemDiscountRow,
  PaymentIntentItemRow,
  PaymentIntentOrderDiscountRow,
  PaymentIntentRow,
  PaymentLegRow,
  PaymentStateTransitionRow,
  RefundAllocationRow,
  RefundRequestRow,
  WalletDevIntentsResponse,
} from "@/lib/dev-intents-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

function toNonEmpty(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toBooleanFlag(value: string | null, defaultValue: boolean): boolean {
  if (value == null) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  return defaultValue;
}

function groupByIntentId<
  T extends {
    intentId: string;
  },
>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const row of rows) {
    const current = map.get(row.intentId);
    if (current) {
      current.push(row);
      continue;
    }
    map.set(row.intentId, [row]);
  }

  return map;
}

function buildTransitionBundle(
  intent: PaymentIntentRow,
  legs: PaymentLegRow[],
  attempts: PaymentAttemptRow[],
  refundReqs: RefundRequestRow[],
  transitionByKey: Map<string, PaymentStateTransitionRow[]>,
  withTransitions: boolean
): IntentTransitionBundle | null {
  if (!withTransitions) {
    return null;
  }

  const legTransitions: Record<string, PaymentStateTransitionRow[]> = {};
  for (const leg of legs) {
    legTransitions[leg.id] = transitionByKey.get(`LEG:${leg.id}`) ?? [];
  }

  const attemptTransitions: Record<string, PaymentStateTransitionRow[]> = {};
  for (const attempt of attempts) {
    attemptTransitions[attempt.id] =
      transitionByKey.get(`ATTEMPT:${attempt.id}`) ?? [];
  }

  const refundTransitions: Record<string, PaymentStateTransitionRow[]> = {};
  for (const refund of refundReqs) {
    refundTransitions[refund.id] =
      transitionByKey.get(`REFUND_REQUEST:${refund.id}`) ?? [];
  }

  return {
    intent: transitionByKey.get(`INTENT:${intent.id}`) ?? [],
    leg: legTransitions,
    attempt: attemptTransitions,
    refundRequest: refundTransitions,
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const searchParams = req.nextUrl.searchParams;
    const intentId = toNonEmpty(searchParams.get("intentId"));
    const referenceId = toNonEmpty(searchParams.get("referenceId"));
    const rawStatus = toNonEmpty(searchParams.get("status"));
    const limit = parseLimit(searchParams.get("limit"));
    const withTransitions = toBooleanFlag(
      searchParams.get("withTransitions"),
      true
    );

    const status =
      rawStatus && rawStatus !== "ALL" ? rawStatus.toUpperCase() : null;
    if (
      status &&
      !paymentIntentStatus.enumValues.includes(
        status as (typeof paymentIntentStatus.enumValues)[number]
      )
    ) {
      return NextResponse.json(
        {
          message: `Unsupported intent status: ${status}`,
          allowed: paymentIntentStatus.enumValues,
        },
        { status: 400 }
      );
    }

    const conditions = [];
    if (intentId) {
      conditions.push(eq(paymentIntents.id, intentId));
    }
    if (referenceId) {
      conditions.push(ilike(paymentIntents.referenceId, `%${referenceId}%`));
    }
    if (status) {
      conditions.push(
        eq(
          paymentIntents.status,
          status as (typeof paymentIntentStatus.enumValues)[number]
        )
      );
    }

    const intents: PaymentIntentRow[] =
      conditions.length > 0
        ? await db
            .select()
            .from(paymentIntents)
            .where(and(...conditions))
            .orderBy(desc(paymentIntents.createdAt))
            .limit(limit)
        : await db
            .select()
            .from(paymentIntents)
            .orderBy(desc(paymentIntents.createdAt))
            .limit(limit);

    if (intents.length === 0) {
      const emptyResponse: WalletDevIntentsResponse = {
        fetchedAt: new Date().toISOString(),
        count: 0,
        filters: {
          intentId,
          referenceId,
          status,
          limit,
          withTransitions,
        },
        intents: [],
      };
      return NextResponse.json(emptyResponse);
    }

    const intentIds = intents.map((intent) => intent.id);

    const [
      intentItems,
      itemDiscounts,
      orderDiscounts,
      legs,
      attempts,
      refundReqs,
      manualQueue,
    ]: [
      PaymentIntentItemRow[],
      PaymentIntentItemDiscountRow[],
      PaymentIntentOrderDiscountRow[],
      PaymentLegRow[],
      PaymentAttemptRow[],
      RefundRequestRow[],
      ManualQueueItemRow[],
    ] = await Promise.all([
      db
        .select()
        .from(paymentIntentItems)
        .where(inArray(paymentIntentItems.intentId, intentIds))
        .orderBy(paymentIntentItems.createdAt),
      db
        .select()
        .from(paymentIntentItemDiscounts)
        .where(inArray(paymentIntentItemDiscounts.intentId, intentIds))
        .orderBy(paymentIntentItemDiscounts.createdAt),
      db
        .select()
        .from(paymentIntentOrderDiscounts)
        .where(inArray(paymentIntentOrderDiscounts.intentId, intentIds))
        .orderBy(paymentIntentOrderDiscounts.createdAt),
      db
        .select()
        .from(paymentLegs)
        .where(inArray(paymentLegs.intentId, intentIds))
        .orderBy(paymentLegs.sequenceNo),
      db
        .select()
        .from(paymentAttempts)
        .where(inArray(paymentAttempts.intentId, intentIds))
        .orderBy(desc(paymentAttempts.createdAt)),
      db
        .select()
        .from(refundRequests)
        .where(inArray(refundRequests.intentId, intentIds))
        .orderBy(desc(refundRequests.createdAt)),
      db
        .select()
        .from(manualCancelQueueItems)
        .where(inArray(manualCancelQueueItems.intentId, intentIds))
        .orderBy(desc(manualCancelQueueItems.createdAt)),
    ]);

    const refundRequestIds = refundReqs.map((row) => row.id);
    const refundAllocs: RefundAllocationRow[] =
      refundRequestIds.length > 0
        ? await db
            .select()
            .from(refundAllocations)
            .where(inArray(refundAllocations.refundRequestId, refundRequestIds))
            .orderBy(desc(refundAllocations.createdAt))
        : [];

    const transitionByKey = new Map<string, PaymentStateTransitionRow[]>();
    if (withTransitions) {
      const transitionEntityIds = [
        ...intents.map((row) => row.id),
        ...legs.map((row) => row.id),
        ...attempts.map((row) => row.id),
        ...refundReqs.map((row) => row.id),
      ];

      if (transitionEntityIds.length > 0) {
        const transitionRows = await db
          .select()
          .from(paymentStateTransitions)
          .where(
            and(
              inArray(paymentStateTransitions.entityId, transitionEntityIds),
              inArray(paymentStateTransitions.entityType, [
                "INTENT",
                "LEG",
                "ATTEMPT",
                "REFUND_REQUEST",
              ])
            )
          )
          .orderBy(desc(paymentStateTransitions.occurredAt))
          .limit(2000);

        for (const row of transitionRows) {
          const key = `${row.entityType}:${row.entityId}`;
          const current = transitionByKey.get(key);
          if (current) {
            current.push(row);
          } else {
            transitionByKey.set(key, [row]);
          }
        }
      }
    }

    const itemsByIntentId = groupByIntentId(intentItems);
    const itemDiscountsByIntentId = groupByIntentId(itemDiscounts);
    const orderDiscountsByIntentId = groupByIntentId(orderDiscounts);
    const legsByIntentId = groupByIntentId(legs);
    const attemptsByIntentId = groupByIntentId(attempts);
    const refundReqsByIntentId = groupByIntentId(refundReqs);
    const refundAllocsByIntentId = groupByIntentId(refundAllocs);
    const manualQueueByIntentId = groupByIntentId(manualQueue);

    const bundles: IntentBundle[] = intents.map((intent) => {
      const intentLegs = legsByIntentId.get(intent.id) ?? [];
      const intentAttempts = attemptsByIntentId.get(intent.id) ?? [];
      const intentRefundReqs = refundReqsByIntentId.get(intent.id) ?? [];

      return {
        intent,
        items: itemsByIntentId.get(intent.id) ?? [],
        itemDiscounts: itemDiscountsByIntentId.get(intent.id) ?? [],
        orderDiscounts: orderDiscountsByIntentId.get(intent.id) ?? [],
        legs: intentLegs,
        attempts: intentAttempts,
        refundRequests: intentRefundReqs,
        refundAllocations: refundAllocsByIntentId.get(intent.id) ?? [],
        manualQueueItems: manualQueueByIntentId.get(intent.id) ?? [],
        transitions: buildTransitionBundle(
          intent,
          intentLegs,
          intentAttempts,
          intentRefundReqs,
          transitionByKey,
          withTransitions
        ),
      };
    });

    const response: WalletDevIntentsResponse = {
      fetchedAt: new Date().toISOString(),
      count: bundles.length,
      filters: {
        intentId,
        referenceId,
        status,
        limit,
        withTransitions,
      },
      intents: bundles,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error while reading DB";
    return NextResponse.json({ message }, { status: 500 });
  }
}
