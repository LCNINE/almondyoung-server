"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  IntentBundle,
  PaymentStateTransitionRow,
  WalletDevIntentsResponse,
} from "@/lib/dev-intents-types";

const STATUS_OPTIONS = [
  "ALL",
  "PENDING",
  "IN_PROGRESS",
  "PARTIALLY_CAPTURED",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "SUSPENDED",
  "SUPERSEDED",
  "RECONCILING",
  "SUPERSEDED_RECONCILE_REQUIRED",
  "RECONCILE_REQUIRED",
] as const;

type StatusOption = (typeof STATUS_OPTIONS)[number];

interface IntentQueryState {
  intentId: string;
  referenceId: string;
  status: StatusOption;
  limit: string;
  withTransitions: boolean;
}

const DEFAULT_QUERY: IntentQueryState = {
  intentId: "",
  referenceId: "",
  status: "ALL",
  limit: "20",
  withTransitions: true,
};

function buildQueryString(query: IntentQueryState): string {
  const params = new URLSearchParams();

  if (query.intentId.trim()) {
    params.set("intentId", query.intentId.trim());
  }

  if (query.referenceId.trim()) {
    params.set("referenceId", query.referenceId.trim());
  }

  if (query.status !== "ALL") {
    params.set("status", query.status);
  }

  params.set("limit", query.limit.trim() || "20");
  params.set("withTransitions", String(query.withTransitions));

  return params.toString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("ko-KR");
}

function shortenId(value: string, size = 8): string {
  if (value.length <= size * 2) {
    return value;
  }
  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (["SUCCEEDED", "CAPTURED", "COMPLETED", "REFUNDED"].includes(status)) {
    return "default";
  }

  if (["FAILED", "RECONCILE_REQUIRED", "FAILED_FINAL", "REJECTED"].includes(status)) {
    return "destructive";
  }

  if (["IN_PROGRESS", "PENDING", "PROCESSING", "REFUNDING", "CANCELING"].includes(status)) {
    return "secondary";
  }

  return "outline";
}

function countTransitions(transitions: PaymentStateTransitionRow[]): number {
  return transitions.length;
}

function IntentCard({ bundle }: { bundle: IntentBundle }) {
  const totalTransitionCount = useMemo(() => {
    if (!bundle.transitions) {
      return 0;
    }

    let count = countTransitions(bundle.transitions.intent);
    for (const rows of Object.values(bundle.transitions.leg)) {
      count += countTransitions(rows);
    }
    for (const rows of Object.values(bundle.transitions.attempt)) {
      count += countTransitions(rows);
    }
    for (const rows of Object.values(bundle.transitions.refundRequest)) {
      count += countTransitions(rows);
    }
    return count;
  }, [bundle.transitions]);

  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm">{bundle.intent.id}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={statusBadgeVariant(bundle.intent.status)}>
              {bundle.intent.status}
            </Badge>
            <Badge variant="outline">{bundle.intent.currency}</Badge>
          </div>
        </div>
        <CardDescription>
          reference: {bundle.intent.referenceType} / {bundle.intent.referenceId}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border p-2">
            <p className="text-muted-foreground">user</p>
            <p className="font-mono">{bundle.intent.userId}</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-muted-foreground">payableAmount</p>
            <p className="font-mono">{bundle.intent.payableAmount}</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-muted-foreground">createdAt</p>
            <p>{formatDateTime(bundle.intent.createdAt)}</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-muted-foreground">updatedAt</p>
            <p>{formatDateTime(bundle.intent.updatedAt)}</p>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Pricing Snapshot (Items {bundle.items.length} / Item Discounts{" "}
            {bundle.itemDiscounts.length} / Order Discounts{" "}
            {bundle.orderDiscounts.length})
          </h3>
          {bundle.items.length === 0 ? (
            <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              No item snapshot rows.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1100px] text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Line</th>
                    <th className="px-2 py-2 text-left">Name</th>
                    <th className="px-2 py-2 text-left">Type</th>
                    <th className="px-2 py-2 text-left">Item Ref</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                    <th className="px-2 py-2 text-left">Qty</th>
                    <th className="px-2 py-2 text-left">Base</th>
                    <th className="px-2 py-2 text-left">Per-Unit Disc</th>
                    <th className="px-2 py-2 text-left">Flat Disc</th>
                    <th className="px-2 py-2 text-left">Payable</th>
                    <th className="px-2 py-2 text-left">Discount Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.items.map((item) => {
                    const lineDiscounts = bundle.itemDiscounts.filter(
                      (discount) => discount.itemId === item.id
                    );

                    return (
                      <tr key={item.id} className="border-t align-top">
                        <td className="px-2 py-2 font-mono">{item.lineId}</td>
                        <td className="px-2 py-2">{item.name}</td>
                        <td className="px-2 py-2">{item.itemType ?? "-"}</td>
                        <td className="px-2 py-2 font-mono">{item.itemRefId ?? "-"}</td>
                        <td className="px-2 py-2 font-mono">{item.unitPrice}</td>
                        <td className="px-2 py-2 font-mono">{item.quantity}</td>
                        <td className="px-2 py-2 font-mono">{item.baseAmount}</td>
                        <td className="px-2 py-2 font-mono">
                          {item.itemDiscountPerUnitTotal}
                        </td>
                        <td className="px-2 py-2 font-mono">
                          {item.itemDiscountFlatTotal}
                        </td>
                        <td className="px-2 py-2 font-mono">{item.payableAmount}</td>
                        <td className="px-2 py-2">
                          {lineDiscounts.length === 0 ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <div className="space-y-1">
                              {lineDiscounts.map((discount) => (
                                <div
                                  key={discount.id}
                                  className="rounded border border-dashed px-2 py-1"
                                >
                                  <span className="font-mono">{discount.kind}</span>{" "}
                                  <span className="font-mono">{discount.amount}</span>
                                  {discount.discountId ? (
                                    <span className="text-muted-foreground font-mono">
                                      {" "}
                                      ({discount.discountId})
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-md border p-2">
            <h4 className="mb-2 text-xs font-semibold">
              Order Discounts ({bundle.orderDiscounts.length})
            </h4>
            {bundle.orderDiscounts.length === 0 ? (
              <p className="text-muted-foreground text-xs">No order discounts.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {bundle.orderDiscounts.map((discount) => (
                  <li key={discount.id} className="rounded border border-dashed p-2">
                    <span className="font-mono">{discount.kind}</span>{" "}
                    <span className="font-mono">{discount.amount}</span>
                    {discount.discountId ? (
                      <span className="text-muted-foreground font-mono">
                        {" "}
                        ({discount.discountId})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Legs ({bundle.legs.length}) / Attempts ({bundle.attempts.length})
          </h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Seq</th>
                  <th className="px-2 py-2 text-left">Leg</th>
                  <th className="px-2 py-2 text-left">Provider</th>
                  <th className="px-2 py-2 text-left">Leg Status</th>
                  <th className="px-2 py-2 text-left">Amount</th>
                  <th className="px-2 py-2 text-left">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {bundle.legs.map((leg) => {
                  const legAttempts = bundle.attempts.filter(
                    (attempt) => attempt.legId === leg.id
                  );

                  return (
                    <tr key={leg.id} className="border-t align-top">
                      <td className="px-2 py-2">{leg.sequenceNo}</td>
                      <td className="px-2 py-2 font-mono">{shortenId(leg.id)}</td>
                      <td className="px-2 py-2">{leg.providerType}</td>
                      <td className="px-2 py-2">
                        <Badge variant={statusBadgeVariant(leg.status)}>{leg.status}</Badge>
                      </td>
                      <td className="px-2 py-2 font-mono">{leg.amount}</td>
                      <td className="px-2 py-2">
                        {legAttempts.length === 0 ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          <div className="space-y-1">
                            {legAttempts.map((attempt) => (
                              <div
                                key={attempt.id}
                                className="rounded border border-dashed px-2 py-1"
                              >
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="font-mono">
                                    #{attempt.attemptNo} {attempt.operation}
                                  </span>
                                  <Badge variant={statusBadgeVariant(attempt.status)}>
                                    {attempt.status}
                                  </Badge>
                                  {attempt.providerTransactionId ? (
                                    <span className="text-muted-foreground font-mono">
                                      tx: {shortenId(attempt.providerTransactionId, 6)}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-muted-foreground mt-1">
                                  {formatDateTime(attempt.createdAt)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border p-2">
            <h3 className="mb-2 text-sm font-semibold">
              Refund Requests ({bundle.refundRequests.length})
            </h3>
            {bundle.refundRequests.length === 0 ? (
              <p className="text-muted-foreground text-xs">No refund requests.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {bundle.refundRequests.map((refund) => (
                  <li key={refund.id} className="rounded border border-dashed p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{shortenId(refund.id)}</span>
                      <Badge variant={statusBadgeVariant(refund.status)}>{refund.status}</Badge>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      amount: {refund.refundAmount} / {formatDateTime(refund.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border p-2">
            <h3 className="mb-2 text-sm font-semibold">
              Manual Queue ({bundle.manualQueueItems.length})
            </h3>
            {bundle.manualQueueItems.length === 0 ? (
              <p className="text-muted-foreground text-xs">No queue items.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {bundle.manualQueueItems.map((item) => (
                  <li key={item.id} className="rounded border border-dashed p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{shortenId(item.id)}</span>
                      <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      {item.actionType} / retry {item.retryCount} / {formatDateTime(item.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {bundle.transitions ? (
          <details className="rounded-md border p-2 text-xs">
            <summary className="cursor-pointer font-semibold">
              State Transitions ({totalTransitionCount})
            </summary>
            <div className="mt-2 space-y-1">
              {bundle.transitions.intent.map((row) => (
                <div key={row.id} className="rounded border border-dashed p-2">
                  <span className="font-mono">INTENT</span>: {row.previousStatus ?? "-"} -&gt;{" "}
                  {row.newStatus} ({formatDateTime(row.occurredAt)})
                </div>
              ))}
              {Object.entries(bundle.transitions.leg).flatMap(([legId, rows]) =>
                rows.map((row) => (
                  <div key={row.id} className="rounded border border-dashed p-2">
                    <span className="font-mono">LEG {shortenId(legId, 5)}</span>:{" "}
                    {row.previousStatus ?? "-"} -&gt; {row.newStatus} (
                    {formatDateTime(row.occurredAt)})
                  </div>
                ))
              )}
              {Object.entries(bundle.transitions.attempt).flatMap(([attemptId, rows]) =>
                rows.map((row) => (
                  <div key={row.id} className="rounded border border-dashed p-2">
                    <span className="font-mono">ATTEMPT {shortenId(attemptId, 5)}</span>:{" "}
                    {row.previousStatus ?? "-"} -&gt; {row.newStatus} (
                    {formatDateTime(row.occurredAt)})
                  </div>
                ))
              )}
              {Object.entries(bundle.transitions.refundRequest).flatMap(([refundId, rows]) =>
                rows.map((row) => (
                  <div key={row.id} className="rounded border border-dashed p-2">
                    <span className="font-mono">REFUND {shortenId(refundId, 5)}</span>:{" "}
                    {row.previousStatus ?? "-"} -&gt; {row.newStatus} (
                    {formatDateTime(row.occurredAt)})
                  </div>
                ))
              )}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function DevIntentsPage() {
  const [query, setQuery] = useState<IntentQueryState>(DEFAULT_QUERY);
  const [submittedQuery, setSubmittedQuery] =
    useState<IntentQueryState>(DEFAULT_QUERY);
  const [result, setResult] = useState<WalletDevIntentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function runFetch(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const queryString = buildQueryString(submittedQuery);
        const response = await fetch(`/api/dev/intents?${queryString}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(body?.message ?? `Failed (${response.status})`);
        }

        const payload = (await response.json()) as WalletDevIntentsResponse;
        setResult(payload);
      } catch (caughtError) {
        if ((caughtError as { name?: string }).name === "AbortError") {
          return;
        }
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unknown fetch error"
        );
      } finally {
        setLoading(false);
      }
    }

    void runFetch();

    return () => {
      controller.abort();
    };
  }, [submittedQuery]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmittedQuery(query);
  };

  const onReset = (): void => {
    setQuery(DEFAULT_QUERY);
    setSubmittedQuery(DEFAULT_QUERY);
  };

  const fetchedLabel = result ? formatDateTime(result.fetchedAt) : "-";

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="default">
          <Link href="/dev/intents">Intent Explorer</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dev/api">API Console</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wallet Dev: Intent Explorer</CardTitle>
          <CardDescription>
            intent 기준으로 leg/attempt/refund/manual queue/state transition을 한 번에 조회합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onSubmit}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Input
                placeholder="intentId (uuid)"
                value={query.intentId}
                onChange={(event) =>
                  setQuery((prev) => ({ ...prev, intentId: event.target.value }))
                }
              />
              <Input
                placeholder="referenceId (partial match)"
                value={query.referenceId}
                onChange={(event) =>
                  setQuery((prev) => ({ ...prev, referenceId: event.target.value }))
                }
              />

              <label className="flex h-8 min-w-0 items-center rounded-lg border px-2.5 text-sm">
                <span className="text-muted-foreground mr-2 text-xs">status</span>
                <select
                  className="bg-transparent outline-none"
                  value={query.status}
                  onChange={(event) =>
                    setQuery((prev) => ({
                      ...prev,
                      status: event.target.value as StatusOption,
                    }))
                  }
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <Input
                type="number"
                min={1}
                max={100}
                placeholder="limit"
                value={query.limit}
                onChange={(event) =>
                  setQuery((prev) => ({ ...prev, limit: event.target.value }))
                }
              />

              <label className="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={query.withTransitions}
                  onChange={(event) =>
                    setQuery((prev) => ({
                      ...prev,
                      withTransitions: event.target.checked,
                    }))
                  }
                />
                with transitions
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Loading..." : "Run Query"}
              </Button>
              <Button type="button" variant="outline" onClick={onReset} disabled={loading}>
                Reset
              </Button>
              <span className="text-muted-foreground text-xs">
                fetched: {fetchedLabel} / intents: {result?.count ?? 0}
              </span>
            </div>

            {error ? (
              <p className="text-destructive text-sm font-medium">{error}</p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        {result?.intents.length ? (
          result.intents.map((bundle) => (
            <IntentCard key={bundle.intent.id} bundle={bundle} />
          ))
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              조회 결과가 없습니다.
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
