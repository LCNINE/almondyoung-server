"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import type {
  DevPointActionType,
  DevPointEventRow,
  WalletDevPointActionResponse,
  WalletDevPointsResponse,
} from "@/lib/dev-points-types";

interface PointQueryState {
  userId: string;
  limit: string;
}

interface PointActionState {
  action: DevPointActionType;
  amount: string;
  reasonCode: string;
  reasonMessage: string;
  metadataText: string;
}

const DEFAULT_QUERY: PointQueryState = {
  userId: "",
  limit: "50",
};

const DEFAULT_ACTION: PointActionState = {
  action: "EARN",
  amount: "1000",
  reasonCode: "",
  reasonMessage: "",
  metadataText: "{}",
};

function formatDateTime(value: string): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("ko-KR");
}

function shortenId(value: string | null, size = 6): string {
  if (!value) {
    return "-";
  }
  if (value.length <= size * 2) {
    return value;
  }
  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function eventVariant(
  eventType: DevPointEventRow["eventType"]
): "default" | "secondary" | "outline" | "destructive" {
  if (eventType === "EARN" || eventType === "REDEEM_CANCEL") {
    return "default";
  }

  if (eventType === "REDEEM" || eventType === "EARN_CANCEL") {
    return "destructive";
  }

  return "outline";
}

function holdVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "AUTHORIZED") {
    return "secondary";
  }
  if (status === "CAPTURED") {
    return "default";
  }
  if (status === "CANCELLED") {
    return "outline";
  }
  return "destructive";
}

export default function DevPointsPage() {
  const [query, setQuery] = useState<PointQueryState>(DEFAULT_QUERY);
  const [result, setResult] = useState<WalletDevPointsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [actionState, setActionState] = useState<PointActionState>(DEFAULT_ACTION);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationResult, setMutationResult] =
    useState<WalletDevPointActionResponse | null>(null);

  const activeUserId = query.userId.trim();

  const fetchedLabel = useMemo(() => {
    if (!result) {
      return "-";
    }
    return formatDateTime(result.fetchedAt);
  }, [result]);

  const loadOverview = async (): Promise<void> => {
    if (!activeUserId) {
      setError("userId를 입력해 주세요.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        userId: activeUserId,
        limit: query.limit.trim() || "50",
      });

      const response = await fetch(`/api/dev/points?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as
        | WalletDevPointsResponse
        | { message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload && "message" in payload ? payload.message : "조회 실패");
      }

      setResult(payload as WalletDevPointsResponse);
    } catch (caughtError) {
      setResult(null);
      setError(
        caughtError instanceof Error ? caughtError.message : "Unknown fetch error"
      );
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (): Promise<void> => {
    if (!activeUserId) {
      setMutationError("먼저 userId를 입력하세요.");
      return;
    }

    const amount = Number(actionState.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setMutationError("amount는 양의 정수여야 합니다.");
      return;
    }

    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(actionState.metadataText || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("metadata must be an object");
      }
      metadata = parsed as Record<string, unknown>;
    } catch {
      setMutationError("metadata JSON 형식이 올바르지 않습니다.");
      return;
    }

    setMutating(true);
    setMutationError(null);

    try {
      const response = await fetch("/api/dev/points", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: activeUserId,
          action: actionState.action,
          amount,
          reasonCode: actionState.reasonCode.trim() || undefined,
          reasonMessage: actionState.reasonMessage.trim() || undefined,
          metadata,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | WalletDevPointActionResponse
        | { message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload && "message" in payload ? payload.message : "실행 실패");
      }

      setMutationResult(payload as WalletDevPointActionResponse);
      await loadOverview();
    } catch (caughtError) {
      setMutationError(
        caughtError instanceof Error ? caughtError.message : "Unknown mutation error"
      );
    } finally {
      setMutating(false);
    }
  };

  const onReset = (): void => {
    setQuery(DEFAULT_QUERY);
    setActionState(DEFAULT_ACTION);
    setResult(null);
    setError(null);
    setMutationError(null);
    setMutationResult(null);
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link href="/dev/intents">Intent Explorer</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dev/api">API Console</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dev/signature">Signature Utility</Link>
        </Button>
        <Button asChild variant="default">
          <Link href="/dev/points">Points Manager</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wallet Dev: Points Manager</CardTitle>
          <CardDescription>
            회원 ID 기준으로 포인트 이력을 조회하고, 수동으로 EARN/REDEEM 이벤트를 생성합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input
              placeholder="userId"
              value={query.userId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, userId: event.target.value }))
              }
            />
            <Input
              type="number"
              min={1}
              max={200}
              placeholder="limit"
              value={query.limit}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, limit: event.target.value }))
              }
            />
            <div className="flex items-center gap-2 xl:col-span-2">
              <Button type="button" onClick={() => void loadOverview()} disabled={loading}>
                {loading ? "Loading..." : "Load Overview"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onReset}
                disabled={loading || mutating}
              >
                Reset
              </Button>
              <span className="text-muted-foreground text-xs">
                fetched: {fetchedLabel}
              </span>
            </div>
          </div>

          {error ? (
            <p className="text-destructive text-sm font-medium">{error}</p>
          ) : null}

          {result ? (
            <div className="grid gap-2 text-xs md:grid-cols-5">
              <div className="rounded-md border p-2">
                <p className="text-muted-foreground">confirmed</p>
                <p className="font-mono text-base">{result.summary.confirmedAmount}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-muted-foreground">reserved</p>
                <p className="font-mono text-base">{result.summary.reservedAmount}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-muted-foreground">available</p>
                <p className="font-mono text-base">{result.summary.availableAmount}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-muted-foreground">events</p>
                <p className="font-mono text-base">{result.summary.eventCount}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-muted-foreground">holds</p>
                <p className="font-mono text-base">{result.summary.holdCount}</p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual Mutation</CardTitle>
          <CardDescription>
            운영 로직과 동일하게 user-level advisory lock을 잡고 이벤트를 생성합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="flex h-8 min-w-0 items-center rounded-lg border px-2.5 text-sm">
              <span className="text-muted-foreground mr-2 text-xs">action</span>
              <select
                className="bg-transparent outline-none"
                value={actionState.action}
                onChange={(event) =>
                  setActionState((prev) => ({
                    ...prev,
                    action: event.target.value as DevPointActionType,
                  }))
                }
              >
                <option value="EARN">EARN</option>
                <option value="REDEEM">REDEEM</option>
              </select>
            </label>
            <Input
              type="number"
              min={1}
              placeholder="amount"
              value={actionState.amount}
              onChange={(event) =>
                setActionState((prev) => ({ ...prev, amount: event.target.value }))
              }
            />
            <Input
              placeholder="reasonCode (optional)"
              value={actionState.reasonCode}
              onChange={(event) =>
                setActionState((prev) => ({ ...prev, reasonCode: event.target.value }))
              }
            />
            <Input
              placeholder="reasonMessage (optional)"
              value={actionState.reasonMessage}
              onChange={(event) =>
                setActionState((prev) => ({ ...prev, reasonMessage: event.target.value }))
              }
            />
            <Button type="button" onClick={() => void runAction()} disabled={mutating}>
              {mutating ? "Running..." : "Run Mutation"}
            </Button>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">metadata JSON</p>
            <Textarea
              className="min-h-[120px] font-mono text-xs"
              value={actionState.metadataText}
              onChange={(event) =>
                setActionState((prev) => ({ ...prev, metadataText: event.target.value }))
              }
            />
          </div>

          {mutationError ? (
            <p className="text-destructive text-sm font-medium">{mutationError}</p>
          ) : null}

          {mutationResult ? (
            <div className="rounded-md border p-3 text-xs">
              <p>
                created event <span className="font-mono">{mutationResult.eventId}</span>
              </p>
              <p>
                action {mutationResult.action} / amount {mutationResult.amount}
              </p>
              <p className="text-muted-foreground">
                provider key: {mutationResult.providerIdempotencyKey}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>Point Events</CardTitle>
            <CardDescription>최근 이벤트 및 detail row를 확인합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            {!result ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                userId를 입력하고 조회하세요.
              </div>
            ) : result.events.length === 0 ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                이벤트가 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {result.events.map((event) => (
                  <Card key={event.id} className="gap-2">
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="font-mono text-sm">{event.id}</CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant={eventVariant(event.eventType)}>
                            {event.eventType}
                          </Badge>
                          <Badge variant="outline" className="font-mono">
                            {event.amount}
                          </Badge>
                        </div>
                      </div>
                      <CardDescription>{formatDateTime(event.createdAt)}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded border p-2">
                          <p className="text-muted-foreground">reason</p>
                          <p className="font-mono">{event.reasonCode ?? "-"}</p>
                        </div>
                        <div className="rounded border p-2">
                          <p className="text-muted-foreground">intent / leg</p>
                          <p className="font-mono">
                            {shortenId(event.intentId)} / {shortenId(event.legId)}
                          </p>
                        </div>
                        <div className="rounded border p-2">
                          <p className="text-muted-foreground">provider tx</p>
                          <p className="font-mono">{shortenId(event.providerTransactionId)}</p>
                        </div>
                        <div className="rounded border p-2">
                          <p className="text-muted-foreground">detail rows</p>
                          <p className="font-mono">{event.details.length}</p>
                        </div>
                      </div>

                      {event.reasonMessage ? (
                        <div className="rounded border border-dashed p-2">
                          <p className="text-muted-foreground">reasonMessage</p>
                          <p>{event.reasonMessage}</p>
                        </div>
                      ) : null}

                      <details className="rounded border p-2">
                        <summary className="cursor-pointer font-medium">
                          detail rows ({event.details.length})
                        </summary>
                        {event.details.length > 0 ? (
                          <div className="mt-2 overflow-x-auto">
                            <table className="w-full min-w-[840px] text-xs">
                              <thead className="bg-muted/40 text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-1 text-left">Detail ID</th>
                                  <th className="px-2 py-1 text-left">Type</th>
                                  <th className="px-2 py-1 text-left">Amount</th>
                                  <th className="px-2 py-1 text-left">Earned Detail</th>
                                  <th className="px-2 py-1 text-left">Original Detail</th>
                                  <th className="px-2 py-1 text-left">Created</th>
                                </tr>
                              </thead>
                              <tbody>
                                {event.details.map((detail) => (
                                  <tr key={detail.id} className="border-t">
                                    <td className="px-2 py-1 font-mono">{shortenId(detail.id)}</td>
                                    <td className="px-2 py-1">{detail.eventType}</td>
                                    <td className="px-2 py-1 font-mono">{detail.amount}</td>
                                    <td className="px-2 py-1 font-mono">
                                      {shortenId(detail.earnedEventDetailId)}
                                    </td>
                                    <td className="px-2 py-1 font-mono">
                                      {shortenId(detail.originalEventDetailId)}
                                    </td>
                                    <td className="px-2 py-1">{formatDateTime(detail.createdAt)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-muted-foreground mt-2 text-xs">No details.</p>
                        )}
                      </details>

                      <details className="rounded border p-2">
                        <summary className="cursor-pointer font-medium">metadata</summary>
                        <Textarea
                          className="mt-2 min-h-[96px] font-mono text-xs"
                          readOnly
                          value={JSON.stringify(event.metadata ?? {}, null, 2)}
                        />
                      </details>

                      <div className="text-muted-foreground rounded border border-dashed p-2 font-mono">
                        providerIdempotencyKey: {event.providerIdempotencyKey}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Point Holds</CardTitle>
            <CardDescription>예약 포인트 상태를 함께 확인합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            {!result ? (
              <div className="text-muted-foreground py-4 text-center text-sm">-</div>
            ) : result.holds.length === 0 ? (
              <div className="text-muted-foreground py-4 text-center text-sm">
                hold row가 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Hold ID</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-left">Amount</th>
                      <th className="px-2 py-1 text-left">Intent</th>
                      <th className="px-2 py-1 text-left">Leg</th>
                      <th className="px-2 py-1 text-left">Created</th>
                      <th className="px-2 py-1 text-left">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.holds.map((hold) => (
                      <tr key={hold.id} className="border-t">
                        <td className="px-2 py-1 font-mono">{shortenId(hold.id)}</td>
                        <td className="px-2 py-1">
                          <Badge variant={holdVariant(hold.status)}>{hold.status}</Badge>
                        </td>
                        <td className="px-2 py-1 font-mono">{hold.amount}</td>
                        <td className="px-2 py-1 font-mono">{shortenId(hold.intentId)}</td>
                        <td className="px-2 py-1 font-mono">{shortenId(hold.legId)}</td>
                        <td className="px-2 py-1">{formatDateTime(hold.createdAt)}</td>
                        <td className="px-2 py-1">{formatDateTime(hold.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
